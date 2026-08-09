// src/lib/auth.ts
import type { NextApiRequest } from 'next';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-super-secure-jwt-token-secret-key-12345';

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
  const token = req.cookies?.tixflow_session;
  if (!token) return null;

  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}