// src/pages/api/tenant/payout-settings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { KENYA_BANK_CODES } from '@/lib/intasend';

const PAYOUT_FIELDS = {
  isOnboarded: true,
  payoutMethod: true,
  payoutPhoneNumber: true,
  payoutBankName: true,
  payoutBankCode: true,
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
    return res.status(200).json({ success: true, data: tenant, bankOptions: KENYA_BANK_CODES });
  }

  if (req.method === 'PATCH') {
    const {
      payoutMethod,
      payoutPhoneNumber,
      payoutBankCode,
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

    let bankName: string | null = null;
    if (payoutMethod === 'bank') {
      const bank = KENYA_BANK_CODES.find((b) => b.code === payoutBankCode);
      if (!bank) {
        return res.status(400).json({ error: 'Please select a valid bank from the list.' });
      }
      if (!payoutBankAccountName?.trim() || !payoutBankAccountNumber?.trim()) {
        return res.status(400).json({
          error: 'Account name and account number are both required.',
        });
      }
      bankName = bank.name;
    }

    try {
      const updated = await prisma.tenant.update({
        where: { id: session.tenantId },
        data: {
          payoutMethod,
          // Clear out fields belonging to the method NOT selected, so stale
          // data from switching methods never lingers in the record.
          payoutPhoneNumber: payoutMethod === 'mpesa' ? payoutPhoneNumber.trim() : null,
          payoutBankName: payoutMethod === 'bank' ? bankName : null,
          payoutBankCode: payoutMethod === 'bank' ? payoutBankCode : null,
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