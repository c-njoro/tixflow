// src/lib/checkoutRecovery.ts
//
// Win-back for failed checkouts. A buyer whose M-Pesa prompt timed out,
// was cancelled or bounced (or whose card payment failed) gets one message
// a little later, by email and WhatsApp, with a link back to the event
// page that reopens checkout with the same tickets, details and promo code
// (the ?resume= token). An order placed from that link records which
// failed order it recovered, so organisers can see what it won back.
//
// At most one message per buyer per event a day, never once they've
// bought, and only while the event is still selling.
import type { PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import { createLinkToken, verifyLinkToken } from './signedLinks';
import { getAppUrl } from './mpesaCallbacks';
import { sendCheckoutRetryEmail } from './email';
import { checkoutRetryMessage } from './whatsappTemplates';
import { deliverMessage, recipientFromOrder } from './attendeeMessaging';

// Long enough that the buyer isn't still retrying on the page; short
// enough that they still remember.
const NUDGE_AFTER_MS = 20 * 60_000;
// Older failures are left alone.
const NUDGE_WINDOW_MS = 6 * 60 * 60_000;
const ONE_PER_BUYER_MS = 24 * 60 * 60_000;
// How long the resume link works.
const RESUME_VALID_MS = 3 * 24 * 60 * 60_000;
// Don't nudge for an event that's about to start.
const MIN_LEAD_MS = 60 * 60_000;

const RECOVERABLE_KINDS = ['purchase', 'installment_deposit'];

const resumeToken = (orderId: string) => createLinkToken('checkout-resume', orderId);

export function resumeUrl(order: Pick<PendingOrder, 'id'>, tenantSlug: string, eventSlug: string) {
  return `${getAppUrl()}/${tenantSlug}/${eventSlug}?resume=${resumeToken(order.id)}`;
}

// The failed order a resume link points at, if the link is genuine and recent.
export async function orderFromResumeToken(token: unknown) {
  const orderId = verifyLinkToken('checkout-resume', token);
  if (!orderId || !/^[a-f0-9]{24}$/i.test(orderId)) return null;
  const order = await prisma.pendingOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status !== 'failed' || !RECOVERABLE_KINDS.includes(order.kind)) return null;
  if (Date.now() - order.createdAt.getTime() > RESUME_VALID_MS) return null;
  return order;
}

// What the event page needs to put the order back together.
export async function resumeDetails(token: unknown) {
  const order = await orderFromResumeToken(token);
  if (!order) return null;
  const [promo, promoter] = await Promise.all([
    order.promoCodeId ? prisma.promoCode.findUnique({ where: { id: order.promoCodeId }, select: { code: true } }) : null,
    order.promoterId ? prisma.promoter.findUnique({ where: { id: order.promoterId }, select: { code: true } }) : null,
  ]);
  return {
    eventId: order.eventId,
    buyerName: order.buyerName,
    buyerEmail: order.buyerEmail,
    buyerWhatsapp: order.buyerWhatsapp,
    // The M-Pesa number they paid from (card orders may not have one).
    phone: order.paymentMethod === 'mpesa' ? order.buyerPhone : null,
    paymentMethod: order.paymentMethod,
    items: order.items.map((i) => ({ ticketTierId: i.ticketTierId, quantity: i.quantity })),
    promoCode: promo?.code ?? null,
    ref: promoter?.code ?? null,
    // A Lipa Pole Pole deposit they'd chosen.
    deposit: order.kind === 'installment_deposit' ? order.totalAmount : null,
  };
}

async function alreadyBought(order: PendingOrder) {
  const bought = await prisma.pendingOrder.findFirst({
    where: {
      eventId: order.eventId,
      buyerEmail: { equals: order.buyerEmail, mode: 'insensitive' },
      kind: { in: RECOVERABLE_KINDS },
      status: 'completed',
      createdAt: { gte: order.createdAt },
    },
    select: { id: true },
  });
  return !!bought;
}

async function nudgedRecently(order: PendingOrder, now: Date) {
  const recent = await prisma.pendingOrder.findFirst({
    where: {
      eventId: order.eventId,
      buyerEmail: { equals: order.buyerEmail, mode: 'insensitive' },
      recoveryNudgedAt: { gte: new Date(now.getTime() - ONE_PER_BUYER_MS) },
    },
    select: { id: true },
  });
  return !!recent;
}

// Run by the scheduler. Returns how many buyers were messaged.
export async function sendCheckoutRecoveries(now = new Date()) {
  const candidates = await prisma.pendingOrder.findMany({
    where: {
      status: 'failed',
      kind: { in: RECOVERABLE_KINDS },
      paymentMethod: { in: ['mpesa', 'card'] },
      totalAmount: { gt: 0 },
      updatedAt: { gte: new Date(now.getTime() - NUDGE_WINDOW_MS), lte: new Date(now.getTime() - NUDGE_AFTER_MS) },
      OR: [{ recoveryNudgedAt: null }, { recoveryNudgedAt: { isSet: false } }],
    },
    orderBy: { updatedAt: 'asc' },
    take: 200,
  });

  let sent = 0;
  const seen = new Set<string>(); // one per buyer per event within this run
  for (const order of candidates) {
    const key = `${order.eventId}:${order.buyerEmail.toLowerCase()}`;
    if (seen.has(key) || !order.buyerEmail) continue;
    seen.add(key);

    const event = await prisma.event.findUnique({
      where: { id: order.eventId },
      include: { tenant: { select: { slug: true } }, ticketTiers: true },
    });
    if (!event || event.status !== 'published' || event.guestListOnly) continue;
    if (event.date.getTime() - now.getTime() < MIN_LEAD_MS) continue;
    // Something they wanted must still be on sale.
    const onSale = order.items.some((i) => {
      const tier = event.ticketTiers.find((t) => t.id === i.ticketTierId);
      return tier && tier.isActive && tier.capacity - tier.sold >= i.quantity;
    });
    if (!onSale) continue;
    if ((await alreadyBought(order)) || (await nudgedRecently(order, now))) continue;

    // Claim it, so two overlapping runs can't both send.
    const claim = await prisma.pendingOrder.updateMany({
      where: { id: order.id, OR: [{ recoveryNudgedAt: null }, { recoveryNudgedAt: { isSet: false } }] },
      data: { recoveryNudgedAt: now },
    });
    if (claim.count === 0) continue;

    const url = resumeUrl(order, event.tenant.slug, event.slug);
    const items = order.items
      .map((i) => `${i.quantity} × ${event.ticketTiers.find((t) => t.id === i.ticketTierId)?.name ?? 'Ticket'}`)
      .join(', ');
    const delivered = await deliverMessage(
      recipientFromOrder(order),
      {
        email: (to) =>
          sendCheckoutRetryEmail({ to, buyerName: order.buyerName, eventTitle: event.title, eventDate: event.date, items, url }),
        whatsapp: checkoutRetryMessage({ name: order.buyerName, eventTitle: event.title, url }),
      },
      'CHECKOUT_RETRY'
    );
    if (delivered) sent++;
  }
  return { sent };
}

// For the organiser: failed payments followed up, and what came back.
export async function recoveryStats(eventId: string) {
  const [nudged, recovered] = await Promise.all([
    prisma.pendingOrder.count({ where: { eventId, recoveryNudgedAt: { not: null } } }),
    prisma.pendingOrder.findMany({
      where: { eventId, status: 'completed', recoveredFromOrderId: { not: null } },
      select: { totalAmount: true, planTotal: true },
    }),
  ]);
  return {
    nudged,
    recovered: recovered.length,
    // A recovered Lipa Pole Pole deposit is worth the whole plan.
    revenue: recovered.reduce((sum, o) => sum + (o.planTotal ?? o.totalAmount), 0),
  };
}
