// src/pages/api/webhooks/stripe.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { stripe } from '@/lib/stripe';

// Stripe's signature verification needs the exact raw request bytes — if
// Next.js parses the body first, the bytes we'd verify against no longer
// match what Stripe signed, and every event gets rejected.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing Stripe signature header.' });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error('CRITICAL_STRIPE_WEBHOOK_SIGNATURE_ERROR:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  try {
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const isOnboarded = Boolean(account.details_submitted && account.charges_enabled);

        await prisma.tenant.updateMany({
          where: { stripeConnectId: account.id },
          data: { isOnboarded },
        });
        break;
      }

      // checkout.session.completed will be added here once checkout is built —
      // that's where paid tickets actually get created.

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('CRITICAL_STRIPE_WEBHOOK_HANDLER_ERROR:', error);
    // Return 500 (not 200) so Stripe retries — this failure is on our side
    // (e.g. a transient DB error), and swallowing it would silently drop
    // the event instead of giving us another chance to process it.
    return res.status(500).json({ error: 'Webhook handler failed.' });
  }
}