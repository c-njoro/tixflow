// src/pages/api/tenant/payout/request-otp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getTenantBalance, computePayoutSplit, getPayoutDestination } from '@/lib/payouts';
import { createOtpChallenge, maskEmail } from '@/lib/otp';
import { sendPayoutOtpEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can request a payout.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Each call sends an email — don't let it be used to spam the inbox.
  if (!rateLimit(res, `payout-otp:${session.tenantId}`, 5, 15 * 60_000)) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  if (!getPayoutDestination(tenant)) {
    return res.status(409).json({
      error: 'Your payout method is not fully set up yet. Complete your M-Pesa or bank details first.',
    });
  }

  const amount = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Enter a valid amount to withdraw.' });
  }

  const balance = await getTenantBalance(session.tenantId);
  if (balance.outstandingBalance <= 0) {
    return res.status(409).json({ error: 'There is no outstanding balance to pay out.' });
  }
  if (amount > balance.outstandingBalance) {
    return res.status(409).json({
      error: `You can withdraw at most KES ${balance.outstandingBalance.toLocaleString()}.`,
    });
  }

  const split = computePayoutSplit(amount);

  try {
    // The amount lives on the server-side challenge, so the amount that
    // gets filed is always the one the tenant confirmed by email.
    const { challengeId, code } = await createOtpChallenge({
      purpose: 'payout_request',
      tenantId: session.tenantId,
      userId: session.userId,
      payload: { amount },
    });

    await sendPayoutOtpEmail(session.email, code, {
      amount,
      feeAmount: split.feeAmount,
      netAmount: split.netAmount,
    });

    return res.status(200).json({
      success: true,
      data: {
        challengeId,
        maskedEmail: maskEmail(session.email),
        amount,
        ...split,
        outstandingBalance: balance.outstandingBalance,
      },
    });
  } catch (error) {
    console.error('CRITICAL_PAYOUT_OTP_EMAIL_ERROR:', error);
    return res.status(500).json({ error: 'Failed to send confirmation code. Please try again.' });
  }
}
