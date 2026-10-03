// src/lib/secrets.ts
import crypto from 'crypto';

// Returns the first env var in `names` that is set. In production a missing
// secret is a hard error — a hardcoded fallback would let anyone who reads
// this repo forge sessions. In development a per-name placeholder keeps
// `npm run dev` working without a full .env.
//
// Resolved lazily (call this inside handlers, not at module top level) so
// `next build` doesn't fail just because runtime secrets aren't present in
// the build environment.
export function getSecret(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required secret: set ${names.join(' or ')} in the environment.`);
  }
  return `dev-only-insecure-${names[0]}`;
}

// Constant-time string comparison — avoids leaking how many leading
// characters of a secret matched through response timing.
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
