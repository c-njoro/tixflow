// src/pages/api/tickets/lookup/transfer.ts
//
// A holder gives a ticket to someone else (src/lib/transfers.ts) — from the
// ticket page their magic link opened, which proves they own the email.
// { token, ticketId, name, email, whatsapp? }.
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyLookupToken } from '@/lib/ticketLookupAuth';
import { cleanNewHolder, transferTicket } from '@/lib/transfers';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `transfer:${getClientIp(req)}`, 20, 60 * 60_000)) return;

  const { token, ticketId } = req.body || {};
  const payload = typeof token === 'string' ? verifyLookupToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'This link has expired. Request a new one from the ticket lookup page.' });
  if (typeof ticketId !== 'string' || !/^[a-f0-9]{24}$/i.test(ticketId)) {
    return res.status(400).json({ error: 'Choose the ticket to give away.' });
  }
  const to = cleanNewHolder(req.body);
  if (typeof to === 'string') return res.status(400).json({ error: to });
  if (!rateLimit(res, `transfer-email:${payload.email}`, 10, 60 * 60_000)) return;

  try {
    const result = await transferTicket(payload.email, ticketId, to);
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({ success: true, data: { ticketCode: result.ticketCode, name: to.name, email: to.email } });
  } catch (error) {
    console.error('CRITICAL_TICKET_TRANSFER_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
