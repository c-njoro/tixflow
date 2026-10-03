// src/pages/api/events/[id]/certificates/index.ts
//
// GET   — certificate settings and how many attendees qualify.
// PATCH — change settings (enable, title, signatory, note).
// POST  — send every scanned-in attendee their certificate (once).
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { certificateUrl, sendCertificates } from '@/lib/certificates';

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage certificates.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  let event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'PATCH') {
    const b = req.body || {};
    event = await prisma.event.update({
      where: { id: event.id },
      data: {
        ...(typeof b.certificatesEnabled === 'boolean' && { certificatesEnabled: b.certificatesEnabled }),
        ...(b.certificateTitle !== undefined && { certificateTitle: text(b.certificateTitle, 80) }),
        ...(b.certificateSignatory !== undefined && { certificateSignatory: text(b.certificateSignatory, 80) }),
        ...(b.certificateSignatoryTitle !== undefined && { certificateSignatoryTitle: text(b.certificateSignatoryTitle, 80) }),
        ...(b.certificateNote !== undefined && { certificateNote: text(b.certificateNote, 200) }),
      },
    });
  } else if (req.method === 'POST') {
    if (!event.certificatesEnabled) return res.status(400).json({ error: 'Turn certificates on first.' });
    if (event.certificatesSentAt) return res.status(409).json({ error: 'Certificates were already sent.' });
    sendCertificates(event.id).catch((error) => console.error('CRITICAL_CERTIFICATE_SEND_ERROR:', id, error));
    return res.status(202).json({ success: true, message: 'Sending certificates.' });
  } else if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'PATCH', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const sample = await prisma.ticket.findFirst({ where: { eventId: event.id, status: 'scanned' }, select: { ticketCode: true } });
  return res.status(200).json({
    success: true,
    data: {
      certificatesEnabled: event.certificatesEnabled,
      certificateTitle: event.certificateTitle,
      certificateSignatory: event.certificateSignatory,
      certificateSignatoryTitle: event.certificateSignatoryTitle,
      certificateNote: event.certificateNote,
      certificatesSentAt: event.certificatesSentAt,
      eligible: await prisma.ticket.count({ where: { eventId: event.id, status: 'scanned' } }),
      // A real attendee's certificate, so the organiser can check the layout.
      previewUrl: event.certificatesEnabled && sample ? certificateUrl(sample.ticketCode) : null,
    },
  });
}
