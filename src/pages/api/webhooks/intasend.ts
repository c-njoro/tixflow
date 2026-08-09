// src/pages/api/webhooks/intasend.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  verifyWebhookChallenge,
  isCollectionEvent,
  isSendMoneyEvent,
  CollectionWebhookPayload,
  SendMoneyWebhookPayload,
} from '@/lib/intasend';
import { sendTicketConfirmationEmail } from '@/lib/email';

const generateTicketCode = () => `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const payload = req.body;

  if (!verifyWebhookChallenge(payload?.challenge)) {
    console.error('CRITICAL_INTASEND_WEBHOOK_INVALID_CHALLENGE:', JSON.stringify(payload));
    return res.status(401).json({ error: 'Invalid challenge.' });
  }

  try {
    if (isCollectionEvent(payload)) {
      await handleCollectionEvent(payload);
    } else if (isSendMoneyEvent(payload)) {
      await handleSendMoneyEvent(payload);
    } else {
      console.warn('[INTASEND] Unrecognized webhook payload shape:', JSON.stringify(payload));
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('CRITICAL_INTASEND_WEBHOOK_ERROR:', error);
    // 500 (not 200) here — this is our own failure, and returning 500 lets
    // IntaSend retry delivery so we get another chance to process it.
    return res.status(500).json({ error: 'Failed to process webhook.' });
  }
}

async function handleCollectionEvent(payload: CollectionWebhookPayload) {
  const order = await prisma.pendingOrder.findUnique({ where: { id: payload.api_ref } });
  if (!order) {
    console.error('CRITICAL_INTASEND_COLLECTION_ORDER_NOT_FOUND:', payload.api_ref);
    return;
  }

  // Idempotency — IntaSend redelivers events, and PROCESSING then COMPLETE
  // both arrive for the same transaction.
  if (order.status !== 'pending') return;

  if (payload.state === 'FAILED') {
    await prisma.pendingOrder.update({
      where: { id: order.id },
      data: { status: 'failed', failureReason: payload.failed_reason || 'Payment failed.' },
    });
    return;
  }

  if (payload.state !== 'COMPLETE') return; // PENDING/PROCESSING — wait for the next event

  const shortfalls: string[] = [];
  const createdTickets: { ticketCode: string; tierName: string }[] = [];

  // Each item's claim needs its tier's current capacity read first, then an
  // atomic conditional update against that literal number.
  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
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
        // Money has already been captured at this point — flag loudly for
        // manual follow-up rather than silently dropping the ticket.
        shortfalls.push(
          `${item.quantity}x tier ${tier.name} sold out before this order could be fulfilled.`
        );
        continue;
      }

      for (let i = 0; i < item.quantity; i++) {
        const newTicketCode = generateTicketCode();
        await tx.ticket.create({
          data: {
            ticketCode: newTicketCode,
            status: 'active',
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            mpesaReceiptNumber: payload.invoice_id, // closest available provider reference
            orderId: order.id,
            tenantId: order.tenantId,
            eventId: order.eventId,
            ticketTierId: item.ticketTierId,
          },
        });
        createdTickets.push({ ticketCode: newTicketCode, tierName: tier.name });
      }
    }

    await tx.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: 'completed',
        failureReason: shortfalls.length > 0 ? shortfalls.join(' ') : null,
      },
    });
  });

  if (shortfalls.length > 0) {
    console.error('CRITICAL_INTASEND_OVERSOLD_AFTER_PAYMENT:', order.id, shortfalls);
  }

  if (createdTickets.length > 0) {
    try {
      const event = await prisma.event.findUnique({
        where: { id: order.eventId },
        select: { title: true, date: true, location: true },
      });
      if (event) {
        await sendTicketConfirmationEmail({
          buyerName: order.buyerName,
          buyerEmail: order.buyerEmail,
          eventTitle: event.title,
          eventDate: event.date,
          eventLocation: event.location,
          tickets: createdTickets,
        });
      }
    } catch (emailError) {
      // The purchase already succeeded — a failed confirmation email
      // shouldn't undo that. The buyer can still use /lookup.
      console.error('CRITICAL_TICKET_CONFIRMATION_EMAIL_ERROR:', emailError);
    }
  }
}

async function handleSendMoneyEvent(payload: SendMoneyWebhookPayload) {
  const payout = await prisma.payout.findFirst({
    where: { intasendTrackingId: payload.tracking_id },
  });
  if (!payout) {
    console.error('CRITICAL_INTASEND_SEND_MONEY_PAYOUT_NOT_FOUND:', payload.tracking_id);
    return;
  }

  if (payout.status !== 'pending') return; // idempotency
  if (payload.status !== 'Completed') return; // batch still processing — wait

  const transaction = payload.transactions?.[0];
  if (!transaction) return;

  if (transaction.status === 'Successful') {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'completed', reference: transaction.provider_reference },
    });
  } else {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: 'failed',
        failureReason: transaction.status_description || transaction.status,
      },
    });
  }
}