// src/pages/api/checkout/resume/index.ts
//
// GET ?t=<token> — the failed order behind a win-back link (see
// src/lib/checkoutRecovery.ts): its tickets, buyer details and promo code,
// so the event page can reopen checkout exactly as it was.
import type { NextApiRequest, NextApiResponse } from 'next';
import { resumeDetails } from '@/lib/checkoutRecovery';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `resume:ip:${getClientIp(req)}`, 30, 10 * 60_000)) return;
  const details = await resumeDetails(req.query.t);
  if (!details) return res.status(404).json({ error: 'This link has expired. Choose your tickets again below.' });
  return res.status(200).json({ success: true, data: details });
}
