// src/pages/api/tickets/lookup/refund.ts
//
// A buyer asks for a refund — from the ticket page their magic link opened,
// which proves they own the email. { token, ticketIds, reason, refundPhone }.
// The organiser reviews it (src/lib/refunds.ts).
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyLookupToken } from '@/lib/ticketLookupAuth';
import { createRefundRequest } from '@/lib/refunds';
import { normalizeKenyanPhone } from '@/lib/phone';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `refund:${getClientIp(req)}`, 10, 60 * 60_000)) return;

  const { token, ticketIds, reason, refundPhone } = req.body || {};
  const payload = typeof token === 'string' ? verifyLookupToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'This link has expired. Request a new one from the ticket lookup page.' });

  if (!Array.isArray(ticketIds) || ticketIds.length === 0 || ticketIds.length > 50 || !ticketIds.every((t) => typeof t === 'string' && /^[a-f0-9]{24}$/i.test(t))) {
    return res.status(400).json({ error: 'Choose the tickets to refund.' });
  }
  const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  if (why.length < 3) return res.status(400).json({ error: 'Tell the organiser why you need a refund.' });
  const phone = normalizeKenyanPhone(refundPhone);
  if (!phone) return res.status(400).json({ error: 'Enter the M-Pesa number to refund to (e.g. 0712345678).' });

  try {
    const result = await createRefundRequest({ email: payload.email, ticketIds: [...new Set(ticketIds)], reason: why, refundPhone: phone });
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({ success: true, data: { id: result.id, amount: result.amount, status: result.status } });
  } catch (error) {
    console.error('CRITICAL_REFUND_REQUEST_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
