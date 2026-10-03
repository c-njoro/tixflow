// src/pages/api/tenant/promoters/[promoterId]/payout-confirm.ts
//
// Step 2: the emailed code files the payout for platform-admin approval —
// exactly like a tenant's own payout, no money moves here. It pays the
// phone number confirmed in step 1, even if the promoter's number has
// been edited since.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getTenantBalance } from '@/lib/payouts';
import { computePromoterPayoutSplit, getPromoterStats } from '@/lib/promoters';
import { verifyOtpChallenge } from '@/lib/otp';
import { listPromoters } from '@/lib/promoterAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can pay promoters.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { challengeId, otp } = req.body || {};
  if (typeof challengeId !== 'string' || !otp) return res.status(400).json({ error: 'challengeId and otp are required.' });

  const verified = await verifyOtpChallenge({
    challengeId,
    code: String(otp),
    purpose: 'promoter_payout',
    tenantId: session.tenantId,
  });
  if (!verified.ok) return res.status(401).json({ error: verified.error });

  const payload = verified.payload as { promoterId?: string; amount?: number; phone?: string } | null;
  const amount = Number(payload?.amount);
  if (!payload?.promoterId || payload.promoterId !== req.query.promoterId || !payload.phone || !(amount > 0)) {
    return res.status(400).json({ error: 'This request is invalid. Start over.' });
  }

  const promoter = await prisma.promoter.findFirst({ where: { id: payload.promoterId, tenantId: session.tenantId } });
  if (!promoter) return res.status(404).json({ error: 'Promoter not found.' });

  // Re-check against fresh numbers — another payout may have been filed
  // since the code was sent.
  const owed = (await getPromoterStats(session.tenantId, [promoter.id])).get(promoter.id)?.owed ?? 0;
  const split = computePromoterPayoutSplit(amount);
  const balance = await getTenantBalance(session.tenantId);
  if (amount > owed || split.feeAmount > balance.outstandingBalance) {
    return res.status(409).json({ error: 'The amounts have changed since this code was sent — start over.' });
  }

  try {
    await prisma.payout.create({
      data: {
        tenantId: session.tenantId,
        promoterId: promoter.id,
        amount: split.amount,
        feePercent: split.feePercent,
        feeAmount: split.feeAmount,
        netAmount: split.netAmount,
        method: 'mpesa',
        destination: `Promoter commission — ${promoter.name} — M-Pesa: ${payload.phone}`,
        destPhoneNumber: payload.phone,
        destBankPaybill: null,
        destAccountNumber: null,
        status: 'pending_approval',
        initiatedBy: 'tenant',
        note: `Commission for promoter "${promoter.code}"`,
      },
    });
    return res.status(200).json({ success: true, data: await listPromoters(session.tenantId) });
  } catch (error) {
    console.error('CRITICAL_PROMOTER_PAYOUT_CREATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
