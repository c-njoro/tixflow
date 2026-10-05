// src/pages/api/events/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { deleteImage } from '@/lib/cloudinary';
import { deleteSpace } from '@/lib/eventSpace';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid event id.' });

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

    // Image fields are intentionally NOT accepted here — they go through
    // /api/events/[id]/images, which keeps Cloudinary and the event record
    // in sync (upload+attach or delete+detach as one atomic step). This
    // endpoint only ever touches the event's non-image fields.
    const { title, description, category, date, endDate, location, status, remindersEnabled, reentryLimit, passFeeToBuyer } =
      req.body;

    const allowedStatuses = ['draft', 'published', 'cancelled', 'completed'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
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
          ...(status && { status }),
          ...(typeof remindersEnabled === 'boolean' && { remindersEnabled }),
          ...(reentryLimit !== undefined && {
            reentryLimit: Math.min(Math.max(Math.floor(Number(reentryLimit) || 0), 0), 20),
          }),
          ...(typeof passFeeToBuyer === 'boolean' && { passFeeToBuyer }),
          // Moving the start time re-arms reminders for the new time.
          ...(date && new Date(date).getTime() !== event.date.getTime() && {
            reminderDaySentAt: null,
            reminderHoursSentAt: null,
          }),
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
    if (event._count.tickets > 0) {
      return res.status(409).json({
        error: 'This event has issued tickets and cannot be deleted. Cancel it instead.',
      });
    }

    try {
      // Clean up Cloudinary assets too, not just the database rows.
      const imagesToDelete = [
        ...(event.coverImagePublicId ? [event.coverImagePublicId] : []),
        ...event.galleryImages.map((img) => img.publicId),
      ];
      await Promise.all(
        imagesToDelete.map((publicId) =>
          deleteImage(publicId).catch((err) =>
            console.error('CRITICAL_ORPHANED_IMAGE_CLEANUP_FAILED:', publicId, err)
          )
        )
      );

      const spaces = await prisma.eventSpace.findMany({ where: { eventId: id }, select: { id: true } });
      for (const space of spaces) await deleteSpace(space.id);

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