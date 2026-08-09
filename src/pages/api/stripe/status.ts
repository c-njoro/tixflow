// src/pages/api/stripe/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { stripe } from '@/lib/stripe';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  if (!tenant.stripeConnectId) {
    return res.status(200).json({
      success: true,
      data: { connected: false, isOnboarded: false },
    });
  }

  try {
    const account = await stripe.accounts.retrieve(tenant.stripeConnectId);
    const isOnboarded = Boolean(account.details_submitted && account.charges_enabled);

    // This is a convenience sync for immediate UI feedback right after the
    // tenant returns from Stripe's hosted onboarding. The webhook handler
    // (account.updated) is the actual source of truth going forward, since
    // it fires even if the tenant never comes back to this page.
    if (isOnboarded !== tenant.isOnboarded) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { isOnboarded },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        connected: true,
        isOnboarded,
        detailsSubmitted: account.details_submitted,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      },
    });
  } catch (error) {
    console.error('CRITICAL_STRIPE_STATUS_ERROR:', error);
    return res.status(500).json({ error: 'Failed to fetch payout account status.' });
  }
}