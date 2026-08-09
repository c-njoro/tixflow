// src/pages/api/tickets/qr/[code].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { code } = req.query;
  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid ticket code.' });
  }

  // Confirm the code corresponds to a real ticket before generating an
  // image — keeps this endpoint scoped to its actual purpose rather than
  // acting as a general-purpose QR generator for arbitrary strings.
  const ticket = await prisma.ticket.findUnique({ where: { ticketCode: code } });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  try {
    // Encodes the raw ticket code — the same string the check-in page's
    // manual input and /api/tickets/scan already expect, so a future
    // camera-based scanner needs zero new server-side handling.
    const pngBuffer = await QRCode.toBuffer(ticket.ticketCode, {
      type: 'png',
      width: 320,
      margin: 1,
    });

    res.setHeader('Content-Type', 'image/png');
    // Ticket codes are immutable once issued — safe to cache aggressively.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(pngBuffer);
  } catch (error) {
    console.error('CRITICAL_QR_GENERATION_ERROR:', error);
    return res.status(500).json({ error: 'Failed to generate QR code.' });
  }
}