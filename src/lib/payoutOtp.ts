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
}

export function createOtpToken(tenantId: string, otpHash: string): string {
  return jwt.sign({ tenantId, otpHash } as OtpTokenPayload, SECRET, { expiresIn: '10m' });
}

export function verifyOtpToken(token: string): OtpTokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as OtpTokenPayload;
  } catch {
    return null;
  }
}