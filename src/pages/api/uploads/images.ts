// src/pages/api/events/[id]/images.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { uploadImage, deleteImage } from '@/lib/cloudinary';

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can manage event images.' });
  }

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid event id.' });

  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'POST') {
    const { image, type } = req.body;
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'image (base64 data URL) is required.' });
    }
    if (type !== 'cover' && type !== 'gallery') {
      return res.status(400).json({ error: 'type must be "cover" or "gallery".' });
    }

    try {
      const uploaded = await uploadImage(image, `tixflow/${session.tenantId}/events/${id}`);

      if (type === 'cover') {
        // Replacing an existing cover — clean up the old Cloudinary asset
        // rather than leaving it orphaned.
        if (event.coverImagePublicId) {
          await deleteImage(event.coverImagePublicId).catch((err) =>
            console.error('CRITICAL_ORPHANED_COVER_IMAGE_CLEANUP_FAILED:', err)
          );
        }
        const updated = await prisma.event.update({
          where: { id },
          data: { coverImageUrl: uploaded.url, coverImagePublicId: uploaded.publicId },
          include: { ticketTiers: true },
        });
        return res.status(200).json({ success: true, data: updated });
      }

      const updated = await prisma.event.update({
        where: { id },
        data: { galleryImages: { push: uploaded } },
        include: { ticketTiers: true },
      });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error('CRITICAL_EVENT_IMAGE_UPLOAD_ERROR:', error);
      return res.status(500).json({ error: 'Failed to upload image.' });
    }
  }

  if (req.method === 'DELETE') {
    const { type, publicId } = req.body;

    try {
      if (type === 'cover') {
        if (event.coverImagePublicId) {
          await deleteImage(event.coverImagePublicId);
        }
        const updated = await prisma.event.update({
          where: { id },
          data: { coverImageUrl: null, coverImagePublicId: null },
          include: { ticketTiers: true },
        });
        return res.status(200).json({ success: true, data: updated });
      }

      if (type === 'gallery') {
        if (!publicId || typeof publicId !== 'string') {
          return res.status(400).json({ error: 'publicId is required to delete a gallery image.' });
        }
        await deleteImage(publicId);

        // `deleteMany` on a MongoDB composite-type list isn't something I
        // could confirm is supported in this Prisma version — filtering in
        // JS and replacing the whole array with `set` is the operation
        // that's definitely supported, so that's what this does instead.
        const remaining = event.galleryImages.filter((img) => img.publicId !== publicId);
        const updated = await prisma.event.update({
          where: { id },
          data: { galleryImages: { set: remaining } },
          include: { ticketTiers: true },
        });
        return res.status(200).json({ success: true, data: updated });
      }

      return res.status(400).json({ error: 'type must be "cover" or "gallery".' });
    } catch (error) {
      console.error('CRITICAL_EVENT_IMAGE_DELETE_ERROR:', error);
      return res.status(500).json({ error: 'Failed to delete image.' });
    }
  }

  res.setHeader('Allow', ['POST', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}