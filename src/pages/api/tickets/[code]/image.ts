// src/pages/api/tickets/[code]/image.ts
//
// The designed ticket card (JPEG) for one ticket. Public by ticket code,
// like /api/tickets/qr/[code] — the code is already the credential shown at
// the gate. Used by web pages, "download ticket" links and as the image
// Meta fetches for the WhatsApp Cloud API ticket template.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { loadTicketCards, renderTicketCard } from '@/lib/ticketImage';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  // Rendering costs real CPU — don't let one client hammer it.
  if (!rateLimit(res, `ticket-image:${getClientIp(req)}`, 60, 10 * 60_000)) return;

  const { code, download } = req.query;
  if (typeof code !== 'string' || code.length > 40) return res.status(400).json({ error: 'Invalid ticket code.' });

  const ticket = await prisma.ticket.findUnique({ where: { ticketCode: code }, select: { status: true } });
  if (!ticket || !['active', 'scanned'].includes(ticket.status)) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  try {
    const [card] = await loadTicketCards([code]);
    const image = await renderTicketCard(card);
    res.setHeader('Content-Type', image.contentType);
    // Short cache: the card reflects event edits (title, cover, time).
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="ticket-${code}.${image.extension}"`);
    return res.status(200).send(image.data);
  } catch (error) {
    console.error('CRITICAL_TICKET_IMAGE_ERROR:', code, error);
    return res.status(500).json({ error: 'Could not render this ticket.' });
  }
}
