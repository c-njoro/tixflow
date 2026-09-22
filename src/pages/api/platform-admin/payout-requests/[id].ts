// src/pages/api/platform-admin/payout-requests/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { initiateB2CPayment } from '@/lib/mpesaB2C';
import { initiateB2BPayment } from '@/lib/mpesaB2B';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid payout id.' });

  const { action, note } = req.body as { action?: string; note?: string };
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: 'action must be "approve" or "reject".' });
  }

  const payout = await prisma.payout.findUnique({ where: { id }, include: { tenant: true } });
  if (!payout) return res.status(404).json({ error: 'Payout request not found.' });
  if (payout.status !== 'pending_approval') {
    return res.status(409).json({ error: `This request is already ${payout.status.replace('_', ' ')}.` });
  }

  if (action === 'reject') {
    const updated = await prisma.payout.update({
      where: { id },
      data: {
        status: 'rejected',
        failureReason: note?.trim() || 'Rejected by admin.',
        approvedBy: session.username,
        approvedAt: new Date(),
      },
    });
    return res.status(200).json({ success: true, data: updated });
  }

  // action === 'approve' — this is the point where money actually moves.
  const tenant = payout.tenant;
  const narrative = `Tixflow payout - ${tenant.businessName}`.slice(0, 100);
  const netAmount = payout.netAmount ?? payout.amount;

  try {
    const result =
      payout.method === 'mpesa'
        ? await initiateB2CPayment({
            phoneNumber: tenant.payoutPhoneNumber!,
            amount: netAmount,
            remarks: narrative,
            occasion: 'Payout',
          })
        : await initiateB2BPayment({
            paybillNumber: tenant.payoutBankPaybill!,
            accountNumber: tenant.payoutBankAccountNumber!,
            amount: netAmount,
            remarks: narrative,
          });

    if (!result.success) {
      const updated = await prisma.payout.update({
        where: { id },
        data: {
          status: 'failed',
          failureReason: result.error,
          approvedBy: session.username,
          approvedAt: new Date(),
        },
      });
      return res.status(502).json({ error: result.error || 'Failed to send payout.', data: updated });
    }

    const updated = await prisma.payout.update({
      where: { id },
      data: {
        status: 'processing',
        conversationId: result.conversationId,
        originatorConversationId: result.originatorConversationId,
        approvedBy: session.username,
        approvedAt: new Date(),
      },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('CRITICAL_PAYOUT_APPROVE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
