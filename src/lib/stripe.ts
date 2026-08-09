// src/lib/stripe.ts
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables.');
}

// apiVersion is intentionally left unset so the SDK uses the version pinned
// on your Stripe account by default, rather than a hardcoded string that
// could drift out of sync with whatever version of the `stripe` package
// you have installed.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);