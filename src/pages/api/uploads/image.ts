// src/pages/api/uploads/image.ts
import type { NextApiRequest, NextApiResponse } from 'next';
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

  if (req.method === 'POST') {
    const { image } = req.body;
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'image (base64 data URL) is required.' });
    }

    try {
      const result = await uploadImage(image, `tixflow/${session.tenantId}/events`);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('CRITICAL_IMAGE_UPLOAD_ERROR:', error);
      return res.status(500).json({ error: 'Failed to upload image.' });
    }
  }

  if (req.method === 'DELETE') {
    const { publicId } = req.body;
    if (!publicId || typeof publicId !== 'string') {
      return res.status(400).json({ error: 'publicId is required.' });
    }

    try {
      await deleteImage(publicId);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('CRITICAL_IMAGE_DELETE_ERROR:', error);
      return res.status(500).json({ error: 'Failed to delete image.' });
    }
  }

  res.setHeader('Allow', ['POST', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}