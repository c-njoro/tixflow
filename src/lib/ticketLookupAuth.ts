// src/lib/ticketLookupAuth.ts
import jwt from 'jsonwebtoken';

const SECRET =
  process.env.TICKET_LOOKUP_JWT_SECRET ||
  process.env.JWT_SECRET ||
  'fallback-super-secure-jwt-token-secret-key-12345';

export interface LookupTokenPayload {
  email: string;
}

// Short expiry — this token is only meant to be used within minutes of the
// email arriving, not kept around as a bookmark.
export function createLookupToken(email: string): string {
  return jwt.sign({ email: email.toLowerCase().trim() } as LookupTokenPayload, SECRET, {
    expiresIn: '15m',
  });
}

export function verifyLookupToken(token: string): LookupTokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as LookupTokenPayload;
  } catch {
    return null;
  }
}