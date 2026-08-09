// src/pages/api/tickets/scan.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// Both admins and scanner_staff are allowed to scan — that's the entire
// purpose of the scanner_staff role, so there is no role check beyond
// "is this a valid session for this tenant" here.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { ticketCode, eventId } = req.body;
  if (!ticketCode || typeof ticketCode !== 'string') {
    return res.status(400).json({ error: 'ticketCode is required.' });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { ticketCode: ticketCode.trim(), tenantId: session.tenantId },
    include: {
      ticketTier: { select: { name: true } },
      event: { select: { id: true, title: true } },
    },
  });

  if (!ticket) {
    return res.status(404).json({ success: false, result: 'not_found', error: 'Ticket not found.' });
  }

  if (eventId && ticket.eventId !== eventId) {
    return res.status(400).json({
      success: false,
      result: 'wrong_event',
      error: `This ticket is for "${ticket.event.title}", not this event.`,
    });
  }

  if (ticket.status === 'scanned') {
    return res.status(409).json({
      success: false,
      result: 'already_scanned',
      error: 'This ticket has already been scanned.',
      data: {
        buyerName: ticket.buyerName,
        tierName: ticket.ticketTier.name,
        scannedAt: ticket.scannedAt,
      },
    });
  }

  if (ticket.status === 'cancelled') {
    return res.status(409).json({ success: false, result: 'cancelled', error: 'This ticket has been cancelled.' });
  }

  if (ticket.status === 'refunded') {
    return res.status(409).json({ success: false, result: 'refunded', error: 'This ticket has been refunded.' });
  }

  if (ticket.status === 'pending') {
    return res.status(409).json({ success: false, result: 'pending', error: 'This ticket has not been paid for yet.' });
  }

  // Only remaining state is 'active' — admit the ticket.
  try {
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'scanned', scannedAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      result: 'admitted',
      data: {
        buyerName: ticket.buyerName,
        buyerEmail: ticket.buyerEmail,
        tierName: ticket.ticketTier.name,
        eventTitle: ticket.event.title,
        scannedAt: updated.scannedAt,
      },
    });
  } catch (error) {
    console.error('CRITICAL_TICKET_SCAN_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}