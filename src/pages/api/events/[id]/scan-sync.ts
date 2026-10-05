// src/pages/api/events/[id]/scan-sync.ts
//
// Offline gate scanning.
// GET  — the manifest a scanner downloads before the gates open (or when
//        signal is bad): every valid ticket's code, holder, tier and
//        in/out state, so it can decide on its own.
// POST — { scans: [{ ticketCode, direction, scannedAt }] } made while
//        offline. Replayed in the order they happened through the same
//        rules as live scans; returns each verdict, so the scanner can
//        flag any that the server disagrees with (e.g. the same ticket let
//        in at two offline gates).
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { processScan } from '@/lib/gate';

const MAX_BATCH = 500;
// Don't accept made-up timestamps far from now.
const MAX_AGE_MS = 3 * 24 * 60 * 60_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, title: true, reentryLimit: true, ticketTiers: { select: { id: true, name: true, tierColor: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    const tickets = await prisma.ticket.findMany({
      where: { eventId: event.id, status: { in: ['active', 'scanned'] } },
      select: { ticketCode: true, buyerName: true, ticketTierId: true, status: true, isInside: true, reentryCount: true },
    });
    return res.status(200).json({
      success: true,
      data: {
        eventId: event.id,
        title: event.title,
        reentryLimit: event.reentryLimit,
        tiers: event.ticketTiers,
        generatedAt: new Date(),
        // Compact rows: [code, name, tierId, used, inside, reentries]
        tickets: tickets.map((t) => [t.ticketCode, t.buyerName, t.ticketTierId, t.status === 'scanned', t.isInside, t.reentryCount]),
      },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const scans = Array.isArray(req.body?.scans) ? req.body.scans.slice(0, MAX_BATCH) : [];
  const now = Date.now();
  const valid = scans
    .filter((s: any) => typeof s?.ticketCode === 'string' && s.ticketCode.trim())
    .map((s: any) => {
      const at = new Date(s.scannedAt);
      const t = at.getTime();
      return {
        localId: typeof s.localId === 'string' ? s.localId.slice(0, 64) : null,
        ticketCode: s.ticketCode as string,
        direction: s.direction === 'out' ? ('out' as const) : ('in' as const),
        scannedAt: Number.isFinite(t) && t <= now + 60_000 && now - t < MAX_AGE_MS ? at : new Date(),
      };
    })
    .sort((a: { scannedAt: Date }, b: { scannedAt: Date }) => a.scannedAt.getTime() - b.scannedAt.getTime());

  const results = [];
  for (const scan of valid) {
    const outcome = await processScan({
      tenantId: session.tenantId,
      eventId: event.id,
      ticketCode: scan.ticketCode,
      direction: scan.direction,
      staffId: session.userId,
      scannedAt: scan.scannedAt,
      offline: true,
    });
    results.push({ localId: scan.localId, ticketCode: scan.ticketCode, success: outcome.success, result: outcome.result, error: outcome.error });
  }
  return res.status(200).json({ success: true, data: { synced: results.length, results } });
}
