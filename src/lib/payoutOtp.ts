// src/lib/payoutOtp.ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const SECRET =
  process.env.PAYOUT_OTP_JWT_SECRET ||
  process.env.JWT_SECRET ||
  'fallback-super-secure-jwt-token-secret-key-12345';

export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

export interface OtpTokenPayload {
  tenantId: string;
  otpHash: string;
  amount: number;
}

// The requested amount is baked into the token itself — so the amount that
// actually gets paid out is always the one the tenant confirmed by email,
// never a value that could be swapped in on the final request.
export function createOtpToken(tenantId: string, otpHash: string, amount: number): string {
  return jwt.sign({ tenantId, otpHash, amount } as OtpTokenPayload, SECRET, { expiresIn: '10m' });
}

export function verifyOtpToken(token: string): OtpTokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as OtpTokenPayload;
  } catch {
    return null;
  }
}