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
    const payload = jwt.verify(token, getSessionSecret());
    // Other tokens are signed with the same secret (e.g. ticket-lookup magic
    // links when TICKET_LOOKUP_JWT_SECRET isn't set). Only a real staff
    // session has all of these — anything else must never pass as one, or
    // a missing tenantId would turn every `where: { tenantId }` filter off.
    if (!isSessionPayload(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.userId === 'string' && OBJECT_ID.test(p.userId) &&
    typeof p.tenantId === 'string' && OBJECT_ID.test(p.tenantId) &&
    typeof p.email === 'string' &&
    typeof p.tenantSlug === 'string' &&
    (p.role === 'admin' || p.role === 'scanner_staff')
  );
}
