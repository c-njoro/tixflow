// src/pages/api/events/[id]/space/documents/[documentId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { deleteImage } from '@/lib/cloudinary';
import { bumpSpace } from '@/lib/eventSpace';
import { buildAdminState, loadExistingEventSpace } from '@/lib/spaceAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadExistingEventSpace(req, res);
  if (!loaded) return;
  const { event, space } = loaded;

  const { documentId } = req.query;
  const doc =
    typeof documentId === 'string'
      ? await prisma.spaceDocument.findFirst({ where: { id: documentId, spaceId: space.id } })
      : null;
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  try {
    await deleteImage(doc.publicId).catch((err) =>
      console.error('CRITICAL_ORPHANED_SPACE_DOCUMENT_CLEANUP_FAILED:', doc.publicId, err)
    );
    await prisma.spaceDocument.delete({ where: { id: doc.id } });
    const updated = await bumpSpace(
      space.id,
      space.liveDocumentId === doc.id ? { liveDocumentId: null, liveDocumentPage: 1 } : {}
    );
    return res.status(200).json({ success: true, data: await buildAdminState(event, updated) });
  } catch (error) {
    console.error('CRITICAL_SPACE_DOCUMENT_DELETE_ERROR:', error);
    return res.status(500).json({ error: 'Failed to delete document.' });
  }
}
