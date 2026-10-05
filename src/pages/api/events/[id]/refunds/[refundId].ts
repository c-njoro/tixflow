// src/pages/api/events/[id]/refunds/[refundId].ts
//
// POST { action: 'approve' | 'reject' | 'retry', note? }
//  approve — cancel the tickets and send the refund to Tixflow to pay out.
//  reject  — decline, with a note the buyer sees.
//  retry   — a payout that failed (wrong number, M-Pesa error): queue it again.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { approveRefund } from '@/lib/refunds';
import { normalizeKenyanPhone } from '@/lib/phone';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage refunds.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const { id, refundId } = req.query;
  if (typeof refundId !== 'string' || !/^[a-f0-9]{24}$/i.test(refundId)) return res.status(400).json({ error: 'Invalid refund id.' });
  const refund = await prisma.refundRequest.findFirst({ where: { id: refundId, eventId: String(id), tenantId: session.tenantId } });
  if (!refund) return res.status(404).json({ error: 'Refund request not found.' });

  const { action, note, refundPhone } = req.body || {};
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;

  try {
    if (action === 'approve') {
      const result = await approveRefund(refund.id, session.tenantId, session.userId, cleanNote);
      if ('error' in result) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ success: true, message: 'Approved — tickets cancelled and the refund sent to Tixflow to pay out.' });
    }

    if (action === 'reject') {
      if (!cleanNote) return res.status(400).json({ error: 'Add a note for the buyer explaining why.' });
      const done = await prisma.refundRequest.updateMany({
        where: { id: refund.id, status: 'requested' },
        data: { status: 'rejected', organiserNote: cleanNote, reviewedBy: session.userId, reviewedAt: new Date() },
      });
      if (done.count === 0) return res.status(409).json({ error: `This request is already ${refund.status}.` });
      return res.status(200).json({ success: true, message: 'Rejected.' });
    }

    if (action === 'retry') {
      if (refund.status !== 'failed') return res.status(409).json({ error: 'Only a failed refund can be retried.' });
      const phone = refundPhone ? normalizeKenyanPhone(refundPhone) : refund.refundPhone;
      if (!phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number.' });
      const payout = await prisma.payout.create({
        data: {
          tenantId: session.tenantId,
          amount: refund.amount,
          netAmount: refund.amount,
          feePercent: 0,
          feeAmount: 0,
          method: 'mpesa',
          status: 'pending_approval',
          initiatedBy: 'tenant',
          destination: `Refund to ${refund.buyerName} (M-Pesa ${phone})`,
          destPhoneNumber: phone,
          refundRequestId: refund.id,
          note: `Refund retry. Buyer: ${refund.reason}`.slice(0, 500),
        },
      });
      await prisma.refundRequest.update({
        where: { id: refund.id },
        data: { status: 'approved', payoutId: payout.id, refundPhone: phone },
      });
      return res.status(200).json({ success: true, message: 'Queued again for Tixflow to pay out.' });
    }

    return res.status(400).json({ error: 'action must be approve, reject or retry.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'REFUND_TICKETS_CHANGED') {
      return res.status(409).json({ error: 'One of these tickets was used or changed in the meantime — it can’t be refunded.' });
    }
    console.error('CRITICAL_REFUND_ACTION_ERROR:', refund.id, error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
