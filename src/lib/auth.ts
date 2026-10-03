// src/lib/auth.ts
import type { NextApiRequest } from 'next';
import jwt from 'jsonwebtoken';
import { getSecret } from './secrets';

export const SESSION_COOKIE_NAME = 'tixflow_session';

export const getSessionSecret = () => getSecret('JWT_SECRET');

export interface SessionPayload {
  userId: string;
  email: string;
  role: 'admin' | 'scanner_staff';
  tenantId: string;
  tenantSlug: string;
}

// Reads and verifies the tixflow_session cookie set at login.
// Returns null if missing/invalid/expired — callers must handle that as unauthenticated.
export function getSession(req: NextApiRequest): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) return null;

  try {
    return jwt.verify(token, getSessionSecret()) as SessionPayload;
  } catch {
    return null;
  }
}
