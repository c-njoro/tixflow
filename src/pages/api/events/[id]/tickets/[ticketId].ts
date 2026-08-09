// src/pages/api/events/[id]/tickets/[ticketId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const RELEASES_CAPACITY_FROM = ['pending', 'active', 'scanned'];
const ALLOWED_STATUSES = ['pending', 'active', 'scanned', 'cancelled', 'refunded'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can update tickets.' });
  }

  const { id, ticketId } = req.query; // event id, ticket id
  if (typeof id !== 'string' || typeof ticketId !== 'string') {
    return res.status(400).json({ error: 'Invalid identifiers.' });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, eventId: id, tenantId: session.tenantId },
  });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { status } = req.body;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'A valid status is required.' });
  }

  const isReleasingCapacity =
    ['cancelled', 'refunded'].includes(status) && RELEASES_CAPACITY_FROM.includes(ticket.status);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: { status },
      });

      // Freeing the tier's capacity so someone else can claim that slot.
      if (isReleasingCapacity) {
        await tx.ticketTier.update({
          where: { id: ticket.ticketTierId },
          data: { sold: { decrement: 1 } },
        });
      }

      return updatedTicket;
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('CRITICAL_TICKET_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}