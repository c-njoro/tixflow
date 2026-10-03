// src/pages/api/public/promoters/[token].ts
//
// A promoter's own stats page — reached by their secret link, no login.
// Shows their links and earnings, never buyers' personal details.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPromoterStats } from '@/lib/promoters';
import { getAppUrl } from '@/lib/mpesaCallbacks';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `promoter-page:${getClientIp(req)}`, 120, 10 * 60_000)) return;

  const { token } = req.query;
  const promoter =
    typeof token === 'string' && token.length >= 20
      ? await prisma.promoter.findUnique({ where: { accessToken: token } })
      : null;
  if (!promoter) return res.status(404).json({ error: 'This link is not valid.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: promoter.tenantId }, select: { businessName: true, slug: true } });
  const events = await prisma.event.findMany({
    where: {
      tenantId: promoter.tenantId,
      status: 'published',
      date: { gte: new Date() },
      ...(promoter.eventId && { id: promoter.eventId }),
    },
    orderBy: { date: 'asc' },
    select: { id: true, title: true, slug: true, date: true },
  });

  const [stats, recentOrders, perEvent] = await Promise.all([
    getPromoterStats(promoter.tenantId, [promoter.id]),
    prisma.pendingOrder.findMany({
      where: { promoterId: promoter.id, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { createdAt: true, eventId: true, items: true, promoterCommission: true },
    }),
    prisma.pendingOrder.groupBy({
      by: ['eventId'],
      where: { promoterId: promoter.id, status: 'completed' },
      _sum: { promoterCommission: true },
      _count: { _all: true },
    }),
  ]);
  const eventIds = [...new Set([...recentOrders.map((o) => o.eventId), ...perEvent.map((p) => p.eventId)])];
  const eventTitles = new Map(
    (await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, title: true } })).map((e) => [e.id, e.title])
  );

  const base = `${getAppUrl()}/${tenant?.slug}`;
  return res.status(200).json({
    success: true,
    data: {
      name: promoter.name,
      code: promoter.code,
      isActive: promoter.isActive,
      organiser: tenant?.businessName ?? '',
      commission: { type: promoter.commissionType, value: promoter.commissionValue },
      stats: stats.get(promoter.id) ?? { tickets: 0, sales: 0, earned: 0, paid: 0, owed: 0 },
      links: events.map((e) => ({ title: e.title, date: e.date, url: `${base}/${e.slug}?ref=${promoter.code}` })),
      storefrontUrl: promoter.eventId ? null : `${base}?ref=${promoter.code}`,
      byEvent: perEvent.map((p) => ({
        title: eventTitles.get(p.eventId) ?? 'Event',
        orders: p._count._all,
        commission: Math.round((p._sum.promoterCommission ?? 0) * 100) / 100,
      })),
      recent: recentOrders.map((o) => ({
        at: o.createdAt,
        event: eventTitles.get(o.eventId) ?? 'Event',
        tickets: o.items.reduce((n, i) => n + i.quantity, 0),
        commission: o.promoterCommission ?? 0,
      })),
    },
  });
}
