// src/lib/signedLinks.ts
//
// Tamper-proof tokens for personal links (feedback surveys, certificates):
// `<subject>.<signature>`, where the signature is an HMAC over a purpose
// string plus the subject. Not a JWT on purpose — nothing here can ever be
// mistaken for, or pasted in as, a login session.
import crypto from 'crypto';
import { getSecret, safeEqual } from './secrets';

const sign = (purpose: string, subject: string) =>
  crypto
    .createHmac('sha256', getSecret('LINK_SIGNING_SECRET', 'JWT_SECRET'))
    .update(`tixflow-link:${purpose}:${subject}`)
    .digest('base64url')
    .slice(0, 32);

export function createLinkToken(purpose: string, subject: string): string {
  return `${Buffer.from(subject).toString('base64url')}.${sign(purpose, subject)}`;
}

// Returns the subject the token was made for, or null if it was altered.
export function verifyLinkToken(purpose: string, token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const subject = Buffer.from(encoded, 'base64url').toString();
  return safeEqual(sign(purpose, subject), signature) ? subject : null;
}

// A stable, non-reversible id for a person within one purpose — lets us
// enforce "one response each" without storing who said what.
export const pseudonym = (purpose: string, subject: string) => sign(`${purpose}:id`, subject.toLowerCase());
