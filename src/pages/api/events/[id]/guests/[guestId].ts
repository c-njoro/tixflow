// src/pages/api/events/[id]/guests/[guestId].ts
//
// PATCH  — edit a guest ({ name, email?, whatsapp?, plusOnes?, group?, note? }).
// POST   — { action: 'send' }: email/WhatsApp their passes (again).
// DELETE — take them off the list (unused passes stop working).
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { cleanGuest, removeGuest, sendGuestPass, updateGuest } from '@/lib/guests';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can change the guest list.' });
  const { id, guestId } = req.query;
  if (typeof id !== 'string' || typeof guestId !== 'string' || !/^[a-f0-9]{24}$/i.test(guestId)) {
    return res.status(400).json({ error: 'Invalid guest.' });
  }
  const guest = await prisma.guest.findFirst({ where: { id: guestId, eventId: id, tenantId: session.tenantId } });
  if (!guest) return res.status(404).json({ error: 'Guest not found.' });

  try {
    if (req.method === 'PATCH') {
      const cleaned = cleanGuest({ ...guest, ...req.body });
      if (typeof cleaned === 'string') return res.status(400).json({ error: cleaned });
      const result = await updateGuest(guest, cleaned);
      if (result.error) return res.status(409).json({ error: result.error });
      return res.status(200).json({ success: true, data: result.guest });
    }
    if (req.method === 'POST' && req.body?.action === 'send') {
      if (!guest.email && !guest.whatsapp) {
        return res.status(400).json({ error: 'Add an email or WhatsApp number for this guest first.' });
      }
      const sent = await sendGuestPass(guest);
      if (!sent) return res.status(409).json({ error: 'This guest has no passes left to send.' });
      return res.status(200).json({ success: true });
    }
    if (req.method === 'DELETE') {
      await removeGuest(guest);
      return res.status(200).json({ success: true });
    }
  } catch (error) {
    console.error('CRITICAL_GUEST_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
  res.setHeader('Allow', ['PATCH', 'POST', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
