// src/pages/api/tenant/promoters/[promoterId]/payout-otp.ts
//
// Step 1 of paying a promoter: emails the admin a confirmation code for
// paying `amount` (at most what the promoter is owed).
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getTenantBalance } from '@/lib/payouts';
import { computePromoterPayoutSplit, getPromoterStats } from '@/lib/promoters';
import { createOtpChallenge, maskEmail } from '@/lib/otp';
import { sendPromoterPayoutOtpEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can pay promoters.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `promoter-payout-otp:${session.tenantId}`, 5, 15 * 60_000)) return;

  const { promoterId } = req.query;
  const promoter =
    typeof promoterId === 'string' && /^[a-f0-9]{24}$/i.test(promoterId)
      ? await prisma.promoter.findFirst({ where: { id: promoterId, tenantId: session.tenantId } })
      : null;
  if (!promoter) return res.status(404).json({ error: 'Promoter not found.' });

  const amount = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });

  const owed = (await getPromoterStats(session.tenantId, [promoter.id])).get(promoter.id)?.owed ?? 0;
  if (amount > owed) {
    return res.status(409).json({ error: `${promoter.name} is owed at most KES ${owed.toLocaleString()}.` });
  }
  // The commission itself is already held back from the tenant's balance;
  // the platform fee on top has to come out of what's left.
  const split = computePromoterPayoutSplit(amount);
  const balance = await getTenantBalance(session.tenantId);
  if (split.feeAmount > balance.outstandingBalance) {
    return res.status(409).json({
      error: `Your balance doesn't cover the KES ${split.feeAmount.toLocaleString()} payout fee yet.`,
    });
  }

  try {
    const { challengeId, code } = await createOtpChallenge({
      purpose: 'promoter_payout',
      tenantId: session.tenantId,
      userId: session.userId,
      payload: { promoterId: promoter.id, amount, phone: promoter.phone },
    });
    await sendPromoterPayoutOtpEmail(session.email, code, {
      promoterName: promoter.name,
      phone: promoter.phone,
      commission: split.netAmount,
      feeAmount: split.feeAmount,
      amount: split.amount,
    });
    return res.status(200).json({ success: true, data: { challengeId, maskedEmail: maskEmail(session.email), ...split } });
  } catch (error) {
    console.error('CRITICAL_PROMOTER_PAYOUT_OTP_ERROR:', error);
    return res.status(500).json({ error: 'Failed to send confirmation code. Please try again.' });
  }
}
