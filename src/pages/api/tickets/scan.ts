// src/pages/api/tickets/scan.ts
//
// Scan a ticket at the gate: { ticketCode, eventId, direction: 'in' | 'out' }.
// Verdicts (first entry, re-entry, exit, rejections) come from src/lib/gate.ts.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/auth';
import { processScan } from '@/lib/gate';

// Both admins and scanner_staff are allowed to scan — that's the entire
// purpose of the scanner_staff role, so there is no role check beyond
// "is this a valid session for this tenant" here.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { ticketCode, eventId, direction } = req.body || {};
  if (!ticketCode || typeof ticketCode !== 'string') {
    return res.status(400).json({ error: 'ticketCode is required.' });
  }

  try {
    const { status, ...outcome } = await processScan({
      tenantId: session.tenantId,
      eventId: typeof eventId === 'string' ? eventId : null,
      ticketCode,
      direction: direction === 'out' ? 'out' : 'in',
      staffId: session.userId,
    });
    return res.status(status).json(outcome);
  } catch (error) {
    console.error('CRITICAL_TICKET_SCAN_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
