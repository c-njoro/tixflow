// src/lib/mpesaCallbacks.ts
//
// Daraja callbacks aren't signed — anyone who can reach /api/mpesa/* could
// POST a fake "payment succeeded" body. Every callback URL we hand to
// Safaricom carries a secret only we and Safaricom know; handlers reject
// anything without it.
import type { NextApiRequest } from 'next';
import { getSecret, safeEqual } from './secrets';

const getCallbackSecret = () => getSecret('MPESA_CALLBACK_SECRET');

// The app's public URL — used in M-Pesa callbacks and every link we send.
// On Render, RENDER_EXTERNAL_URL (https://<service>.onrender.com) is the
// fallback when NEXT_PUBLIC_APP_URL isn't set.
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// `path` is either an app path like '/api/mpesa/callback' or a full URL
// (e.g. an env override pointing at a tunnel).
export function mpesaCallbackUrl(path: string): string {
  const base = /^https?:\/\//.test(path) ? path : `${getAppUrl()}${path}`;
  const url = new URL(base);
  url.searchParams.set('secret', getCallbackSecret());
  return url.toString();
}

export function hasValidCallbackSecret(req: NextApiRequest): boolean {
  const provided = req.query.secret;
  return typeof provided === 'string' && safeEqual(provided, getCallbackSecret());
}
