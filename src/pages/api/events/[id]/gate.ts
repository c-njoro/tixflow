// src/pages/api/events/[id]/gate.ts
//
// Live numbers for the gate dashboard: arrivals overall and per tier,
// check-ins per minute, per-staff scan counts and the latest admissions.
// Open to all staff — gate staff are exactly who needs this.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// The arrivals chart: one bucket per BUCKET_MS, covering the last WINDOW_MS.
const BUCKET_MS = 5 * 60_000;
const WINDOW_MS = 3 * 60 * 60_000;
// "Right now" pace — scans in the last few minutes.
const PACE_WINDOW_MS = 5 * 60_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });

  const event = await prisma.event.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { ticketTiers: { select: { id: true, name: true, tierColor: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MS);

  // Re-entry: who's inside right now, and today's exits/re-entries/rejections.
  const [insideNow, scanResults] = await Promise.all([
    prisma.ticket.count({ where: { eventId: event.id, status: 'scanned', isInside: true } }),
    prisma.scanLog.groupBy({ by: ['result'], where: { eventId: event.id }, _count: { _all: true } }),
  ]);
  const logCount = (result: string) => scanResults.find((g) => g.result === result)?._count._all ?? 0;

  const [byTierStatus, recentScans, windowScans, byStaff] = await Promise.all([
    prisma.ticket.groupBy({
      by: ['ticketTierId', 'status'],
      where: { eventId: event.id, status: { in: ['active', 'scanned'] } },
      _count: { _all: true },
    }),
    prisma.ticket.findMany({
      where: { eventId: event.id, status: 'scanned' },
      orderBy: { scannedAt: 'desc' },
      take: 12,
      select: { buyerName: true, scannedAt: true, ticketTierId: true, scannedById: true },
    }),
    prisma.ticket.findMany({
      where: { eventId: event.id, status: 'scanned', scannedAt: { gte: windowStart } },
      select: { scannedAt: true },
    }),
    prisma.ticket.groupBy({
      by: ['scannedById'],
      where: { eventId: event.id, status: 'scanned' },
      _count: { _all: true },
    }),
  ]);

  const tiers = event.ticketTiers.map((tier) => {
    const count = (status: string) =>
      byTierStatus.find((g) => g.ticketTierId === tier.id && g.status === status)?._count._all ?? 0;
    const scanned = count('scanned');
    return { id: tier.id, name: tier.name, color: tier.tierColor, scanned, expected: scanned + count('active') };
  });
  const scanned = tiers.reduce((sum, t) => sum + t.scanned, 0);
  const expected = tiers.reduce((sum, t) => sum + t.expected, 0);

  // Buckets aligned to the clock (10:00, 10:05, ...) so labels read naturally.
  const firstBucket = Math.floor(windowStart.getTime() / BUCKET_MS) * BUCKET_MS;
  const buckets: { start: string; count: number }[] = [];
  for (let t = firstBucket; t <= now; t += BUCKET_MS) buckets.push({ start: new Date(t).toISOString(), count: 0 });
  for (const scan of windowScans) {
    if (!scan.scannedAt) continue;
    const index = Math.floor((scan.scannedAt.getTime() - firstBucket) / BUCKET_MS);
    if (buckets[index]) buckets[index].count++;
  }
  const lastFive = windowScans.filter((s) => s.scannedAt && s.scannedAt.getTime() >= now - PACE_WINDOW_MS).length;

  const staffIds = byStaff.map((g) => g.scannedById).filter((sid): sid is string => !!sid);
  const staffUsers = staffIds.length
    ? await prisma.user.findMany({ where: { id: { in: staffIds }, tenantId: session.tenantId }, select: { id: true, name: true } })
    : [];
  const staffName = new Map(staffUsers.map((u) => [u.id, u.name]));
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));

  return res.status(200).json({
    success: true,
    data: {
      event: { id: event.id, title: event.title, date: event.date, location: event.location },
      totals: { scanned, expected, notArrived: expected - scanned, perMinute: Math.round((lastFive / 5) * 10) / 10 },
      gate: {
        insideNow,
        reentryLimit: event.reentryLimit,
        exits: logCount('exit'),
        reentries: logCount('reentry'),
        rejected: logCount('rejected'),
      },
      insideNow,
      tiers,
      arrivals: { bucketMinutes: BUCKET_MS / 60_000, buckets },
      staff: byStaff
        .map((g) => ({
          name: g.scannedById ? staffName.get(g.scannedById) ?? 'Former staff' : 'Before gate tracking',
          count: g._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      recent: recentScans.map((t) => ({
        name: t.buyerName,
        tier: tierName.get(t.ticketTierId) ?? '',
        at: t.scannedAt,
        by: t.scannedById ? staffName.get(t.scannedById) ?? null : null,
      })),
      generatedAt: new Date(now).toISOString(),
    },
  });
}
