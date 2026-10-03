// src/pages/api/tenant/payout/execute.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getTenantBalance, computePayoutSplit, getPayoutDestination } from '@/lib/payouts';
import { verifyOtpChallenge } from '@/lib/otp';

// Confirming the OTP only files the request — it does NOT move any money.
// The actual Daraja B2C/B2B call happens when a platform admin approves it
// from the platform-admin dashboard.
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

  const { challengeId, otp } = req.body;
  if (typeof challengeId !== 'string' || !otp) {
    return res.status(400).json({ error: 'challengeId and otp are required.' });
  }

  const verified = await verifyOtpChallenge({
    challengeId,
    code: String(otp),
    purpose: 'payout_request',
    tenantId: session.tenantId,
  });
  if (!verified.ok) return res.status(401).json({ error: verified.error });

  const amount = Number((verified.payload as { amount?: number } | null)?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'This request is invalid. Start over with a new amount.' });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const dest = getPayoutDestination(tenant);
  if (!dest) {
    return res.status(409).json({ error: 'Payout method is not configured correctly.' });
  }

  // Recompute fresh — never trust a balance figure carried over from the
  // OTP request step.
  const balance = await getTenantBalance(session.tenantId);
  if (amount > balance.outstandingBalance) {
    return res.status(409).json({
      error: 'Your balance has changed since this request was made — start over with a new amount.',
    });
  }

  const split = computePayoutSplit(amount);

  try {
    const payout = await prisma.payout.create({
      data: {
        tenantId: session.tenantId,
        amount,
        feePercent: split.feePercent,
        feeAmount: split.feeAmount,
        netAmount: split.netAmount,
        ...dest,
        status: 'pending_approval',
        initiatedBy: 'tenant',
      },
    });

    return res.status(200).json({ success: true, data: { payoutId: payout.id } });
  } catch (error) {
    console.error('CRITICAL_PAYOUT_EXECUTE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
