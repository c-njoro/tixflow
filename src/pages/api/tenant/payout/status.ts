// src/pages/api/tenant/payout/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { checkPayoutStatus } from '@/lib/intasend';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
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

  // The Send Money Events webhook is the primary path for resolving this —
  // this is a convenience fallback for instant UI feedback while waiting,
  // and in case the webhook hasn't landed yet for some reason.
  if (payout.status === 'pending' && payout.intasendTrackingId) {
    try {
      const statusResponse = await checkPayoutStatus(payout.intasendTrackingId);
      const transaction = statusResponse?.transactions?.[0];

      if (transaction?.status === 'Successful') {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'completed', reference: transaction.provider_reference },
        });
        payout.status = 'completed';
        payout.reference = transaction.provider_reference;
      } else if (transaction && !['Successful', 'Processing', 'Pending'].includes(transaction.status)) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'failed', failureReason: transaction.status_description || transaction.status },
        });
        payout.status = 'failed';
        payout.failureReason = transaction.status_description || transaction.status;
      }
    } catch (error) {
      console.error('CRITICAL_INTASEND_STATUS_CHECK_ERROR:', error);
      // Don't fail the request over this — just report current known status.
    }
  }

  return res.status(200).json({
    success: true,
    data: { status: payout.status, reference: payout.reference, failureReason: payout.failureReason },
  });
}