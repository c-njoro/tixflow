// src/pages/api/events/[id]/guests/index.ts
//
// GET  — the event's guest list, with each guest's passes and arrivals.
// POST — add guests (admins). Either { guests: [{ name, email?, whatsapp?,
//        plusOnes?, group?, note? }] } or { text } (a pasted list, one per
//        line — see parseGuestLines). { send: true } emails/WhatsApps the
//        passes straight away.
//        Or { action: 'send_all' }: send passes to everyone with an email
//        or number who hasn't been sent one yet.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { addGuests, cleanGuest, listGuests, MAX_GUESTS_PER_ADD, parseGuestLines, sendGuestPass, type CleanGuest } from '@/lib/guests';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, include: { ticketTiers: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: { guests: await listGuests(event.id) } });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can change the guest list.' });

  if (req.body?.action === 'send_all') {
    const unsent = await prisma.guest.findMany({
      // Missing or null both mean "never sent".
      where: { eventId: event.id, OR: [{ passSentAt: null }, { passSentAt: { isSet: false } }] },
    });
    const reachable = unsent.filter((g) => g.email || g.whatsapp);
    // Background, one at a time: WhatsApp sends are spaced out.
    (async () => {
      for (const guest of reachable) await sendGuestPass(guest).catch((e) => console.error('CRITICAL_GUEST_PASS_ERROR:', guest.id, e));
    })();
    return res.status(200).json({ success: true, data: { sending: reachable.length } });
  }

  let guests: CleanGuest[] = [];
  let errors: string[] = [];
  if (typeof req.body?.text === 'string') {
    ({ guests, errors } = parseGuestLines(req.body.text));
  } else if (Array.isArray(req.body?.guests)) {
    for (const g of req.body.guests) {
      const cleaned = cleanGuest(g ?? {});
      if (typeof cleaned === 'string') errors.push(cleaned);
      else guests.push(cleaned);
    }
  }
  if (errors.length > 0) return res.status(400).json({ error: errors.slice(0, 5).join(' '), errors });
  if (guests.length === 0) return res.status(400).json({ error: 'Add at least one guest.' });
  if (guests.length > MAX_GUESTS_PER_ADD) {
    return res.status(400).json({ error: `Add up to ${MAX_GUESTS_PER_ADD} guests at a time.` });
  }

  try {
    const result = await addGuests(event, guests, { send: req.body?.send === true });
    return res.status(201).json({ success: true, data: { added: result.added.length } });
  } catch (error) {
    console.error('CRITICAL_GUEST_ADD_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
