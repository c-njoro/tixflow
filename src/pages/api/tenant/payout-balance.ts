// src/pages/api/tenant/payout-balance.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/auth';
import { getTenantBalance } from '@/lib/payouts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const balance = await getTenantBalance(session.tenantId);
  return res.status(200).json({ success: true, data: balance });
}