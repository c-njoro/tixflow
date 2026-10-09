// src/lib/assistantAuth.ts
//
// The website chat assistant (the separate Biz Smart agent server) calls
// /api/assistant/* with `Authorization: Bearer <ASSISTANT_API_KEY>`, set
// as a secret header on its HTTP tools.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSecret, safeEqual } from './secrets';

// Returns true if the request may proceed; otherwise it has already answered.
export function requireAssistant(req: NextApiRequest, res: NextApiResponse): boolean {
  let key: string;
  try {
    key = getSecret('ASSISTANT_API_KEY');
  } catch {
    res.status(503).json({ error: 'The assistant API is not configured.' });
    return false;
  }
  if (!safeEqual(req.headers.authorization ?? '', `Bearer ${key}`)) {
    res.status(401).json({ error: 'Unauthorized.' });
    return false;
  }
  return true;
}
