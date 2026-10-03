// src/pages/api/exhibitor/[token]/leads/[leadId].ts — notes, rating, delete.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { loadExhibitor } from '@/lib/exhibitors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const exhibitor = await loadExhibitor(req, res);
  if (!exhibitor) return;

  const { leadId } = req.query;
  const lead =
    typeof leadId === 'string' && /^[a-f0-9]{24}$/i.test(leadId)
      ? await prisma.exhibitorLead.findFirst({ where: { id: leadId, exhibitorId: exhibitor.id } })
      : null;
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });

  if (req.method === 'DELETE') {
    await prisma.exhibitorLead.delete({ where: { id: lead.id } });
    return res.status(200).json({ success: true });
  }

  const { notes, rating } = req.body || {};
  if (rating !== undefined && rating !== null && ![1, 2, 3].includes(Number(rating))) {
    return res.status(400).json({ error: 'Rating is 1–3.' });
  }
  const updated = await prisma.exhibitorLead.update({
    where: { id: lead.id },
    data: {
      ...(notes !== undefined && { notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 1000) : null }),
      ...(rating !== undefined && { rating: rating === null ? null : Number(rating) }),
    },
  });
  return res.status(200).json({ success: true, data: { id: updated.id, notes: updated.notes, rating: updated.rating } });
}
