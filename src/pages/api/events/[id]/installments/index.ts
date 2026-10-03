// src/pages/api/events/[id]/installments/index.ts
//
// GET   — Lipa Pole Pole settings and every plan for the event.
// PATCH — change the settings (admin only). Existing plans keep their
//         deadline; only new plans use the new rules.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { installmentDueAt, installmentsOpen, planUrl, remainingAmount } from '@/lib/installments';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage instalments.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  let event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'PATCH') {
    const { installmentsEnabled, minDepositPercent, dueDaysBefore } = req.body || {};
    const data: Record<string, unknown> = {};
    if (typeof installmentsEnabled === 'boolean') data.installmentsEnabled = installmentsEnabled;
    if (minDepositPercent !== undefined) {
      const v = Number(minDepositPercent);
      if (!Number.isInteger(v) || v < 5 || v > 90) return res.status(400).json({ error: 'Minimum deposit must be 5–90%.' });
      data.installmentMinDepositPercent = v;
    }
    if (dueDaysBefore !== undefined) {
      const v = Number(dueDaysBefore);
      if (!Number.isInteger(v) || v < 0 || v > 60) return res.status(400).json({ error: 'Due date must be 0–60 days before the event.' });
      data.installmentDueDaysBefore = v;
    }
    event = await prisma.event.update({ where: { id: event.id }, data });
  } else if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const plans = await prisma.installmentPlan.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } });
  const tiers = await prisma.ticketTier.findMany({ where: { eventId: event.id }, select: { id: true, name: true } });
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));

  const active = plans.filter((p) => p.status === 'active');
  return res.status(200).json({
    success: true,
    data: {
      settings: {
        installmentsEnabled: event.installmentsEnabled,
        minDepositPercent: event.installmentMinDepositPercent,
        dueDaysBefore: event.installmentDueDaysBefore,
        dueAt: installmentDueAt(event),
        openForNewPlans: installmentsOpen(event),
      },
      totals: {
        active: active.length,
        completed: plans.filter((p) => p.status === 'completed').length,
        collected: Math.round(plans.reduce((sum, p) => sum + p.paidAmount, 0) * 100) / 100,
        outstanding: Math.round(active.reduce((sum, p) => sum + remainingAmount(p), 0) * 100) / 100,
        seatsHeld: active.reduce((sum, p) => sum + p.items.reduce((n, i) => n + i.quantity, 0), 0),
      },
      plans: plans.map((p) => ({
        id: p.id,
        buyerName: p.buyerName,
        buyerEmail: p.buyerEmail,
        buyerPhone: p.buyerPhone,
        status: p.status,
        totalAmount: p.totalAmount,
        paidAmount: p.paidAmount,
        remaining: remainingAmount(p),
        dueAt: p.dueAt,
        createdAt: p.createdAt,
        items: p.items.map((i) => `${i.quantity}× ${tierName.get(i.ticketTierId) ?? 'Ticket'}`).join(', '),
        // The organiser can resend this to a buyer who lost it.
        planUrl: planUrl(p),
      })),
    },
  });
}
