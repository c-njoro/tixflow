// src/pages/api/events/[id]/installments/[planId].ts
//
// POST { action: 'extend', dueAt } — move the deadline (reopens an expired
//        or cancelled plan if its seats are still available).
// POST { action: 'cancel' }        — close the plan and release its seats.
//        Money already paid stays in the balance; refund it outside the app.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { closePlan, extendPlan, PlanSeatsGoneError } from '@/lib/installments';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage instalments.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id, planId } = req.query;
  const plan =
    typeof planId === 'string' && /^[a-f0-9]{24}$/i.test(planId)
      ? await prisma.installmentPlan.findFirst({ where: { id: planId, eventId: String(id), tenantId: session.tenantId } })
      : null;
  if (!plan) return res.status(404).json({ error: 'Plan not found.' });

  const { action, dueAt } = req.body || {};
  if (action === 'cancel') {
    if (!(await closePlan(plan.id, 'cancelled'))) return res.status(409).json({ error: `This plan is already ${plan.status}.` });
    return res.status(200).json({ success: true });
  }

  if (action === 'extend') {
    const event = await prisma.event.findUnique({ where: { id: plan.eventId }, select: { date: true } });
    const newDue = new Date(dueAt);
    if (Number.isNaN(newDue.getTime()) || newDue.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Pick a new deadline in the future.' });
    }
    if (event && newDue > event.date) return res.status(400).json({ error: 'The deadline cannot be after the event starts.' });
    try {
      const result = await extendPlan(plan.id, newDue);
      if ('error' in result) return res.status(409).json({ error: result.error });
      return res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof PlanSeatsGoneError) return res.status(409).json({ error: error.message });
      console.error('CRITICAL_INSTALLMENT_EXTEND_ERROR:', plan.id, error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
