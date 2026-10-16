// src/pages/api/events/[id]/groups/index.ts
//
// GET — the event's group bookings (src/lib/groups.ts): who started each,
// how many seats are paid, and when unpaid seats are released.
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
  const event = await prisma.event.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, title: true, groupBookingEnabled: true, ticketTiers: { select: { id: true, name: true, price: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const now = new Date();
  const groups = await prisma.groupBooking.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } });
  // Starts nobody ever paid for aren't worth listing.
  const shown = groups.filter((g) => g.paidSeats > 0 || (g.status === 'pending' && g.expiresAt > now));
  const tier = (tierId: string) => event.ticketTiers.find((t) => t.id === tierId);
  return res.status(200).json({
    success: true,
    data: {
      title: event.title,
      groupBookingEnabled: event.groupBookingEnabled,
      groups: shown.map((g) => ({
        id: g.id,
        code: g.code,
        starter: g.leaderName,
        email: g.leaderEmail,
        whatsapp: g.leaderWhatsapp,
        tierName: tier(g.ticketTierId)?.name ?? 'Ticket',
        price: tier(g.ticketTierId)?.price ?? 0,
        size: g.size,
        paidSeats: Math.min(g.paidSeats, g.size),
        status: (g.status === 'pending' || g.status === 'open') && g.expiresAt <= now ? 'expired' : g.status,
        expiresAt: g.expiresAt,
        createdAt: g.createdAt,
      })),
    },
  });
}
