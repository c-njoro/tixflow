// src/lib/platformAdminAuth.ts
import type { NextApiRequest } from 'next';
import jwt from 'jsonwebtoken';
import { getSecret } from './secrets';

export const PLATFORM_ADMIN_COOKIE_NAME = 'tixflow_platform_admin_session';

// Deliberately does NOT fall back to JWT_SECRET — a tenant-session secret
// leak shouldn't also hand out platform-admin access.
export const getPlatformAdminSecret = () => getSecret('PLATFORM_ADMIN_JWT_SECRET');

export interface PlatformAdminSession {
  username: string;
}

export function getPlatformAdminSession(req: NextApiRequest): PlatformAdminSession | null {
  const token = req.cookies?.[PLATFORM_ADMIN_COOKIE_NAME];
  if (!token) return null;

  try {
    return jwt.verify(token, getPlatformAdminSecret()) as PlatformAdminSession;
  } catch {
    return null;
  }
}
