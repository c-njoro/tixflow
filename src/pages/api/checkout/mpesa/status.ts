// src/pages/api/checkout/mpesa/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { safeEqual } from '@/lib/secrets';
import { reconcilePendingOrder, RECONCILE_MIN_AGE_MS } from '@/lib/orders';

// The buyer's page polls every few seconds — only actually ask Daraja about
// a given order this often, not on every poll.
const QUERY_INTERVAL_MS = 15_000;
const globalForStatus = globalThis as unknown as { __tixflowLastQuery?: Map<string, number> };
const lastQueried = globalForStatus.__tixflowLastQuery ?? new Map<string, number>();
globalForStatus.__tixflowLastQuery = lastQueried;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId, key } = req.query;
  if (typeof orderId !== 'string' || !/^[a-f0-9]{24}$/i.test(orderId) || typeof key !== 'string') {
    return res.status(400).json({ error: 'orderId and key are required.' });
  }

  let order = await prisma.pendingOrder.findUnique({ where: { id: orderId } });
  // Same response for "doesn't exist" and "wrong key" — don't confirm which
  // order ids are real.
  if (!order || !order.accessKey || !safeEqual(order.accessKey, key)) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  // Callback late or lost? Ask Safaricom directly so the buyer isn't stuck
  // on "waiting for payment" after they've actually paid.
  if (order.status === 'pending' && Date.now() - order.createdAt.getTime() > RECONCILE_MIN_AGE_MS) {
    const last = lastQueried.get(order.id) ?? 0;
    if (Date.now() - last > QUERY_INTERVAL_MS) {
      lastQueried.set(order.id, Date.now());
      try {
        await reconcilePendingOrder(order);
        order = (await prisma.pendingOrder.findUnique({ where: { id: orderId } }))!;
      } catch (error) {
        console.error('CRITICAL_ORDER_STATUS_RECONCILE_ERROR:', orderId, error);
      }
    }
  }
  if (order.status !== 'pending') lastQueried.delete(order.id);

  let tickets: { id: string; ticketCode: string; ticketTierId: string }[] = [];
  if (order.status === 'completed') {
    tickets = await prisma.ticket.findMany({
      where: { orderId: order.id },
      select: { id: true, ticketCode: true, ticketTierId: true },
    });
  }

  // A Lipa Pole Pole deposit or top-up: hand back the plan (and its secret
  // link) so the buyer's page can show progress — this request already
  // proved it holds the order's key.
  let installmentPlan = null;
  if (order.status === 'completed' && order.installmentPlanId) {
    const plan = await prisma.installmentPlan.findUnique({ where: { id: order.installmentPlanId } });
    if (plan) {
      installmentPlan = {
        id: plan.id,
        accessKey: plan.accessKey,
        status: plan.status,
        paidAmount: plan.paidAmount,
        totalAmount: plan.totalAmount,
        dueAt: plan.dueAt,
      };
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      status: order.status,
      failureReason: order.failureReason,
      tickets,
      installmentPlan,
    },
  });
}
