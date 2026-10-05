// src/pages/api/events/[id]/refunds/index.ts
//
// GET — this event's refund requests, newest first, with the tickets.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage refunds.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true, title: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const refunds = await prisma.refundRequest.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } });
  const tickets = await prisma.ticket.findMany({
    where: { id: { in: refunds.flatMap((r) => r.ticketIds) } },
    select: { id: true, ticketCode: true, status: true, ticketTier: { select: { name: true } } },
  });
  return res.status(200).json({
    success: true,
    data: {
      title: event.title,
      refunds: refunds.map((r) => ({
        ...r,
        tickets: r.ticketIds.map((tid) => {
          const t = tickets.find((x) => x.id === tid);
          return { id: tid, ticketCode: t?.ticketCode ?? '—', status: t?.status ?? 'missing', tierName: t?.ticketTier.name ?? '' };
        }),
      })),
    },
  });
}
