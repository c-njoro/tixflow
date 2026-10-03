// src/lib/ticketLookupAuth.ts
import jwt from 'jsonwebtoken';
import { getSecret } from './secrets';

const getLookupSecret = () => getSecret('TICKET_LOOKUP_JWT_SECRET', 'JWT_SECRET');

export interface LookupTokenPayload {
  email: string;
  typ: 'ticket_lookup';
}

// Short expiry — this token is only meant to be used within minutes of the
// email arriving, not kept around as a bookmark.
export function createLookupToken(email: string): string {
  const payload: LookupTokenPayload = { email: email.toLowerCase().trim(), typ: 'ticket_lookup' };
  return jwt.sign(payload, getLookupSecret(), {
    expiresIn: '15m',
  });
}

export function verifyLookupToken(token: string): LookupTokenPayload | null {
  try {
    // typ check: a staff session token signed with the same fallback secret
    // must not be accepted as a ticket-lookup token either.
    const payload = jwt.verify(token, getLookupSecret()) as Partial<LookupTokenPayload>;
    if (payload.typ !== 'ticket_lookup' || typeof payload.email !== 'string') return null;
    return payload as LookupTokenPayload;
  } catch {
    return null;
  }
}
