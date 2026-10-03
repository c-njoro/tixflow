// src/pages/api/cron/reconcile.ts
//
// Settles anything Daraja's callbacks left hanging. Run it every few
// minutes from a scheduler, e.g. crontab on the server:
//   */5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/reconcile
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSecret, safeEqual } from '@/lib/secrets';
import { reconcilePendingOrder, RECONCILE_MIN_AGE_MS } from '@/lib/orders';

// Keep each run short — anything left over is picked up next run.
const MAX_ORDERS_PER_RUN = 50;
// A payout still 'processing' after this long needs a human to check the
// M-Pesa portal (Daraja results normally arrive within a minute or two).
const STUCK_PAYOUT_AFTER_MS = 30 * 60_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const auth = req.headers.authorization || '';
  if (!safeEqual(auth, `Bearer ${getSecret('CRON_SECRET')}`)) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const orders = await prisma.pendingOrder.findMany({
    where: { status: 'pending', createdAt: { lt: new Date(Date.now() - RECONCILE_MIN_AGE_MS) } },
    orderBy: { createdAt: 'asc' },
    take: MAX_ORDERS_PER_RUN,
  });

  const summary = { checked: orders.length, completed: 0, failed: 0, stillPending: 0, errors: 0 };
  for (const order of orders) {
    try {
      const status = await reconcilePendingOrder(order);
      if (status === 'completed') summary.completed++;
      else if (status === 'failed') summary.failed++;
      else summary.stillPending++;
    } catch (error) {
      summary.errors++;
      console.error('CRITICAL_RECONCILE_ORDER_ERROR:', order.id, error);
    }
  }

  const stuckPayouts = await prisma.payout.count({
    where: { status: 'processing', approvedAt: { lt: new Date(Date.now() - STUCK_PAYOUT_AFTER_MS) } },
  });
  if (stuckPayouts > 0) {
    console.error('CRITICAL_PAYOUTS_STUCK_PROCESSING:', stuckPayouts);
  }

  return res.status(200).json({ success: true, data: { orders: summary, stuckPayouts } });
}
