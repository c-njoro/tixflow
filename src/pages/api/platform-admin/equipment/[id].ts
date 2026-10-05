// src/pages/api/platform-admin/equipment/[id].ts
//
// PATCH { status, adminNote?, estimate? } — move a gear request along
// (quoted → confirmed → done, or declined). The organiser sees the status
// and note on their Plan & Gear page.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';

const STATUSES = ['requested', 'quoted', 'confirmed', 'declined', 'done'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid id.' });
  const { status, adminNote, estimate } = req.body || {};
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const quote = estimate === undefined || estimate === '' ? undefined : Number(estimate);
  if (quote !== undefined && !(quote >= 0)) return res.status(400).json({ error: 'Invalid amount.' });

  try {
    const updated = await prisma.equipmentRequest.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(typeof adminNote === 'string' && { adminNote: adminNote.trim().slice(0, 500) || null }),
        ...(quote !== undefined && { estimate: quote }),
      },
    });
    return res.status(200).json({ success: true, data: updated });
  } catch {
    return res.status(404).json({ error: 'Request not found.' });
  }
}
