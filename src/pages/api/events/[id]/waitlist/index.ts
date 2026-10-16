// src/pages/api/events/[id]/waitlist/index.ts
//
// GET    — the event's waitlist: everyone in line per ticket type, and
//          what happened to offers (src/lib/waitlist.ts).
// POST   — { action: 'process' }: offer any free seats now (admins).
// DELETE — ?entryId=: take someone off the list (admins).
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { processWaitlist } from '@/lib/waitlist';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, title: true, waitlistEnabled: true, ticketTiers: { where: { isGuestList: false }, select: { id: true, name: true, capacity: true, sold: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    const entries = await prisma.waitlistEntry.findMany({
      where: { eventId: event.id, status: { not: 'removed' } },
      orderBy: { createdAt: 'asc' },
    });
    return res.status(200).json({
      success: true,
      data: {
        title: event.title,
        waitlistEnabled: event.waitlistEnabled,
        tiers: event.ticketTiers,
        entries: entries.map((e) => ({
          id: e.id,
          name: e.name,
          email: e.email,
          whatsapp: e.whatsapp,
          quantity: e.quantity,
          ticketTierId: e.ticketTierId,
          // An offer past its time counts as expired even before the scheduler marks it.
          status: e.status === 'offered' && e.offerExpiresAt && e.offerExpiresAt <= new Date() ? 'expired' : e.status,
          offeredAt: e.offeredAt,
          offerExpiresAt: e.offerExpiresAt,
          createdAt: e.createdAt,
        })),
      },
    });
  }

  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can change the waitlist.' });

  if (req.method === 'POST' && req.body?.action === 'process') {
    const result = await processWaitlist(event.id);
    return res.status(200).json({ success: true, data: result });
  }

  if (req.method === 'DELETE') {
    const entryId = req.query.entryId;
    if (typeof entryId !== 'string' || !/^[a-f0-9]{24}$/i.test(entryId)) return res.status(400).json({ error: 'Invalid entry.' });
    const removed = await prisma.waitlistEntry.updateMany({
      where: { id: entryId, eventId: event.id, status: { in: ['waiting', 'offered'] } },
      data: { status: 'removed' },
    });
    if (removed.count === 0) return res.status(404).json({ error: 'They are no longer waiting.' });
    // Their held seats (if any) go to the next person.
    processWaitlist(event.id).catch((error) => console.error('CRITICAL_WAITLIST_PROCESS_ERROR:', event.id, error));
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
