// src/pages/api/events/[id]/exhibitors/index.ts
//
// GET  — the event's exhibitors with lead counts and portal links.
// POST — add an exhibitor.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { generateExhibitorToken, listExhibitors } from '@/lib/exhibitors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage exhibitors.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true, tenantId: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'POST') {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const contactEmail = typeof req.body?.contactEmail === 'string' ? req.body.contactEmail.trim().toLowerCase() : '';
    if (!name) return res.status(400).json({ error: 'Enter the exhibitor’s name.' });
    if (contactEmail && !EMAIL_REGEX.test(contactEmail)) return res.status(400).json({ error: 'Enter a valid email, or leave it blank.' });
    if ((await prisma.exhibitor.count({ where: { eventId: event.id } })) >= 200) {
      return res.status(400).json({ error: 'An event can have up to 200 exhibitors.' });
    }
    await prisma.exhibitor.create({
      data: { tenantId: event.tenantId, eventId: event.id, name, contactEmail: contactEmail || null, accessToken: generateExhibitorToken() },
    });
  } else if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  return res.status(200).json({ success: true, data: await listExhibitors(event.id) });
}
