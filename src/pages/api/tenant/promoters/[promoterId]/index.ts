// src/pages/api/tenant/promoters/[promoterId]/index.ts
//
// PATCH — edit a promoter (rate changes only affect future sales).
// DELETE — remove a promoter with no sales; one with sales can only be
// deactivated, so their sales history and commission stay accounted for.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { listPromoters, parsePromoterInput } from '@/lib/promoterAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage promoters.' });
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { promoterId } = req.query;
  const promoter =
    typeof promoterId === 'string' && /^[a-f0-9]{24}$/i.test(promoterId)
      ? await prisma.promoter.findFirst({ where: { id: promoterId, tenantId: session.tenantId } })
      : null;
  if (!promoter) return res.status(404).json({ error: 'Promoter not found.' });

  if (req.method === 'DELETE') {
    const [orders, payouts] = await Promise.all([
      prisma.pendingOrder.count({ where: { promoterId: promoter.id } }),
      prisma.payout.count({ where: { promoterId: promoter.id } }),
    ]);
    if (orders > 0 || payouts > 0) {
      return res.status(409).json({ error: 'This promoter has sales on record — deactivate them instead.' });
    }
    await prisma.promoter.delete({ where: { id: promoter.id } });
    return res.status(200).json({ success: true, data: await listPromoters(session.tenantId) });
  }

  const parsed = await parsePromoterInput(req.body || {}, session.tenantId, true);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  try {
    await prisma.promoter.update({ where: { id: promoter.id }, data: parsed.data });
    return res.status(200).json({ success: true, data: await listPromoters(session.tenantId) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'Another promoter already uses that link code.' });
    }
    console.error('CRITICAL_PROMOTER_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
