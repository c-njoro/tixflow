// src/pages/api/tenant/payout-settings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const PAYOUT_FIELDS = {
  isOnboarded: true,
  payoutMethod: true,
  payoutPhoneNumber: true,
  payoutBankName: true,
  payoutBankPaybill: true,
  payoutBankAccountName: true,
  payoutBankAccountNumber: true,
} as const;

// Accepts 07XXXXXXXX and 01XXXXXXXX — Safaricom's original and newer ranges.
const MPESA_PHONE_REGEX = /^0[17]\d{8}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can manage payout settings.' });
  }

  if (req.method === 'GET') {
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: PAYOUT_FIELDS,
    });
    return res.status(200).json({ success: true, data: tenant });
  }

  if (req.method === 'PATCH') {
    const {
      payoutMethod,
      payoutPhoneNumber,
      payoutBankName,
      payoutBankPaybill,
      payoutBankAccountName,
      payoutBankAccountNumber,
    } = req.body;

    if (!['mpesa', 'bank'].includes(payoutMethod)) {
      return res.status(400).json({ error: 'payoutMethod must be either "mpesa" or "bank".' });
    }

    if (payoutMethod === 'mpesa') {
      if (!payoutPhoneNumber || !MPESA_PHONE_REGEX.test(payoutPhoneNumber.trim())) {
        return res.status(400).json({
          error: 'A valid M-Pesa phone number is required (e.g. 0712345678).',
        });
      }
    }

    if (payoutMethod === 'bank') {
      if (!payoutBankName?.trim()) {
        return res.status(400).json({ error: 'Bank name is required.' });
      }
      if (!payoutBankPaybill?.trim()) {
        return res.status(400).json({
          error: "Your bank's M-Pesa paybill number is required — check it with your bank if you're unsure.",
        });
      }
      if (!payoutBankAccountName?.trim() || !payoutBankAccountNumber?.trim()) {
        return res.status(400).json({
          error: 'Account name and account number are both required.',
        });
      }
    }

    try {
      const updated = await prisma.tenant.update({
        where: { id: session.tenantId },
        data: {
          payoutMethod,
          // Clear out fields belonging to the method NOT selected, so stale
          // data from switching methods never lingers in the record.
          payoutPhoneNumber: payoutMethod === 'mpesa' ? payoutPhoneNumber.trim() : null,
          payoutBankName: payoutMethod === 'bank' ? payoutBankName.trim() : null,
          payoutBankPaybill: payoutMethod === 'bank' ? payoutBankPaybill.trim() : null,
          payoutBankAccountName: payoutMethod === 'bank' ? payoutBankAccountName.trim() : null,
          payoutBankAccountNumber: payoutMethod === 'bank' ? payoutBankAccountNumber.trim() : null,
          isOnboarded: true,
        },
        select: PAYOUT_FIELDS,
      });

      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error('CRITICAL_PAYOUT_SETTINGS_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
