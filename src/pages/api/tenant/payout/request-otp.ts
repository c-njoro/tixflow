// src/pages/api/tenant/payout/request-otp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getTenantBalance } from '@/lib/payouts';
import { generateOtp, hashOtp, createOtpToken } from '@/lib/payoutOtp';
import { sendPayoutOtpEmail } from '@/lib/email';

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
};

function tenantHasValidPayoutMethod(tenant: {
  payoutMethod: string | null;
  payoutPhoneNumber: string | null;
  payoutBankCode: string | null;
  payoutBankAccountNumber: string | null;
}): boolean {
  if (tenant.payoutMethod === 'mpesa') return Boolean(tenant.payoutPhoneNumber);
  if (tenant.payoutMethod === 'bank') {
    return Boolean(tenant.payoutBankCode && tenant.payoutBankAccountNumber);
  }
  return false;
}

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

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  if (!tenantHasValidPayoutMethod(tenant)) {
    return res.status(409).json({
      error: 'Your payout method is not fully set up yet. Complete your M-Pesa or bank details first.',
    });
  }

  const balance = await getTenantBalance(session.tenantId);
  if (balance.outstandingBalance <= 0) {
    return res.status(409).json({ error: 'There is no outstanding balance to pay out.' });
  }

  const otp = generateOtp();
  const token = createOtpToken(session.tenantId, hashOtp(otp));

  try {
    await sendPayoutOtpEmail(session.email, otp);
  } catch (error) {
    console.error('CRITICAL_PAYOUT_OTP_EMAIL_ERROR:', error);
    return res.status(500).json({ error: 'Failed to send confirmation code. Please try again.' });
  }

  return res.status(200).json({
    success: true,
    data: { token, maskedEmail: maskEmail(session.email), outstandingBalance: balance.outstandingBalance },
  });
}