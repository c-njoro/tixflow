// src/lib/exhibitors.ts
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './prisma';
import { getAppUrl } from './mpesaCallbacks';

export const generateExhibitorToken = () => crypto.randomBytes(24).toString('base64url');
export const exhibitorPortalUrl = (token: string) => `${getAppUrl()}/exhibitor/${token}`;

// The exhibitor behind a portal request — sends the error itself and
// returns null if the link is wrong or switched off.
export async function loadExhibitor(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query;
  const exhibitor =
    typeof token === 'string' && token.length >= 20 ? await prisma.exhibitor.findUnique({ where: { accessToken: token } }) : null;
  if (!exhibitor) {
    res.status(404).json({ error: 'This exhibitor link is not valid.' });
    return null;
  }
  if (!exhibitor.isActive) {
    res.status(403).json({ error: 'Lead scanning has been switched off for this exhibitor. Contact the organiser.' });
    return null;
  }
  return exhibitor;
}

export async function listExhibitors(eventId: string) {
  const exhibitors = await prisma.exhibitor.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' } });
  const counts = await prisma.exhibitorLead.groupBy({
    by: ['exhibitorId'],
    where: { eventId },
    _count: { _all: true },
  });
  return exhibitors.map((x) => ({
    id: x.id,
    name: x.name,
    contactEmail: x.contactEmail,
    isActive: x.isActive,
    createdAt: x.createdAt,
    portalUrl: exhibitorPortalUrl(x.accessToken),
    leadCount: counts.find((c) => c.exhibitorId === x.id)?._count._all ?? 0,
  }));
}
