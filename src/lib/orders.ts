// src/lib/orders.ts
//
// Everything that resolves a PendingOrder lives here, so the Daraja
// callback, the buyer's status poll and the reconcile cron all go through
// the same code — and the same race protection.
import crypto from 'crypto';
import type { PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import mpesaService from './mpesaService';
import { sendTicketConfirmationEmail } from './email';
import { sendTicketsWhatsapp } from './whatsappSender';
import { sendSpaceInviteForOrder } from './spaceInvites';
import { installmentDueAt, notifyPlanPayment, remindersAlreadyPast } from './installments';

const generateTicketCode = () => `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

// Don't query Daraja before the buyer has had a fair chance to enter their
// PIN — the callback normally arrives well within this window.
export const RECONCILE_MIN_AGE_MS = 45_000;
// After this long without any answer from Safaricom, give up on the order.
const EXPIRE_AFTER_MS = 24 * 60 * 60_000;
// An order whose STK push never got a CheckoutRequestID can't be paid.
const UNSTARTED_EXPIRE_MS = 10 * 60_000;

type CreatedTicket = { ticketCode: string; tierName: string };
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Items = PendingOrder['items'];

// Claims capacity for every item, atomically per tier. Returns the items
// that got seats (plus their tier names) and a note for any that didn't —
// money has already been captured by then, so a shortfall is flagged
// loudly for manual follow-up (refund or manual seat allocation).
async function reserveSeats(tx: Tx, items: Items) {
  const reserved: { ticketTierId: string; quantity: number; tierName: string }[] = [];
  const shortfalls: string[] = [];
  // Each item's claim needs its tier's current capacity read first, then
  // an atomic conditional update against that literal number — Prisma's
  // updateMany can't compare two fields on the same document directly.
  for (const item of items) {
    const tier = await tx.ticketTier.findUnique({ where: { id: item.ticketTierId } });
    if (!tier) {
      shortfalls.push(`Ticket tier no longer exists (${item.quantity} tickets not issued).`);
      continue;
    }
    const claim = await tx.ticketTier.updateMany({
      where: { id: item.ticketTierId, sold: { lte: tier.capacity - item.quantity } },
      data: { sold: { increment: item.quantity } },
    });
    if (claim.count === 0) {
      shortfalls.push(`${item.quantity}x tier ${tier.name} sold out before this order could be fulfilled.`);
      continue;
    }
    reserved.push({ ticketTierId: item.ticketTierId, quantity: item.quantity, tierName: tier.name });
  }
  return { reserved, shortfalls };
}

async function issueTickets(
  tx: Tx,
  order: PendingOrder,
  seats: { ticketTierId: string; quantity: number; tierName: string }[],
  mpesaReceiptNumber: string | null
) {
  const created: CreatedTicket[] = [];
  for (const seat of seats) {
    for (let i = 0; i < seat.quantity; i++) {
      const ticketCode = generateTicketCode();
      await tx.ticket.create({
        data: {
          ticketCode,
          status: 'active',
          buyerName: order.buyerName,
          buyerEmail: order.buyerEmail,
          mpesaReceiptNumber: mpesaReceiptNumber ?? order.mpesaReceiptNumber,
          orderId: order.id,
          tenantId: order.tenantId,
          eventId: order.eventId,
          ticketTierId: seat.ticketTierId,
        },
      });
      created.push({ ticketCode, tierName: seat.tierName });
    }
  }
  return created;
}

const PAYMENT_TOLERANCE = 0.5; // STK amounts are whole shillings

type Fulfilment =
  | { kind: 'tickets'; order: PendingOrder; tickets: CreatedTicket[]; shortfalls: string[] }
  | { kind: 'plan_started' | 'plan_payment'; order: PendingOrder; planId: string; shortfalls: string[] };

// Resolves a paid order. Safe to call from several places at once: the
// first step claims the order (pending → completed) inside the
// transaction, so only one caller ever acts on it.
//  - 'purchase': reserves seats and issues tickets.
//  - 'installment_deposit': reserves seats and starts a Lipa Pole Pole plan.
//  - 'installment_payment': adds to the plan; issues tickets once paid off.
export async function fulfillPaidOrder(
  orderId: string,
  mpesaReceiptNumber: string | null
): Promise<'fulfilled' | 'already_resolved'> {
  const result = await prisma.$transaction(
    async (tx): Promise<Fulfilment | null> => {
      const claim = await tx.pendingOrder.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { status: 'completed', ...(mpesaReceiptNumber && { mpesaReceiptNumber }) },
      });
      if (claim.count === 0) return null;

      const order = await tx.pendingOrder.findUniqueOrThrow({ where: { id: orderId } });
      const flag = async (shortfalls: string[]) => {
        if (shortfalls.length > 0) {
          await tx.pendingOrder.update({ where: { id: order.id }, data: { failureReason: shortfalls.join(' ') } });
        }
      };

      if (order.kind === 'installment_deposit') {
        const { reserved, shortfalls } = await reserveSeats(tx, order.items);
        if (reserved.length === 0) {
          await flag(shortfalls);
          return { kind: 'tickets', order, tickets: [], shortfalls };
        }
        // If only some items got seats, the plan covers just those.
        const fullyReserved = reserved.length === order.items.length;
        const planTotal = fullyReserved
          ? order.planTotal ?? order.totalAmount
          : reserved.reduce((sum, r) => {
              const item = order.items.find((i) => i.ticketTierId === r.ticketTierId)!;
              return sum + item.unitPrice * r.quantity;
            }, 0);
        const event = await tx.event.findUniqueOrThrow({ where: { id: order.eventId } });
        const dueAt = installmentDueAt(event);
        const plan = await tx.installmentPlan.create({
          data: {
            tenantId: order.tenantId,
            eventId: order.eventId,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            buyerPhone: order.buyerPhone,
            buyerWhatsapp: order.buyerWhatsapp,
            items: order.items.filter((i) => reserved.some((r) => r.ticketTierId === i.ticketTierId)),
            totalAmount: planTotal,
            paidAmount: order.totalAmount,
            dueAt,
            accessKey: crypto.randomBytes(24).toString('base64url'),
            promoterId: order.promoterId,
            planCommissionTotal: order.planCommissionTotal,
            remindersSent: remindersAlreadyPast(dueAt),
          },
        });
        await tx.pendingOrder.update({ where: { id: order.id }, data: { installmentPlanId: plan.id } });
        await flag(shortfalls);
        return { kind: 'plan_started', order, planId: plan.id, shortfalls };
      }

      if (order.kind === 'installment_payment' && order.installmentPlanId) {
        const plan = await tx.installmentPlan.findUnique({ where: { id: order.installmentPlanId } });
        if (!plan || plan.status !== 'active') {
          // Paid towards a plan that expired or was cancelled while the
          // buyer was entering their PIN. The money is in; a human decides.
          const note = [`Payment received for a plan that is ${plan?.status ?? 'missing'} — follow up with the buyer.`];
          await flag(note);
          return { kind: 'plan_payment', order, planId: order.installmentPlanId, shortfalls: note };
        }
        const paidAmount = Math.round((plan.paidAmount + order.totalAmount) * 100) / 100;
        const paidOff = paidAmount >= plan.totalAmount - PAYMENT_TOLERANCE;
        // Conditional on still being active with the amount we read, so two
        // payments landing at once can't both "complete" the plan.
        const updated = await tx.installmentPlan.updateMany({
          where: { id: plan.id, status: 'active', paidAmount: plan.paidAmount },
          data: { paidAmount, ...(paidOff && { status: 'completed', completedAt: new Date() }) },
        });
        // Lost a race with another payment: throwing rolls the whole transaction
        // back (this order goes back to 'pending'), and the callback retry or
        // the reconcile job processes it again against the fresh total.
        if (updated.count === 0) throw new Error('INSTALLMENT_PLAN_CONFLICT');
        if (!paidOff) return { kind: 'plan_payment', order, planId: plan.id, shortfalls: [] };

        // Seats were reserved by the deposit — issue against them directly.
        const tiers = await tx.ticketTier.findMany({ where: { id: { in: plan.items.map((i) => i.ticketTierId) } } });
        const seats = plan.items.map((i) => ({
          ticketTierId: i.ticketTierId,
          quantity: i.quantity,
          tierName: tiers.find((t) => t.id === i.ticketTierId)?.name ?? 'Ticket',
        }));
        const tickets = await issueTickets(tx, order, seats, mpesaReceiptNumber);
        return { kind: 'tickets', order, tickets, shortfalls: [] };
      }

      const { reserved, shortfalls } = await reserveSeats(tx, order.items);
      const tickets = await issueTickets(tx, order, reserved, mpesaReceiptNumber);
      await flag(shortfalls);
      return { kind: 'tickets', order, tickets, shortfalls };
    },
    { timeout: 20_000 }
  );

  if (!result) return 'already_resolved';

  if (result.shortfalls.length > 0) {
    console.error('CRITICAL_MPESA_OVERSOLD_AFTER_PAYMENT:', orderId, result.shortfalls);
  }
  if (result.kind === 'tickets' && result.tickets.length > 0) {
    await deliverTickets(result.order, result.tickets);
  }
  if (result.kind === 'plan_started' || result.kind === 'plan_payment') {
    notifyPlanPayment(result.planId, result.order).catch((error) =>
      console.error('CRITICAL_INSTALLMENT_NOTIFY_ERROR:', result.planId, error)
    );
  }
  return 'fulfilled';
}

// Only moves a still-pending order — never overwrites one that another
// caller already completed.
export async function failPendingOrder(orderId: string, reason: string) {
  await prisma.pendingOrder.updateMany({
    where: { id: orderId, status: 'pending' },
    data: { status: 'failed', failureReason: reason },
  });
}

async function deliverTickets(order: PendingOrder, tickets: CreatedTicket[]) {
  const event = await prisma.event.findUnique({
    where: { id: order.eventId },
    select: { title: true, date: true, location: true },
  });
  if (!event) return;

  try {
    await sendTicketConfirmationEmail({
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      eventTitle: event.title,
      eventDate: event.date,
      eventLocation: event.location,
      tickets,
    });
  } catch (emailError) {
    // The purchase itself already succeeded — a failed confirmation email
    // shouldn't undo that. The buyer can still retrieve tickets via /lookup.
    console.error('CRITICAL_TICKET_CONFIRMATION_EMAIL_ERROR:', emailError);
  }

  // WhatsApp is a convenience channel alongside email, never a replacement
  // for it — a failure here (including "not connected," which is expected
  // any time the unofficial session has dropped) never affects the order.
  if (order.buyerWhatsapp) {
    let whatsappStatus = 'failed';
    let whatsappError: string | null = null;
    try {
      const result = await sendTicketsWhatsapp({
        phone: order.buyerWhatsapp,
        buyerName: order.buyerName,
        eventTitle: event.title,
        eventDate: event.date,
        eventLocation: event.location,
        tickets,
      }, order.id);
      // 'queued' = waiting in the outbox for the connection to come back;
      // the outbox flips it to 'sent' once delivered.
      whatsappStatus = result.queued ? 'queued' : result.success ? 'sent' : 'failed';
      whatsappError = result.success ? null : result.error || null;
    } catch (error) {
      console.error('CRITICAL_TICKET_WHATSAPP_SEND_ERROR:', error);
      whatsappError = error instanceof Error ? error.message : 'Unknown error';
    }
    await prisma.pendingOrder
      .update({ where: { id: order.id }, data: { whatsappStatus, whatsappError } })
      .catch(() => {});
  }

  // Bought after the event's live space invites already went out — send
  // this buyer the link too. Not awaited: sends are deliberately spaced out
  // and the M-Pesa callback shouldn't wait on that.
  sendSpaceInviteForOrder(order, event.title).catch((error) =>
    console.error('CRITICAL_SPACE_INVITE_FOR_ORDER_ERROR:', order.id, error)
  );
}

// Resolves a pending order by asking Safaricom directly. Used when the
// callback is late or never arrives (it isn't guaranteed). Returns the
// order's status afterwards.
export async function reconcilePendingOrder(order: PendingOrder): Promise<PendingOrder['status']> {
  if (order.status !== 'pending') return order.status;
  const age = Date.now() - order.createdAt.getTime();

  if (!order.checkoutRequestId) {
    if (age > UNSTARTED_EXPIRE_MS) {
      await failPendingOrder(order.id, 'Payment was never started.');
      return 'failed';
    }
    return 'pending';
  }
  if (age < RECONCILE_MIN_AGE_MS) return 'pending';

  const query = await mpesaService.querySTKPush(order.checkoutRequestId);

  if (query.state === 'paid') {
    await fulfillPaidOrder(order.id, null);
    return 'completed';
  }
  if (query.state === 'failed') {
    await failPendingOrder(order.id, mpesaService.getResultCodeDescription(query.resultCode));
    return 'failed';
  }
  if (age > EXPIRE_AFTER_MS) {
    console.error('CRITICAL_ORDER_EXPIRED_UNRESOLVED:', order.id, query.error);
    await failPendingOrder(
      order.id,
      'Expired — no confirmation from M-Pesa. If the buyer was charged, verify on the M-Pesa portal.'
    );
    return 'failed';
  }
  return 'pending';
}
