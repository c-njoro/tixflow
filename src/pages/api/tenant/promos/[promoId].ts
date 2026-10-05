// src/pages/api/tenant/promos/[promoId].ts
//
// PATCH — edit a code (pause/resume, limits, dates).
// DELETE — remove a code that has never been used; used ones can only be paused.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parsePromoInput } from '@/lib/promoAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage promo codes.' });

  const { promoId } = req.query;
  const promo =
    typeof promoId === 'string' && /^[a-f0-9]{24}$/i.test(promoId)
      ? await prisma.promoCode.findFirst({ where: { id: promoId, tenantId: session.tenantId } })
      : null;
  if (!promo) return res.status(404).json({ error: 'Promo code not found.' });

  if (req.method === 'PATCH') {
    const parsed = await parsePromoInput(req.body || {}, session.tenantId, true);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      const updated = await prisma.promoCode.update({ where: { id: promo.id }, data: parsed.data });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ error: 'You already have a promo code with that name.' });
      }
      console.error('CRITICAL_PROMO_UPDATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  if (req.method === 'DELETE') {
    const used = promo.usedCount > 0 || (await prisma.pendingOrder.count({ where: { promoCodeId: promo.id } })) > 0;
    if (used) return res.status(409).json({ error: 'This code has been used — pause it instead.' });
    await prisma.promoCode.delete({ where: { id: promo.id } });
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', ['PATCH', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
