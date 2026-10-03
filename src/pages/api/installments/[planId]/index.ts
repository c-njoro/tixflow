// src/pages/api/installments/[planId]/index.ts
//
// The buyer's view of their Lipa Pole Pole plan. Authorised by the secret
// key in their plan link — the plan id alone is a guessable ObjectId.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { safeEqual } from '@/lib/secrets';
import { MIN_INSTALLMENT_PAYMENT, remainingAmount } from '@/lib/installments';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { planId, key } = req.query;
  const plan =
    typeof planId === 'string' && /^[a-f0-9]{24}$/i.test(planId)
      ? await prisma.installmentPlan.findUnique({ where: { id: planId } })
      : null;
  if (!plan || typeof key !== 'string' || !safeEqual(plan.accessKey, key)) {
    return res.status(404).json({ error: 'Plan not found.' });
  }

  const [event, payments, tiers] = await Promise.all([
    prisma.event.findUnique({
      where: { id: plan.eventId },
      select: { title: true, date: true, location: true, coverImageUrl: true, tenant: { select: { businessName: true } } },
    }),
    prisma.pendingOrder.findMany({
      where: { installmentPlanId: plan.id, status: 'completed' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, totalAmount: true, createdAt: true, mpesaReceiptNumber: true },
    }),
    prisma.ticketTier.findMany({ where: { id: { in: plan.items.map((i) => i.ticketTierId) } }, select: { id: true, name: true } }),
  ]);
  const tickets =
    plan.status === 'completed'
      ? await prisma.ticket.findMany({
          where: { orderId: { in: payments.map((p) => p.id) } },
          select: { ticketCode: true, ticketTierId: true },
        })
      : [];
  const remaining = remainingAmount(plan);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    success: true,
    data: {
      status: plan.status,
      buyerName: plan.buyerName,
      buyerPhone: plan.buyerPhone,
      totalAmount: plan.totalAmount,
      paidAmount: plan.paidAmount,
      remaining,
      minPayment: Math.min(MIN_INSTALLMENT_PAYMENT, remaining),
      dueAt: plan.dueAt,
      event: event && { title: event.title, date: event.date, location: event.location, organiser: event.tenant.businessName },
      items: plan.items.map((i) => ({ name: tiers.find((t) => t.id === i.ticketTierId)?.name ?? 'Ticket', quantity: i.quantity })),
      payments: payments.map((p) => ({ amount: p.totalAmount, at: p.createdAt, receipt: p.mpesaReceiptNumber })),
      tickets: tickets.map((t) => ({ ticketCode: t.ticketCode, tierName: tiers.find((x) => x.id === t.ticketTierId)?.name ?? 'Ticket' })),
    },
  });
}
