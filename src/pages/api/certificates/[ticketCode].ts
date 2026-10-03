// src/pages/api/certificates/[ticketCode].ts
//
// GET   ?t=<token> — what goes on the certificate for this ticket.
// PATCH { t, name } — the attendee sets the name printed on it (the
//        ticket may have been bought by someone else).
// Only scanned-in tickets of events with certificates turned on qualify.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { verifyLinkToken } from '@/lib/signedLinks';
import { DEFAULT_CERTIFICATE_TITLE } from '@/lib/certificates';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', ['GET', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `certificate:${getClientIp(req)}`, 60, 10 * 60_000)) return;

  const { ticketCode } = req.query;
  const token = req.method === 'GET' ? req.query.t : req.body?.t;
  if (typeof ticketCode !== 'string' || verifyLinkToken('certificate', token) !== ticketCode) {
    return res.status(404).json({ error: 'This certificate link is not valid.' });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { ticketCode },
    include: {
      event: {
        select: {
          title: true,
          date: true,
          endDate: true,
          location: true,
          certificatesEnabled: true,
          certificateTitle: true,
          certificateSignatory: true,
          certificateSignatoryTitle: true,
          certificateNote: true,
          tenant: { select: { businessName: true, logoUrl: true } },
        },
      },
    },
  });
  if (!ticket || ticket.status !== 'scanned' || !ticket.event.certificatesEnabled) {
    return res.status(404).json({ error: 'No certificate is available for this ticket.' });
  }

  if (req.method === 'PATCH') {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    if (name.length < 2) return res.status(400).json({ error: 'Enter the name to print.' });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { certificateName: name } });
    ticket.certificateName = name;
  }

  const e = ticket.event;
  return res.status(200).json({
    success: true,
    data: {
      name: ticket.certificateName || ticket.buyerName,
      certificateId: ticket.ticketCode,
      title: e.certificateTitle || DEFAULT_CERTIFICATE_TITLE,
      eventTitle: e.title,
      eventDate: e.date,
      eventEndDate: e.endDate,
      location: e.location,
      attendedAt: ticket.scannedAt,
      organiser: e.tenant.businessName,
      logoUrl: e.tenant.logoUrl,
      signatory: e.certificateSignatory,
      signatoryTitle: e.certificateSignatoryTitle,
      note: e.certificateNote,
    },
  });
}
