// src/pages/api/tenant/payout/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// The B2C/B2B result callbacks (src/pages/api/mpesa/b2c-result.ts and
// b2b-result.ts) are what actually update a payout's status — this route is
// just a read of whatever the DB currently says, for the tenant's UI to poll.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can view payout status.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { payoutId } = req.query;
  if (typeof payoutId !== 'string') {
    return res.status(400).json({ error: 'payoutId is required.' });
  }

  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, tenantId: session.tenantId },
  });
  if (!payout) return res.status(404).json({ error: 'Payout not found.' });

  return res.status(200).json({
    success: true,
    data: {
      status: payout.status,
      reference: payout.reference,
      failureReason: payout.failureReason,
      netAmount: payout.netAmount,
    },
  });
}
