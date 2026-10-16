// src/pages/api/public/waitlist/index.ts
//
// POST { eventId, ticketTierId, name, email, whatsapp?, quantity } — join
//      the waitlist for a sold-out ticket type (src/lib/waitlist.ts).
// GET  ?offer=<token> — the seats held for someone by a waitlist offer, so
//      the event page can open checkout with them.
import type { NextApiRequest, NextApiResponse } from 'next';
import { joinWaitlist, offerFromToken } from '@/lib/waitlist';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    if (!rateLimit(res, `waitlist-offer:ip:${getClientIp(req)}`, 30, 10 * 60_000)) return;
    const entry = await offerFromToken(req.query.offer);
    if (!entry) return res.status(404).json({ error: 'This offer has run out, and the tickets went to the next person in line.' });
    return res.status(200).json({
      success: true,
      data: {
        eventId: entry.eventId,
        ticketTierId: entry.ticketTierId,
        quantity: entry.quantity,
        name: entry.name,
        email: entry.email,
        whatsapp: entry.whatsapp,
        expiresAt: entry.offerExpiresAt,
      },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `waitlist-join:ip:${getClientIp(req)}`, 10, 10 * 60_000)) return;
  const result = await joinWaitlist(req.body || {});
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ success: true, data: { position: result.position } });
}
