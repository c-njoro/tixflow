// src/pages/api/tenant/promoters/index.ts
//
// GET  — the tenant's promoters with sales and commission figures.
// POST — add a promoter.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma, type Promoter } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { generatePromoterToken } from '@/lib/promoters';
import { listPromoters, parsePromoterInput } from '@/lib/promoterAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage promoters.' });

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: await listPromoters(session.tenantId) });
  }

  if (req.method === 'POST') {
    const parsed = await parsePromoterInput(req.body || {}, session.tenantId, false);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    try {
      await prisma.promoter.create({
        data: {
          ...(parsed.data as Required<Pick<Promoter, 'name' | 'phone' | 'code' | 'commissionType' | 'commissionValue'>>),
          email: parsed.data.email ?? null,
          eventId: parsed.data.eventId ?? null,
          tenantId: session.tenantId,
          accessToken: generatePromoterToken(),
        },
      });
      return res.status(201).json({ success: true, data: await listPromoters(session.tenantId) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ error: 'Another promoter already uses that link code.' });
      }
      console.error('CRITICAL_PROMOTER_CREATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
