// src/lib/checkoutQuote.ts
//
// Checks a buyer's checkout request against the event as it is now (on
// sale, seats left, registration limits, promo code, promoter link,
// instalments) and works out the order to create. Shared by the M-Pesa
// and card checkouts, so both charge exactly the same thing. Never trusts
// prices or availability sent by the client.
import type { Event, Prisma, Tenant, TicketTier } from '@prisma/client';
import { prisma } from './prisma';
import { normalizeKenyanPhone } from './phone';
import { computeCommission, promoterById, resolvePromoter } from './promoters';
import { installmentsOpen, minimumDeposit } from './installments';
import { findPromoCode, isPricingError, priceOrder, type PricedOrder, type PricingError } from './pricing';
import { orderFromResumeToken } from './checkoutRecovery';
import { offerFromToken } from './waitlist';
import { heldSeats } from './holds';
import { groupForCheckout } from './groups';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

type OrderData = Omit<Prisma.PendingOrderUncheckedCreateInput, 'status' | 'accessKey'>;

export interface CheckoutQuote {
  event: Event & { ticketTiers: TicketTier[] };
  tenant: Tenant;
  priced: PricedOrder;
  chargeNow: number;
  order: OrderData; // ready for createOrderAndPush / the card checkout
}

export const isQuoteError = isPricingError;

// The event and its tiers, if it's open for sales.
export async function loadSellableEvent(eventId: unknown) {
  if (typeof eventId !== 'string' || !/^[a-f0-9]{24}$/i.test(eventId)) return null;
  return prisma.event.findFirst({ where: { id: eventId, status: 'published', guestListOnly: false }, include: { ticketTiers: true } });
}

// Are the tiers on sale with enough seats? `atDoor` (box office): sales
// windows don't apply — the gate sells while there are seats.
export async function checkAvailability(
  event: Event & { ticketTiers: TicketTier[] },
  items: { ticketTierId: string; quantity: number }[],
  {
    atDoor = false,
    offerEntryId = null,
    groupId = null,
  }: { atDoor?: boolean; offerEntryId?: string | null; groupId?: string | null } = {}
): Promise<PricingError | null> {
  const now = new Date();
  // Seats held for the waitlist or a group aren't for sale, except to them.
  const held = await heldSeats(items.map((i) => i.ticketTierId), { offerId: offerEntryId, groupId });
  for (const item of items) {
    const tier = event.ticketTiers.find((t) => t.id === item.ticketTierId);
    if (!tier) return { error: 'One of the selected ticket types is invalid.', status: 400 };
    if (!tier.isActive) return { error: `${tier.name} is not currently on sale.`, status: 409 };
    if (!atDoor && ((tier.salesStart && tier.salesStart > now) || (tier.salesEnd && tier.salesEnd < now))) {
      return { error: `${tier.name} is not currently on sale.`, status: 409 };
    }
    const available = tier.capacity - tier.sold - (held.get(tier.id) ?? 0);
    if (Number(item.quantity) > available) {
      return {
        error: available <= 0 ? `${tier.name} is sold out.` : `Only ${available} ${tier.name} ticket${available === 1 ? '' : 's'} left.`,
        status: 409,
      };
    }
  }
  return null;
}

const ticketsWantedIn = (items: { quantity: unknown }[]) => items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);

export async function quoteCheckout(
  body: Record<string, any>,
  { requirePhone }: { requirePhone: boolean }
): Promise<CheckoutQuote | PricingError> {
  const { eventId, buyerName, buyerEmail, buyerWhatsapp, phoneNumber, items, ref, promoCode } = body;
  if (!eventId || !buyerName || !buyerEmail) {
    return { error: 'Your name and email are required.', status: 400 };
  }
  if (!EMAIL_REGEX.test(String(buyerEmail).trim())) return { error: 'Enter a valid email address.', status: 400 };
  const whatsappPhone = buyerWhatsapp ? normalizeKenyanPhone(buyerWhatsapp) : null;
  if (buyerWhatsapp && !whatsappPhone) {
    return { error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.', status: 400 };
  }
  const mpesaPhone = phoneNumber ? normalizeKenyanPhone(phoneNumber) : null;
  if (phoneNumber && !mpesaPhone) return { error: 'Enter a valid M-Pesa number (e.g. 0712345678).', status: 400 };
  if (!Array.isArray(items) || items.length === 0) return { error: 'Choose at least one ticket.', status: 400 };

  const event = await loadSellableEvent(eventId);
  if (!event) return { error: 'Event not found.', status: 404 };
  const tenant = await prisma.tenant.findUnique({ where: { id: event.tenantId } });
  if (!tenant) return { error: 'Organizer not found.', status: 404 };

  // Bought from a waitlist offer: the seats held for them are theirs.
  const offerEntry = body.offer ? await offerFromToken(body.offer) : null;
  const offer = offerEntry && offerEntry.eventId === event.id ? offerEntry : null;

  // Paying a share of a group booking: only its ticket type, only the
  // seats it has left, and its held seats are open to it.
  let group = null;
  if (body.group) {
    group = await groupForCheckout(body.group);
    if (!group || group.eventId !== event.id) return { error: 'This group has closed. You can still buy tickets on the event page.', status: 409 };
    const left = group.size - group.paidSeats;
    if ((items as { ticketTierId: string }[]).some((i) => i.ticketTierId !== group!.ticketTierId)) return { error: 'This group is for one ticket type only.', status: 400 };
    if (ticketsWantedIn(items) > left) {
      return { error: left <= 0 ? 'Every seat in this group is paid.' : `Only ${left} seat${left === 1 ? '' : 's'} left in this group.`, status: 409 };
    }
    if (body.installment) return { error: 'Group shares are paid in full.', status: 400 };
  }

  const unavailable = await checkAvailability(event, items, { offerEntryId: offer?.id, groupId: group?.id });
  if (unavailable) return unavailable;

  const ticketsWanted = items.reduce((n: number, i: any) => n + (Number(i.quantity) || 0), 0);
  let promo = null;
  if (promoCode) {
    const found = await findPromoCode(tenant.id, event.id, promoCode, ticketsWanted);
    if (isPricingError(found)) return found;
    promo = found.promo;
  }
  const priced = priceOrder(event, event.ticketTiers, items, { promo });
  if (isPricingError(priced)) return priced;

  // Free registrations don't need payment setup or an M-Pesa number.
  if (priced.total > 0) {
    if (!tenant.isOnboarded) return { error: 'This organizer has not finished payment setup yet.', status: 409 };
    if (requirePhone && !mpesaPhone) return { error: 'Enter your M-Pesa number (e.g. 0712345678).', status: 400 };
  }

  // Commission is on what the organiser actually gets for the tickets —
  // after the promo discount, before any booking fee.
  // Bought from a win-back link: credit the recovery, and the promoter
  // the failed order had.
  const recoveredFrom = body.resume ? await orderFromResumeToken(body.resume) : null;
  const resumed = recoveredFrom && recoveredFrom.eventId === event.id ? recoveredFrom : null;
  const promoter =
    (await resolvePromoter(tenant.id, event.id, ref)) ??
    (await promoterById(tenant.id, event.id, promo?.promoterId)) ??
    (await promoterById(tenant.id, event.id, resumed?.promoterId));
  const fullCommission = promoter
    ? computeCommission(promoter, { totalAmount: priced.ticketsTotal, ticketCount: priced.ticketCount })
    : null;

  // Lipa Pole Pole: pay a deposit now, the rest by the event's deadline.
  // The deposit reserves the seats; tickets come when it's paid off.
  let chargeNow = priced.total;
  let installment = false;
  if (body.installment && priced.total > 0) {
    if (!installmentsOpen(event)) return { error: 'Paying in instalments is not available for this event.', status: 409 };
    const deposit = Math.round(Number(body.installment.deposit));
    const minDeposit = minimumDeposit(event, priced.total);
    if (!Number.isFinite(deposit) || deposit < minDeposit) {
      return { error: `The deposit must be at least KES ${minDeposit.toLocaleString()}.`, status: 400 };
    }
    // Paying it all now is just a normal purchase.
    if (deposit < priced.total) {
      chargeNow = deposit;
      installment = true;
    }
  }
  const share = (full: number) => round2((full * chargeNow) / priced.total);

  const order: OrderData = {
    buyerName: String(buyerName).trim().slice(0, 120),
    // Lowercased so ticket lookup by email always finds it.
    buyerEmail: String(buyerEmail).toLowerCase().trim(),
    buyerWhatsapp: whatsappPhone,
    buyerPhone: mpesaPhone ?? whatsappPhone ?? '',
    totalAmount: chargeNow,
    items: priced.lines.map((l) => ({ ticketTierId: l.ticketTierId, quantity: l.quantity, unitPrice: l.unitPrice })),
    tenantId: tenant.id,
    eventId: event.id,
    subtotal: priced.subtotal,
    discountAmount: priced.discount || null,
    promoCodeId: promo?.id ?? null,
    platformFee: installment ? share(priced.fees) : priced.fees,
    promoterId: promoter?.id ?? null,
    promoterCommission: fullCommission === null ? null : installment ? share(fullCommission) : fullCommission,
    recoveredFromOrderId: resumed?.id ?? null,
    waitlistEntryId: offer?.id ?? null,
    groupBookingId: group?.id ?? null,
    ...(installment && {
      kind: 'installment_deposit',
      planTotal: priced.total,
      planCommissionTotal: fullCommission,
      planFeeTotal: priced.fees,
    }),
  };
  return { event, tenant, priced, chargeNow, order };
}
