// src/pages/api/tenant/payout-settings.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getPayoutDestination } from '@/lib/payouts';
import { createOtpChallenge, verifyOtpChallenge, maskEmail } from '@/lib/otp';
import { sendPayoutSettingsOtpEmail, sendPayoutSettingsChangedEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rateLimit';
import { normalizeKenyanPhone } from '@/lib/phone';

const PAYOUT_FIELDS = {
  isOnboarded: true,
  payoutMethod: true,
  payoutPhoneNumber: true,
  payoutBankName: true,
  payoutBankPaybill: true,
  payoutBankAccountName: true,
  payoutBankAccountNumber: true,
} as const;


interface PayoutDetails {
  payoutMethod: 'mpesa' | 'bank';
  payoutPhoneNumber: string | null;
  payoutBankName: string | null;
  payoutBankPaybill: string | null;
  payoutBankAccountName: string | null;
  payoutBankAccountNumber: string | null;
}

// Validates the submitted form and returns the exact record to save — with
// fields belonging to the method NOT selected cleared out, so stale data
// from switching methods never lingers.
function parseDetails(body: unknown): { details: PayoutDetails } | { error: string } {
  const {
    payoutMethod,
    payoutPhoneNumber,
    payoutBankName,
    payoutBankPaybill,
    payoutBankAccountName,
    payoutBankAccountNumber,
  } = (body ?? {}) as Record<string, unknown>;

  if (payoutMethod === 'mpesa') {
    const phone = normalizeKenyanPhone(payoutPhoneNumber);
    if (!phone) {
      return { error: 'A valid M-Pesa phone number is required (e.g. 0712345678).' };
    }
    return {
      details: {
        payoutMethod,
        payoutPhoneNumber: phone,
        payoutBankName: null,
        payoutBankPaybill: null,
        payoutBankAccountName: null,
        payoutBankAccountNumber: null,
      },
    };
  }

  if (payoutMethod === 'bank') {
    const bankName = String(payoutBankName ?? '').trim();
    const paybill = String(payoutBankPaybill ?? '').trim();
    const accountName = String(payoutBankAccountName ?? '').trim();
    const accountNumber = String(payoutBankAccountNumber ?? '').trim();
    if (!bankName) return { error: 'Bank name is required.' };
    if (!/^\d{5,7}$/.test(paybill)) {
      return {
        error: "Your bank's M-Pesa paybill number is required (5–7 digits) — check it with your bank if you're unsure.",
      };
    }
    if (!accountName || !accountNumber) {
      return { error: 'Account name and account number are both required.' };
    }
    return {
      details: {
        payoutMethod,
        payoutPhoneNumber: null,
        payoutBankName: bankName,
        payoutBankPaybill: paybill,
        payoutBankAccountName: accountName,
        payoutBankAccountNumber: accountNumber,
      },
    };
  }

  return { error: 'payoutMethod must be either "mpesa" or "bank".' };
}

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

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const save = async (details: PayoutDetails) => {
    const updated = await prisma.tenant.update({
      where: { id: session.tenantId },
      data: { ...details, isOnboarded: true },
      select: PAYOUT_FIELDS,
    });
    return updated;
  };

  try {
    // Step 2 of a change: the tenant typed the emailed code. The details
    // saved are the ones bound to the challenge, not anything in this body.
    if (req.body?.challengeId) {
      const verified = await verifyOtpChallenge({
        challengeId: String(req.body.challengeId),
        code: String(req.body.otp ?? ''),
        purpose: 'payout_settings',
        tenantId: session.tenantId,
      });
      if (!verified.ok) return res.status(401).json({ error: verified.error });

      const parsed = parseDetails(verified.payload);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });

      const updated = await save(parsed.details);
      const dest = getPayoutDestination(updated);
      sendPayoutSettingsChangedEmail(session.email, dest?.destination ?? 'updated').catch((err) =>
        console.error('CRITICAL_PAYOUT_SETTINGS_NOTICE_EMAIL_ERROR:', err)
      );
      return res.status(200).json({ success: true, data: updated });
    }

    const parsed = parseDetails(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    // First-time setup: nothing has been sold yet (checkout requires an
    // onboarded tenant), so there's no balance to redirect — save directly.
    if (!tenant.isOnboarded) {
      const updated = await save(parsed.details);
      return res.status(200).json({ success: true, data: updated });
    }

    // Changing where money goes on an account that already has sales —
    // require the emailed code, so a stolen password alone can't redirect
    // payouts.
    if (!rateLimit(res, `payout-settings-otp:${session.tenantId}`, 5, 15 * 60_000)) return;

    const { challengeId, code } = await createOtpChallenge({
      purpose: 'payout_settings',
      tenantId: session.tenantId,
      userId: session.userId,
      payload: { ...parsed.details },
    });
    const summary = getPayoutDestination(parsed.details)?.destination ?? '';
    await sendPayoutSettingsOtpEmail(session.email, code, summary);

    return res.status(202).json({
      success: true,
      requiresOtp: true,
      data: { challengeId, maskedEmail: maskEmail(session.email) },
    });
  } catch (error) {
    console.error('CRITICAL_PAYOUT_SETTINGS_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
