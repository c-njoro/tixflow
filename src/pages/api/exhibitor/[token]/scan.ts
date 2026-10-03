// src/pages/api/exhibitor/[token]/scan.ts
//
// An exhibitor scans an attendee's ticket QR at their stand. The attendee
// shows their code to be scanned — that's the consent — and the exhibitor
// gets their name and email only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loadExhibitor } from '@/lib/exhibitors';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const exhibitor = await loadExhibitor(req, res);
  if (!exhibitor) return;
  // A real stand scans maybe a few a minute — this stops anyone using a
  // portal link to probe for ticket codes.
  if (!rateLimit(res, `exhibitor-scan:${exhibitor.id}`, 30, 60_000)) return;

  const code = typeof req.body?.ticketCode === 'string' ? req.body.ticketCode.trim().toUpperCase() : '';
  if (!code) return res.status(400).json({ error: 'Scan a ticket QR code.' });

  const ticket = await prisma.ticket.findUnique({ where: { ticketCode: code } });
  if (!ticket || ticket.eventId !== exhibitor.eventId || !['active', 'scanned'].includes(ticket.status)) {
    return res.status(404).json({ error: 'That isn’t a valid ticket for this event.' });
  }

  try {
    const lead = await prisma.exhibitorLead.create({
      data: {
        exhibitorId: exhibitor.id,
        eventId: exhibitor.eventId,
        ticketId: ticket.id,
        name: ticket.certificateName || ticket.buyerName,
        email: ticket.buyerEmail,
      },
    });
    return res.status(201).json({ success: true, data: { id: lead.id, name: lead.name, email: lead.email, duplicate: false } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.exhibitorLead.findUnique({
        where: { exhibitorId_ticketId: { exhibitorId: exhibitor.id, ticketId: ticket.id } },
      });
      return res.status(200).json({ success: true, data: { id: existing?.id, name: existing?.name, email: existing?.email, duplicate: true } });
    }
    console.error('CRITICAL_EXHIBITOR_SCAN_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
