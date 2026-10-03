// src/pages/api/events/[id]/exhibitors/[exhibitorId].ts
//
// PATCH  { isActive?, name? } — switch an exhibitor's scanning on/off.
// DELETE — remove the exhibitor and the leads they collected.
// POST   { action: 'new_link' } — revoke their portal link and issue a new one.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { generateExhibitorToken, listExhibitors } from '@/lib/exhibitors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage exhibitors.' });

  const { id, exhibitorId } = req.query;
  const exhibitor =
    typeof exhibitorId === 'string' && /^[a-f0-9]{24}$/i.test(exhibitorId)
      ? await prisma.exhibitor.findFirst({ where: { id: exhibitorId, eventId: String(id), tenantId: session.tenantId } })
      : null;
  if (!exhibitor) return res.status(404).json({ error: 'Exhibitor not found.' });

  if (req.method === 'PATCH') {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : undefined;
    await prisma.exhibitor.update({
      where: { id: exhibitor.id },
      data: {
        ...(typeof req.body?.isActive === 'boolean' && { isActive: req.body.isActive }),
        ...(name && { name }),
      },
    });
  } else if (req.method === 'DELETE') {
    await prisma.$transaction([
      prisma.exhibitorLead.deleteMany({ where: { exhibitorId: exhibitor.id } }),
      prisma.exhibitor.delete({ where: { id: exhibitor.id } }),
    ]);
  } else if (req.method === 'POST' && req.body?.action === 'new_link') {
    await prisma.exhibitor.update({ where: { id: exhibitor.id }, data: { accessToken: generateExhibitorToken() } });
  } else {
    res.setHeader('Allow', ['PATCH', 'DELETE', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  return res.status(200).json({ success: true, data: await listExhibitors(exhibitor.eventId) });
}
