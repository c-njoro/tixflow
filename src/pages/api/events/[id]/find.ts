// src/pages/api/events/[id]/find.ts
//
// GET ?q=<name or code> — the gate's "find by name": tickets and guest
// passes for this event whose holder or code matches, for when someone has
// no QR code to show (guests on the door list, a dead phone).
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  if (q.length < 2) return res.status(200).json({ success: true, data: [] });

  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const tickets = await prisma.ticket.findMany({
    where: {
      eventId: event.id,
      status: { in: ['active', 'scanned'] },
      OR: [
        { buyerName: { contains: q, mode: 'insensitive' } },
        { ticketCode: { contains: q.toUpperCase() } },
      ],
    },
    take: 12,
    orderBy: { buyerName: 'asc' },
    select: { ticketCode: true, buyerName: true, status: true, isInside: true, orderId: true, ticketTier: { select: { name: true } } },
  });
  // Guests' group and note, for the person at the gate.
  const orderIds = [...new Set(tickets.map((t) => t.orderId).filter((o): o is string => !!o))];
  const guests = orderIds.length
    ? await prisma.guest.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, group: true, note: true } })
    : [];
  const guestByOrder = new Map(guests.map((g) => [g.orderId, g]));
  return res.status(200).json({
    success: true,
    data: tickets.map((t) => ({
      code: t.ticketCode,
      name: t.buyerName,
      tierName: t.ticketTier.name,
      used: t.status === 'scanned',
      inside: t.isInside,
      note: [guestByOrder.get(t.orderId ?? '')?.group, guestByOrder.get(t.orderId ?? '')?.note].filter(Boolean).join(' · ') || null,
    })),
  });
}
