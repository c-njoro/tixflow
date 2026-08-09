// src/pages/api/stripe/connect.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { stripe } from '@/lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can manage payout settings.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    let accountId = tenant.stripeConnectId;

    // Only create a new Express account once per tenant — re-runs of this
    // route (e.g. clicking "Connect Stripe" again after a partial
    // onboarding) reuse the same account and just generate a fresh link.
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;

      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { stripeConnectId: accountId },
      });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/dashboard/settings/payments?onboarding=refresh`,
      return_url: `${appUrl}/dashboard/settings/payments?onboarding=return`,
      type: 'account_onboarding',
    });

    return res.status(200).json({ success: true, data: { url: accountLink.url } });
  } catch (error) {
    console.error('CRITICAL_STRIPE_CONNECT_ERROR:', error);
    return res.status(500).json({ error: 'Failed to start Stripe onboarding. Please try again.' });
  }
}