// src/lib/refunds.ts
//
// Refunds: the buyer asks (from their ticket lookup page), the organiser
// approves or rejects, and the platform sends the money.
//
//  requested ──organiser──▶ rejected
//      │
//      └─organiser approves─▶ approved: tickets cancelled (seats back on
//         sale) and a Payout to the buyer's M-Pesa is queued for platform
//         admin approval, deducted from the organiser's balance.
//            ├─ admin sends it (B2C) ─▶ processing ─▶ completed (tickets 'refunded') | failed
//            └─ admin rejects it ─────▶ failed
//
// What's refunded is what was paid for the tickets themselves; the booking
// fee (when buyers pay it) is not refunded.
import type { Payout, RefundRequest, Ticket } from '@prisma/client';
import { prisma } from './prisma';
import { getTenantBalance } from './payouts';
import { sendPlatformAlertEmail } from './email';

const round2 = (n: number) => Math.round(n * 100) / 100;
// No refund requests once the event is this close (or past).
export const REFUND_CUTOFF_MS = 0;

export const OPEN_REFUND_STATUSES = ['requested', 'approved', 'processing'];

// What the buyer paid for each ticket (after any promo), by ticket id.
// Free / manual / box-office-cash tickets have nothing to refund online.
export async function refundableAmounts(tickets: Ticket[]) {
  const orderIds = [...new Set(tickets.map((t) => t.orderId).filter((x): x is string => !!x))];
  const orders = await prisma.pendingOrder.findMany({ where: { id: { in: orderIds } } });
  const planIds = orders.map((o) => o.installmentPlanId).filter((x): x is string => !!x);
  const plans = planIds.length ? await prisma.installmentPlan.findMany({ where: { id: { in: planIds } } }) : [];

  const amounts = new Map<string, number>();
  for (const ticket of tickets) {
    const order = orders.find((o) => o.id === ticket.orderId);
    if (!order || !['mpesa', 'card'].includes(order.paymentMethod)) {
      amounts.set(ticket.id, 0);
      continue;
    }
    const plan = order.installmentPlanId ? plans.find((p) => p.id === order.installmentPlanId) : null;
    const items = plan ? plan.items : order.items;
    amounts.set(ticket.id, items.find((i) => i.ticketTierId === ticket.ticketTierId)?.unitPrice ?? 0);
  }
  return amounts;
}

export type RefundCheck = { error: string; status: number };

// The buyer's request — checks the tickets are theirs, unused and not
// already being refunded.
export async function createRefundRequest({
  email,
  ticketIds,
  reason,
  refundPhone,
}: {
  email: string;
  ticketIds: string[];
  reason: string;
  refundPhone: string;
}): Promise<RefundRequest | RefundCheck> {
  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ticketIds }, buyerEmail: { equals: email, mode: 'insensitive' } },
    include: { event: { select: { id: true, title: true, date: true, tenantId: true } } },
  });
  if (tickets.length !== ticketIds.length) return { error: 'Some of those tickets aren’t yours.', status: 404 };
  const eventIds = new Set(tickets.map((t) => t.eventId));
  if (eventIds.size !== 1) return { error: 'Request refunds for one event at a time.', status: 400 };
  const event = tickets[0].event;
  if (event.date.getTime() - Date.now() < REFUND_CUTOFF_MS) {
    return { error: 'This event has already started — contact the organiser directly.', status: 409 };
  }
  const unusable = tickets.find((t) => t.status !== 'active');
  if (unusable) {
    return { error: `Ticket ${unusable.ticketCode} is ${unusable.status} and can’t be refunded.`, status: 409 };
  }
  const open = await prisma.refundRequest.findFirst({
    where: { ticketIds: { hasSome: ticketIds }, status: { in: OPEN_REFUND_STATUSES } },
  });
  if (open) return { error: 'A refund for some of these tickets is already in progress.', status: 409 };

  const amounts = await refundableAmounts(tickets);
  const amount = round2([...amounts.values()].reduce((n, a) => n + a, 0));
  if (amount <= 0) {
    return { error: 'These tickets weren’t paid for online, so there’s nothing to refund here — contact the organiser.', status: 409 };
  }

  return prisma.refundRequest.create({
    data: {
      tenantId: event.tenantId,
      eventId: event.id,
      orderId: tickets[0].orderId,
      ticketIds,
      buyerName: tickets[0].buyerName,
      buyerEmail: email.toLowerCase(),
      refundPhone,
      amount,
      reason,
    },
  });
}

// Organiser approves: cancel the tickets, release the seats, queue the
// payout. All or nothing.
export async function approveRefund(
  refundId: string,
  tenantId: string,
  userId: string,
  note: string | null
): Promise<{ payout: Payout } | RefundCheck> {
  const refund = await prisma.refundRequest.findFirst({ where: { id: refundId, tenantId } });
  if (!refund) return { error: 'Refund request not found.', status: 404 };
  if (refund.status !== 'requested') return { error: `This request is already ${refund.status}.`, status: 409 };

  const balance = await getTenantBalance(tenantId);
  if (balance.outstandingBalance < refund.amount) {
    return {
      error: `Your available balance (KES ${balance.outstandingBalance.toLocaleString()}) doesn’t cover this refund of KES ${refund.amount.toLocaleString()}.`,
      status: 409,
    };
  }
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { businessName: true } });

  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.refundRequest.updateMany({
      where: { id: refund.id, status: 'requested' },
      data: { status: 'approved', reviewedBy: userId, reviewedAt: new Date(), organiserNote: note },
    });
    if (claim.count === 0) return null;
    const cancelled = await tx.ticket.updateMany({
      where: { id: { in: refund.ticketIds }, status: 'active' },
      data: { status: 'cancelled', isInside: false },
    });
    // A ticket scanned in the meantime can't be refunded.
    if (cancelled.count !== refund.ticketIds.length) throw new Error('REFUND_TICKETS_CHANGED');
    const tickets = await tx.ticket.findMany({
      where: { id: { in: refund.ticketIds } },
      select: { ticketTierId: true, orderId: true },
    });
    // A promo code's use comes back with the refund.
    const orders = await tx.pendingOrder.findMany({
      where: { id: { in: [...new Set(tickets.map((t) => t.orderId).filter((x): x is string => !!x))] } },
      select: { id: true, promoCodeId: true },
    });
    for (const order of orders) {
      const uses = tickets.filter((t) => t.orderId === order.id).length;
      if (order.promoCodeId) {
        await tx.promoCode.updateMany({ where: { id: order.promoCodeId, usedCount: { gte: uses } }, data: { usedCount: { decrement: uses } } });
      }
    }
    for (const t of tickets) {
      await tx.ticketTier.updateMany({ where: { id: t.ticketTierId, sold: { gte: 1 } }, data: { sold: { decrement: 1 } } });
    }
    const payout = await tx.payout.create({
      data: {
        tenantId,
        amount: refund.amount,
        netAmount: refund.amount,
        feePercent: 0,
        feeAmount: 0,
        method: 'mpesa',
        status: 'pending_approval',
        initiatedBy: 'tenant',
        destination: `Refund to ${refund.buyerName} (M-Pesa ${refund.refundPhone})`,
        destPhoneNumber: refund.refundPhone,
        refundRequestId: refund.id,
        note: `Refund for ${refund.ticketIds.length} ticket(s). Buyer: ${refund.reason}`.slice(0, 500),
      },
    });
    await tx.refundRequest.update({ where: { id: refund.id }, data: { payoutId: payout.id } });
    return payout;
  });
  if (!result) return { error: 'This request was just handled.', status: 409 };

  sendPlatformAlertEmail(
    `Refund to send: ${tenant.businessName}`,
    `${tenant.businessName} approved a refund of KES ${refund.amount.toLocaleString()} to ${refund.buyerName} (${refund.refundPhone}). Approve it in platform admin → payout requests.`
  ).catch(() => {});
  return { payout: result };
}

// Keeps a refund in step with its payout (called whenever a payout changes).
export async function syncRefundFromPayout(payout: Pick<Payout, 'id' | 'status' | 'refundRequestId' | 'failureReason'>) {
  if (!payout.refundRequestId) return;
  const refund = await prisma.refundRequest.findUnique({ where: { id: payout.refundRequestId } });
  if (!refund || refund.status === 'completed') return;

  if (payout.status === 'processing') {
    await prisma.refundRequest.update({ where: { id: refund.id }, data: { status: 'processing' } });
  } else if (payout.status === 'completed') {
    await prisma.$transaction([
      prisma.refundRequest.update({ where: { id: refund.id }, data: { status: 'completed', completedAt: new Date() } }),
      prisma.ticket.updateMany({ where: { id: { in: refund.ticketIds } }, data: { status: 'refunded' } }),
    ]);
  } else if (payout.status === 'failed' || payout.status === 'rejected') {
    await prisma.refundRequest.update({
      where: { id: refund.id },
      data: { status: 'failed', organiserNote: payout.failureReason ?? refund.organiserNote },
    });
  }
}
