// src/lib/platformAdminAuth.ts
import type { NextApiRequest } from 'next';
import jwt from 'jsonwebtoken';

export const PLATFORM_ADMIN_COOKIE_NAME = 'tixflow_platform_admin_session';
export const PLATFORM_ADMIN_JWT_SECRET =
  process.env.PLATFORM_ADMIN_JWT_SECRET ||
  process.env.JWT_SECRET ||
  'fallback-super-secure-jwt-token-secret-key-12345';

export interface PlatformAdminSession {
  username: string;
}

export function getPlatformAdminSession(req: NextApiRequest): PlatformAdminSession | null {
  const token = req.cookies?.[PLATFORM_ADMIN_COOKIE_NAME];
  if (!token) return null;

  try {
    return jwt.verify(token, PLATFORM_ADMIN_JWT_SECRET) as PlatformAdminSession;
  } catch {
    return null;
  }
}