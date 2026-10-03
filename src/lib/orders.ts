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
import { sendTicketWhatsapp } from './whatsapp';
import { sendSpaceInviteForOrder } from './spaceInvites';

const generateTicketCode = () => `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

// Don't query Daraja before the buyer has had a fair chance to enter their
// PIN — the callback normally arrives well within this window.
export const RECONCILE_MIN_AGE_MS = 45_000;
// After this long without any answer from Safaricom, give up on the order.
const EXPIRE_AFTER_MS = 24 * 60 * 60_000;
// An order whose STK push never got a CheckoutRequestID can't be paid.
const UNSTARTED_EXPIRE_MS = 10 * 60_000;

type CreatedTicket = { ticketCode: string; tierName: string };

// Issues tickets for a paid order. Safe to call from several places at
// once: the first step claims the order (pending → completed) inside the
// transaction, so only one caller can ever issue tickets for it.
export async function fulfillPaidOrder(
  orderId: string,
  mpesaReceiptNumber: string | null
): Promise<'fulfilled' | 'already_resolved'> {
  const result = await prisma.$transaction(
    async (tx) => {
      const claim = await tx.pendingOrder.updateMany({
        where: { id: orderId, status: 'pending' },
        data: { status: 'completed', ...(mpesaReceiptNumber && { mpesaReceiptNumber }) },
      });
      if (claim.count === 0) return null;

      const order = await tx.pendingOrder.findUniqueOrThrow({ where: { id: orderId } });
      const shortfalls: string[] = [];
      const createdTickets: CreatedTicket[] = [];

      // Each item's claim needs its tier's current capacity read first, then
      // an atomic conditional update against that literal number — Prisma's
      // updateMany can't compare two fields on the same document directly.
      for (const item of order.items) {
        const tier = await tx.ticketTier.findUnique({ where: { id: item.ticketTierId } });
        if (!tier) {
          shortfalls.push(`Ticket tier no longer exists (${item.quantity} tickets not issued).`);
          continue;
        }

        const tierClaim = await tx.ticketTier.updateMany({
          where: { id: item.ticketTierId, sold: { lte: tier.capacity - item.quantity } },
          data: { sold: { increment: item.quantity } },
        });

        if (tierClaim.count === 0) {
          // Money has already been captured by M-Pesa at this point. We
          // can't silently drop the ticket — flag it loudly for manual
          // follow-up (refund or manual seat allocation).
          shortfalls.push(`${item.quantity}x tier ${tier.name} sold out before this order could be fulfilled.`);
          continue;
        }

        for (let i = 0; i < item.quantity; i++) {
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
              ticketTierId: item.ticketTierId,
            },
          });
          createdTickets.push({ ticketCode, tierName: tier.name });
        }
      }

      if (shortfalls.length > 0) {
        await tx.pendingOrder.update({
          where: { id: order.id },
          data: { failureReason: shortfalls.join(' ') },
        });
      }

      return { order, createdTickets, shortfalls };
    },
    { timeout: 20_000 }
  );

  if (!result) return 'already_resolved';

  if (result.shortfalls.length > 0) {
    console.error('CRITICAL_MPESA_OVERSOLD_AFTER_PAYMENT:', orderId, result.shortfalls);
  }
  if (result.createdTickets.length > 0) {
    await deliverTickets(result.order, result.createdTickets);
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
      const result = await sendTicketWhatsapp({
        phone: order.buyerWhatsapp,
        buyerName: order.buyerName,
        eventTitle: event.title,
        eventDate: event.date,
        eventLocation: event.location,
        tickets,
      });
      whatsappStatus = result.success ? 'sent' : 'failed';
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
