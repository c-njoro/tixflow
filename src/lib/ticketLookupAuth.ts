// src/lib/ticketLookupAuth.ts
import jwt from 'jsonwebtoken';
import { getSecret } from './secrets';

const getLookupSecret = () => getSecret('TICKET_LOOKUP_JWT_SECRET', 'JWT_SECRET');

export interface LookupTokenPayload {
  email: string;
}

// Short expiry — this token is only meant to be used within minutes of the
// email arriving, not kept around as a bookmark.
export function createLookupToken(email: string): string {
  return jwt.sign({ email: email.toLowerCase().trim() } as LookupTokenPayload, getLookupSecret(), {
    expiresIn: '15m',
  });
}

export function verifyLookupToken(token: string): LookupTokenPayload | null {
  try {
    return jwt.verify(token, getLookupSecret()) as LookupTokenPayload;
  } catch {
    return null;
  }
}
