// src/pages/api/events/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const isValidUrl = (url: string) => {
  try { new URL(url); return true; } catch { return false; }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid event id.' });

  // Always scope by tenantId — never trust that an id belongs to the caller's tenant
  const event = await prisma.event.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { ticketTiers: true, _count: { select: { tickets: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: event });
  }

  if (req.method === 'PATCH') {
    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can edit events.' });
    }

    const {
      title, description, category, date, endDate, location,
      coverImageUrl, galleryImageUrls, status,
    } = req.body;

    const allowedStatuses = ['draft', 'published', 'cancelled', 'completed'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }
    if (coverImageUrl && !isValidUrl(coverImageUrl)) {
      return res.status(400).json({ error: 'coverImageUrl must be a valid URL.' });
    }
    if (galleryImageUrls && (!Array.isArray(galleryImageUrls) || galleryImageUrls.some((u: string) => !isValidUrl(u)))) {
      return res.status(400).json({ error: 'galleryImageUrls must be an array of valid URLs.' });
    }

    try {
      const updated = await prisma.event.update({
        where: { id },
        data: {
          ...(title && { title: title.trim() }),
          ...(description !== undefined && { description: description?.trim() }),
          ...(category !== undefined && { category: category?.trim() }),
          ...(date && { date: new Date(date) }),
          ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
          ...(location && { location: location.trim() }),
          ...(coverImageUrl !== undefined && { coverImageUrl }),
          ...(galleryImageUrls !== undefined && { galleryImageUrls }),
          ...(status && { status }),
        },
        include: { ticketTiers: true, _count: { select: { tickets: true } } },
      });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error('CRITICAL_EVENT_UPDATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  if (req.method === 'DELETE') {
    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete events.' });
    }

    // Never hard-delete an event with issued tickets — cancel it instead so
    // ticket holders and financial/audit records stay intact.
    if (event._count.tickets > 0) {
      return res.status(409).json({
        error: 'This event has issued tickets and cannot be deleted. Cancel it instead.',
      });
    }

    try {
      await prisma.$transaction([
        prisma.ticketTier.deleteMany({ where: { eventId: id } }),
        prisma.event.delete({ where: { id } }),
      ]);
      return res.status(200).json({ success: true, message: 'Event deleted.' });
    } catch (error) {
      console.error('CRITICAL_EVENT_DELETE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}