// src/pages/api/tenant/payout/execute.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getTenantBalance } from '@/lib/payouts';
import { hashOtp, verifyOtpToken } from '@/lib/payoutOtp';
import { initiateMpesaPayout, initiateBankPayout } from '@/lib/intasend';

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

  const { token, otp } = req.body;
  if (!token || !otp) {
    return res.status(400).json({ error: 'token and otp are required.' });
  }

  const payload = verifyOtpToken(token);
  if (!payload || payload.tenantId !== session.tenantId) {
    return res.status(401).json({ error: 'This confirmation code has expired. Request a new one.' });
  }
  if (payload.otpHash !== hashOtp(otp)) {
    return res.status(401).json({ error: 'Incorrect code.' });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const isMpesa = tenant.payoutMethod === 'mpesa' && tenant.payoutPhoneNumber;
  const isBank = tenant.payoutMethod === 'bank' && tenant.payoutBankCode && tenant.payoutBankAccountNumber;

  if (!isMpesa && !isBank) {
    return res.status(409).json({ error: 'Payout method is not configured correctly.' });
  }

  // Recompute fresh — never trust a balance figure carried over from the
  // OTP request step.
  const balance = await getTenantBalance(session.tenantId);
  if (balance.outstandingBalance <= 0) {
    return res.status(409).json({ error: 'There is no outstanding balance to pay out.' });
  }

  try {
    const payout = await prisma.payout.create({
      data: {
        tenantId: session.tenantId,
        amount: balance.outstandingBalance,
        method: tenant.payoutMethod!,
        status: 'pending',
        initiatedBy: 'tenant',
      },
    });

    const narrative = `Tixflow payout - ${tenant.businessName}`;
    const result = isMpesa
      ? await initiateMpesaPayout({
          phoneNumber: tenant.payoutPhoneNumber!,
          accountName: tenant.businessName,
          amount: balance.outstandingBalance,
          narrative,
        })
      : await initiateBankPayout({
          accountName: tenant.payoutBankAccountName || tenant.businessName,
          accountNumber: tenant.payoutBankAccountNumber!,
          bankCode: tenant.payoutBankCode!,
          amount: balance.outstandingBalance,
          narrative,
        });

    if (!result.success) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'failed', failureReason: result.error },
      });
      return res.status(502).json({ error: result.error || 'Failed to initiate payout.' });
    }

    await prisma.payout.update({
      where: { id: payout.id },
      data: { intasendTrackingId: result.trackingId },
    });

    return res.status(200).json({ success: true, data: { payoutId: payout.id } });
  } catch (error) {
    console.error('CRITICAL_PAYOUT_EXECUTE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}