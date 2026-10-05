// src/pages/api/tenant/promos/index.ts
//
// GET  ?eventId= — promo codes (that event's plus all-events ones) with sales.
// POST — create a code.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { listPromoCodes, parsePromoInput } from '@/lib/promoAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage promo codes.' });
  const eventId = typeof req.query.eventId === 'string' && /^[a-f0-9]{24}$/i.test(req.query.eventId) ? req.query.eventId : undefined;

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: await listPromoCodes(session.tenantId, eventId) });
  }

  if (req.method === 'POST') {
    const parsed = await parsePromoInput(req.body || {}, session.tenantId, false);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      await prisma.promoCode.create({
        data: {
          code: parsed.data.code!,
          discountType: parsed.data.discountType!,
          discountValue: parsed.data.discountValue!,
          eventId: parsed.data.eventId ?? null,
          tierIds: parsed.data.tierIds ?? [],
          maxUses: parsed.data.maxUses ?? null,
          startsAt: parsed.data.startsAt ?? null,
          endsAt: parsed.data.endsAt ?? null,
          promoterId: parsed.data.promoterId ?? null,
          tenantId: session.tenantId,
        },
      });
      return res.status(201).json({ success: true, data: await listPromoCodes(session.tenantId, eventId) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ error: 'You already have a promo code with that name.' });
      }
      console.error('CRITICAL_PROMO_CREATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
