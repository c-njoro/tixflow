// src/lib/installments.ts
//
// Lipa Pole Pole: pay for tickets in instalments. The deposit reserves
// seats and creates an InstallmentPlan (see fulfillPaidOrder in
// src/lib/orders.ts); the buyer tops up from their plan page; tickets are
// issued when it's paid off. Scheduled jobs here send reminders before
// the deadline and expire unpaid plans, releasing their seats.
import type { Event, InstallmentPlan, PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import { sendInstallmentEmail } from './email';
import { installmentExpiredMessage, installmentUpdateMessage } from './whatsappTemplates';
import { getAppUrl } from './mpesaCallbacks';
import { deliverMessage, recipientFromOrder } from './attendeeMessaging';

const DAY = 24 * 60 * 60_000;
// Reminders go out this long before the deadline (in order).
const REMINDER_OFFSETS = [7 * DAY, 3 * DAY, 1 * DAY];
// Smallest top-up accepted (or whatever is left, if less).
export const MIN_INSTALLMENT_PAYMENT = 50;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const installmentDueAt = (event: Pick<Event, 'date' | 'installmentDueDaysBefore'>) =>
  new Date(event.date.getTime() - event.installmentDueDaysBefore * DAY);

// Can a new plan still be started for this event?
export function installmentsOpen(event: Pick<Event, 'installmentsEnabled' | 'date' | 'installmentDueDaysBefore'>, now = new Date()) {
  // Leave at least a day between starting a plan and its deadline.
  return event.installmentsEnabled && installmentDueAt(event).getTime() - now.getTime() > DAY;
}

export const minimumDeposit = (event: Pick<Event, 'installmentMinDepositPercent'>, total: number) =>
  Math.max(Math.ceil((total * event.installmentMinDepositPercent) / 100), 1);

// A plan started 2 days before its deadline shouldn't fire the 7- and
// 3-day reminders immediately — count those as already past.
export const remindersAlreadyPast = (dueAt: Date, now = new Date()) =>
  REMINDER_OFFSETS.filter((offset) => dueAt.getTime() - now.getTime() <= offset).length;

export const planUrl = (plan: Pick<InstallmentPlan, 'id' | 'accessKey'>) =>
  `${getAppUrl()}/plan/${plan.id}?key=${encodeURIComponent(plan.accessKey)}`;

export const remainingAmount = (plan: Pick<InstallmentPlan, 'totalAmount' | 'paidAmount'>) =>
  round2(Math.max(plan.totalAmount - plan.paidAmount, 0));

// Each payment earns the promoter its share of the whole plan's commission.
export const commissionForPayment = (plan: Pick<InstallmentPlan, 'planCommissionTotal' | 'totalAmount'>, amount: number) =>
  plan.planCommissionTotal ? round2((plan.planCommissionTotal * amount) / plan.totalAmount) : null;

// …and carries its share of the whole plan's platform fee.
export const feeForPayment = (plan: Pick<InstallmentPlan, 'planFeeTotal' | 'totalAmount'>, amount: number) =>
  plan.planFeeTotal ? round2((plan.planFeeTotal * amount) / plan.totalAmount) : 0;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Gives back seats held by a plan that won't be completed.
async function releaseSeats(tx: Tx, items: InstallmentPlan['items']) {
  for (const item of items) {
    await tx.ticketTier.updateMany({
      where: { id: item.ticketTierId, sold: { gte: item.quantity } },
      data: { sold: { decrement: item.quantity } },
    });
  }
}

type Kind = 'started' | 'payment' | 'reminder' | 'expired';

async function messagePlan(plan: InstallmentPlan, kind: Kind) {
  const event = await prisma.event.findUnique({
    where: { id: plan.eventId },
    select: { title: true, tenant: { select: { businessName: true } } },
  });
  if (!event) return;
  const remaining = remainingAmount(plan);
  const url = planUrl(plan);
  const whatsapp =
    kind === 'expired'
      ? installmentExpiredMessage({
          name: plan.buyerName,
          eventTitle: event.title,
          organiser: event.tenant.businessName,
          paid: plan.paidAmount,
        })
      : installmentUpdateMessage({
          kind,
          name: plan.buyerName,
          eventTitle: event.title,
          paid: plan.paidAmount,
          total: plan.totalAmount,
          remaining,
          dueAt: plan.dueAt,
          planUrl: url,
        });
  await deliverMessage(
    recipientFromOrder(plan),
    {
      email: (to) =>
        sendInstallmentEmail({
          to,
          buyerName: plan.buyerName,
          eventTitle: event.title,
          paidAmount: plan.paidAmount,
          totalAmount: plan.totalAmount,
          dueAt: plan.dueAt,
          planUrl: url,
          kind,
          organiser: event.tenant.businessName,
        }),
      whatsapp,
    },
    'INSTALLMENT'
  );
}

// After a deposit or top-up. A payment that completes the plan isn't
// messaged here — the buyer gets their tickets instead.
export async function notifyPlanPayment(planId: string, order: PendingOrder) {
  const plan = await prisma.installmentPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.status !== 'active') return;
  await messagePlan(plan, order.kind === 'installment_deposit' ? 'started' : 'payment');
}

export async function sendDueInstallmentReminders(now = new Date()) {
  const plans = await prisma.installmentPlan.findMany({
    where: { status: 'active', remindersSent: { lt: REMINDER_OFFSETS.length }, dueAt: { gt: now } },
  });
  let sent = 0;
  for (const plan of plans) {
    if (plan.dueAt.getTime() - now.getTime() > REMINDER_OFFSETS[plan.remindersSent]) continue;
    // Claim this reminder so overlapping runs never send it twice; skip
    // straight past any thresholds that were missed (cron downtime).
    const claim = await prisma.installmentPlan.updateMany({
      where: { id: plan.id, remindersSent: plan.remindersSent, status: 'active' },
      data: { remindersSent: remindersAlreadyPast(plan.dueAt, now) },
    });
    if (claim.count === 0) continue;
    try {
      await messagePlan(plan, 'reminder');
      sent++;
    } catch (error) {
      console.error('CRITICAL_INSTALLMENT_REMINDER_ERROR:', plan.id, error);
    }
  }
  return { sent };
}

// Closes a plan and gives its seats back. Shared by expiry and the
// organiser's "cancel plan". Returns false if it was no longer active.
export async function closePlan(planId: string, status: 'expired' | 'cancelled') {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.installmentPlan.findUnique({ where: { id: planId } });
    if (!plan) return false;
    const closed = await tx.installmentPlan.updateMany({
      where: { id: planId, status: 'active' },
      data: { status, closedAt: new Date() },
    });
    if (closed.count === 0) return false;
    await releaseSeats(tx, plan.items);
    return true;
  });
}

export async function expireOverduePlans(now = new Date()) {
  const overdue = await prisma.installmentPlan.findMany({ where: { status: 'active', dueAt: { lte: now } } });
  let expired = 0;
  for (const plan of overdue) {
    try {
      // A payment still waiting on M-Pesa gets a grace period: it may yet
      // complete the plan.
      const inFlight = await prisma.pendingOrder.count({
        where: { installmentPlanId: plan.id, status: 'pending', createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } },
      });
      if (inFlight > 0) continue;
      if (await closePlan(plan.id, 'expired')) {
        expired++;
        await messagePlan({ ...plan, status: 'expired' }, 'expired');
      }
    } catch (error) {
      console.error('CRITICAL_INSTALLMENT_EXPIRE_ERROR:', plan.id, error);
    }
  }
  return { expired };
}

// Organiser moves the deadline. An expired or cancelled plan comes back to
// life only if its seats can be reserved again.
export async function extendPlan(planId: string, dueAt: Date) {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.installmentPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.status === 'completed') return { error: 'This plan is already paid off.' };

    if (plan.status !== 'active') {
      for (const item of plan.items) {
        const tier = await tx.ticketTier.findUnique({ where: { id: item.ticketTierId } });
        const claim = tier
          ? await tx.ticketTier.updateMany({
              where: { id: item.ticketTierId, sold: { lte: tier.capacity - item.quantity } },
              data: { sold: { increment: item.quantity } },
            })
          : { count: 0 };
        // Throwing rolls back seats claimed for earlier items.
        if (claim.count === 0) throw new PlanSeatsGoneError();
      }
    }
    await tx.installmentPlan.update({
      where: { id: plan.id },
      data: {
        dueAt,
        status: 'active',
        closedAt: null,
        remindersSent: remindersAlreadyPast(dueAt),
      },
    });
    return { ok: true };
  });
}

export class PlanSeatsGoneError extends Error {
  constructor() {
    super('Those seats have been sold to someone else since the plan closed.');
  }
}
