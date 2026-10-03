// src/pages/api/platform-admin/payout-requests/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { initiateB2CPayment } from '@/lib/mpesaB2C';
import { initiateB2BPayment } from '@/lib/mpesaB2B';

type Action = 'approve' | 'reject' | 'mark_completed' | 'mark_failed';
const ACTIONS: Action[] = ['approve', 'reject', 'mark_completed', 'mark_failed'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid payout id.' });

  const { action, note, reference } = req.body as { action?: Action; note?: string; reference?: string };
  if (!action || !ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${ACTIONS.join(', ')}.` });
  }

  const payout = await prisma.payout.findUnique({ where: { id }, include: { tenant: true } });
  if (!payout) return res.status(404).json({ error: 'Payout request not found.' });

  // Manual resolution of a payout stuck in 'processing' — Safaricom's result
  // callback never came, or the send itself had an unclear outcome. The
  // admin checks the M-Pesa portal and records what actually happened.
  if (action === 'mark_completed' || action === 'mark_failed') {
    if (action === 'mark_completed' && !reference?.trim()) {
      return res.status(400).json({ error: 'Enter the M-Pesa transaction code as the reference.' });
    }
    const resolved = await prisma.payout.updateMany({
      where: { id, status: 'processing' },
      data:
        action === 'mark_completed'
          ? { status: 'completed', reference: reference!.trim(), note: note?.trim() || 'Confirmed manually by admin.' }
          : { status: 'failed', failureReason: note?.trim() || 'Marked failed manually by admin.' },
    });
    if (resolved.count === 0) {
      return res.status(409).json({ error: 'Only a payout that is still processing can be resolved manually.' });
    }
    const updated = await prisma.payout.findUnique({ where: { id } });
    return res.status(200).json({ success: true, data: updated });
  }

  if (action === 'reject') {
    const rejected = await prisma.payout.updateMany({
      where: { id, status: 'pending_approval' },
      data: {
        status: 'rejected',
        failureReason: note?.trim() || 'Rejected by admin.',
        approvedBy: session.username,
        approvedAt: new Date(),
      },
    });
    if (rejected.count === 0) {
      return res.status(409).json({ error: `This request is already ${payout.status.replace('_', ' ')}.` });
    }
    const updated = await prisma.payout.findUnique({ where: { id } });
    return res.status(200).json({ success: true, data: updated });
  }

  // action === 'approve' — this is the point where money actually moves.
  // Pay to the destination snapshotted at request time — the one shown to
  // the admin — never to whatever the tenant's settings say right now.
  const isMpesa = payout.method === 'mpesa';
  if (isMpesa ? !payout.destPhoneNumber : !payout.destBankPaybill || !payout.destAccountNumber) {
    return res.status(409).json({
      error: 'This request has no destination recorded (made before an update). Reject it and ask the tenant to request again.',
    });
  }

  // Claim the request first, atomically. A double click or two admins
  // approving at once: only one request wins the claim, so money is only
  // ever sent once.
  const claimed = await prisma.payout.updateMany({
    where: { id, status: 'pending_approval' },
    data: { status: 'processing', approvedBy: session.username, approvedAt: new Date() },
  });
  if (claimed.count === 0) {
    return res.status(409).json({ error: `This request is already ${payout.status.replace('_', ' ')}.` });
  }

  const narrative = (
    payout.promoterId
      ? `Tixflow promoter commission - ${payout.tenant.businessName}`
      : `Tixflow payout - ${payout.tenant.businessName}`
  ).slice(0, 100);
  const netAmount = payout.netAmount ?? payout.amount;

  const result = isMpesa
    ? await initiateB2CPayment({
        phoneNumber: payout.destPhoneNumber!,
        amount: netAmount,
        remarks: narrative,
        occasion: 'Payout',
      })
    : await initiateB2BPayment({
        paybillNumber: payout.destBankPaybill!,
        accountNumber: payout.destAccountNumber!,
        amount: netAmount,
        remarks: narrative,
      });

  try {
    if (!result.success) {
      // Unclear outcome (e.g. timeout after sending): keep it 'processing'
      // so the balance stays held, and let the admin resolve it manually
      // after checking the M-Pesa portal. Marking it failed here could lead
      // to paying the tenant twice.
      const updated = await prisma.payout.update({
        where: { id },
        data: result.uncertain
          ? { failureReason: result.error }
          : { status: 'failed', failureReason: result.error },
      });
      return res.status(502).json({ error: result.error || 'Failed to send payout.', data: updated });
    }

    const updated = await prisma.payout.update({
      where: { id },
      data: {
        conversationId: result.conversationId,
        originatorConversationId: result.originatorConversationId,
      },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    // Daraja accepted the request but we couldn't record its ids. The
    // payout stays 'processing' (balance held); the admin can resolve it.
    console.error('CRITICAL_PAYOUT_APPROVE_RECORD_ERROR:', id, result, error);
    return res.status(500).json({ error: 'Payout was sent but recording it failed — check it before retrying.' });
  }
}
