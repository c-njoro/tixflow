// src/pages/api/dashboard/stats.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can view dashboard stats.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const events = await prisma.event.findMany({
    where: { tenantId: session.tenantId },
    include: { ticketTiers: true },
    orderBy: { date: 'asc' },
  });

  const scannedCount = await prisma.ticket.count({
    where: { tenantId: session.tenantId, status: 'scanned' },
  });

  const now = new Date();
  let ticketsIssued = 0;
  let revenue = 0;
  const upcomingEvents: {
    id: string;
    title: string;
    date: Date;
    location: string;
    sold: number;
    capacity: number;
  }[] = [];

  for (const event of events) {
    const eventSold = event.ticketTiers.reduce((sum, t) => sum + t.sold, 0);
    const eventCapacity = event.ticketTiers.reduce((sum, t) => sum + t.capacity, 0);
    // Revenue is sold * current tier price — an approximation, since we don't
    // snapshot the price paid on each ticket yet. That'll change once each
    // ticket records its actual M-Pesa charge from the completed order.
    const eventRevenue = event.ticketTiers.reduce((sum, t) => sum + t.sold * t.price, 0);

    ticketsIssued += eventSold;
    revenue += eventRevenue;

    if (event.status === 'published' && new Date(event.date) >= now) {
      upcomingEvents.push({
        id: event.id,
        title: event.title,
        date: event.date,
        location: event.location,
        sold: eventSold,
        capacity: eventCapacity,
      });
    }
  }

  upcomingEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return res.status(200).json({
    success: true,
    data: {
      totals: {
        totalEvents: events.length,
        publishedEvents: events.filter((e) => e.status === 'published').length,
        ticketsIssued,
        ticketsScanned: scannedCount,
        revenue,
      },
      upcomingEvents: upcomingEvents.slice(0, 5),
    },
  });
}