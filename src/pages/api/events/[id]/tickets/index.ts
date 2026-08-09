// src/pages/api/events/[id]/tickets/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const generateTicketCode = () =>
  `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { id } = req.query; // event id
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid event id.' });

  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    const { status, ticketTierId } = req.query;

    const tickets = await prisma.ticket.findMany({
      where: {
        eventId: id,
        tenantId: session.tenantId,
        ...(typeof status === 'string' && { status: status as any }),
        ...(typeof ticketTierId === 'string' && { ticketTierId }),
      },
      include: { ticketTier: { select: { name: true, price: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: tickets });
  }

  if (req.method === 'POST') {
    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can issue tickets.' });
    }

    const { ticketTierId, buyerName, buyerEmail } = req.body;
    if (!ticketTierId || !buyerName || !buyerEmail) {
      return res.status(400).json({ error: 'ticketTierId, buyerName, and buyerEmail are required.' });
    }

    const tier = await prisma.ticketTier.findFirst({
      where: { id: ticketTierId, eventId: id },
    });
    if (!tier) return res.status(404).json({ error: 'Ticket tier not found.' });
    if (!tier.isActive) {
      return res.status(409).json({ error: 'This tier is not currently active for sale.' });
    }

    try {
      const ticket = await prisma.$transaction(async (tx) => {
        // Atomic compare-and-swap: only increments `sold` if it hasn't already
        // hit capacity at the moment of the write. This is what prevents two
        // concurrent requests from both grabbing the "last" spot in a tier.
        const claim = await tx.ticketTier.updateMany({
          where: { id: ticketTierId, sold: { lt: tier.capacity } },
          data: { sold: { increment: 1 } },
        });

        if (claim.count === 0) {
          throw new Error('SOLD_OUT');
        }

        return tx.ticket.create({
          data: {
            ticketCode: generateTicketCode(),
            status: 'active',
            buyerName: buyerName.trim(),
            buyerEmail: buyerEmail.trim(),
            tenantId: session.tenantId,
            eventId: id,
            ticketTierId,
          },
          include: { ticketTier: { select: { name: true, price: true } } },
        });
      });

      return res.status(201).json({ success: true, data: ticket });
    } catch (error: any) {
      if (error.message === 'SOLD_OUT') {
        return res.status(409).json({ error: 'This ticket tier is sold out.' });
      }
      // Extremely unlikely ticketCode collision — ask the client to retry.
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Ticket code collision, please try again.' });
      }
      console.error('CRITICAL_TICKET_CREATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}