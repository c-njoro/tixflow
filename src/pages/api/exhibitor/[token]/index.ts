// src/pages/api/exhibitor/[token]/index.ts — the exhibitor portal's data.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { loadExhibitor } from '@/lib/exhibitors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const exhibitor = await loadExhibitor(req, res);
  if (!exhibitor) return;

  const [event, leads] = await Promise.all([
    prisma.event.findUnique({
      where: { id: exhibitor.eventId },
      select: { title: true, date: true, location: true, tenant: { select: { businessName: true } } },
    }),
    prisma.exhibitorLead.findMany({ where: { exhibitorId: exhibitor.id }, orderBy: { createdAt: 'desc' } }),
  ]);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    success: true,
    data: {
      exhibitor: { name: exhibitor.name },
      event: event && { title: event.title, date: event.date, location: event.location, organiser: event.tenant.businessName },
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        notes: l.notes,
        rating: l.rating,
        createdAt: l.createdAt,
      })),
    },
  });
}
