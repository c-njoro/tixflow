// src/lib/otp.ts
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getSecret, safeEqual } from './secrets';

export type OtpPurpose = 'payout_request' | 'payout_settings' | 'promoter_payout';

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

const getOtpSecret = () => getSecret('OTP_SECRET', 'JWT_SECRET');

function hashCode(challengeScope: string, code: string): string {
  return crypto.createHmac('sha256', getOtpSecret()).update(`${challengeScope}:${code}`).digest('hex');
}

// Creates a challenge and returns the plain code (to email) plus the id the
// browser holds on to. The browser never sees the code or its hash.
export async function createOtpChallenge(options: {
  purpose: OtpPurpose;
  tenantId: string;
  userId: string;
  payload: Prisma.InputJsonValue;
}): Promise<{ challengeId: string; code: string }> {
  const code = crypto.randomInt(100000, 1000000).toString();

  // A newer code replaces any older unused one for the same action, so only
  // the most recently emailed code ever works.
  await prisma.otpChallenge.updateMany({
    where: { tenantId: options.tenantId, purpose: options.purpose, consumed: false },
    data: { consumed: true },
  });

  const challenge = await prisma.otpChallenge.create({
    data: {
      purpose: options.purpose,
      tenantId: options.tenantId,
      userId: options.userId,
      payload: options.payload,
      codeHash: hashCode(`${options.tenantId}:${options.purpose}`, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  return { challengeId: challenge.id, code };
}

export type OtpVerifyResult =
  | { ok: true; payload: Prisma.JsonValue }
  | { ok: false; error: string };

// Checks the code and, if it matches, consumes the challenge atomically —
// a code can never be used twice, even by two requests racing each other.
export async function verifyOtpChallenge(options: {
  challengeId: string;
  code: string;
  purpose: OtpPurpose;
  tenantId: string;
}): Promise<OtpVerifyResult> {
  if (!/^[a-f0-9]{24}$/i.test(options.challengeId)) {
    return { ok: false, error: 'This confirmation code has expired. Request a new one.' };
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      id: options.challengeId,
      tenantId: options.tenantId,
      purpose: options.purpose,
      consumed: false,
    },
  });
  if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'This confirmation code has expired. Request a new one.' };
  }

  // Count the attempt BEFORE comparing, conditioned on the cap — parallel
  // guesses can't sneak past the limit.
  const counted = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumed: false, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) {
    return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  }

  const expected = hashCode(`${options.tenantId}:${options.purpose}`, String(options.code).trim());
  if (!safeEqual(expected, challenge.codeHash)) {
    const remaining = MAX_ATTEMPTS - (challenge.attempts + 1);
    return {
      ok: false,
      error:
        remaining > 0
          ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'Too many incorrect attempts. Request a new code.',
    };
  }

  const claimed = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumed: false },
    data: { consumed: true },
  });
  if (claimed.count === 0) {
    return { ok: false, error: 'This confirmation code has already been used.' };
  }

  return { ok: true, payload: challenge.payload };
}

export const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
};
