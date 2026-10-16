// src/pages/api/public/groups/index.ts
//
// POST { eventId, ticketTierId, size, name, email, whatsapp? } — start a
// group booking (src/lib/groups.ts). Returns its code; the starter then
// pays for their own seat(s) through checkout with { group: code }.
import type { NextApiRequest, NextApiResponse } from 'next';
import { startGroup } from '@/lib/groups';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  // Each start holds seats for a while: don't let one visitor hold many.
  if (!rateLimit(res, `group-start:ip:${getClientIp(req)}`, 5, 30 * 60_000)) return;
  const result = await startGroup(req.body || {});
  if ('error' in result) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ success: true, data: { code: result.group.code } });
}
