// src/pages/api/events/[id]/space/documents/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { uploadDocument } from '@/lib/cloudinary';
import { bumpSpace } from '@/lib/eventSpace';
import { buildAdminState, loadExistingEventSpace } from '@/lib/spaceAdmin';

// Base64 inflates files by a third — this fits a ~10 MB file, which is
// also Cloudinary's free-plan per-file limit.
export const config = {
  api: {
    bodyParser: { sizeLimit: '14mb' },
  },
};

const ALLOWED_TYPES = /^data:(application\/pdf|image\/(png|jpeg|webp));base64,/;
const MAX_DOCUMENTS = 20;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadExistingEventSpace(req, res);
  if (!loaded) return;
  const { session, event, space } = loaded;

  const { file, title } = req.body || {};
  if (typeof file !== 'string' || !ALLOWED_TYPES.test(file)) {
    return res.status(400).json({ error: 'Upload a PDF, PNG, JPG or WebP file.' });
  }
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Give the document a title.' });
  }
  if ((await prisma.spaceDocument.count({ where: { spaceId: space.id } })) >= MAX_DOCUMENTS) {
    return res.status(400).json({ error: `A space can hold up to ${MAX_DOCUMENTS} documents.` });
  }

  try {
    const uploaded = await uploadDocument(file, `tixflow/${session.tenantId}/spaces/${space.id}`);
    await prisma.spaceDocument.create({
      data: {
        spaceId: space.id,
        title: title.trim().slice(0, 120),
        url: uploaded.url,
        publicId: uploaded.publicId,
        format: uploaded.format,
        pageCount: uploaded.pageCount,
      },
    });
    const updated = await bumpSpace(space.id);
    return res.status(201).json({ success: true, data: await buildAdminState(event, updated) });
  } catch (error) {
    console.error('CRITICAL_SPACE_DOCUMENT_UPLOAD_ERROR:', error);
    return res.status(500).json({ error: 'Failed to upload document.' });
  }
}
