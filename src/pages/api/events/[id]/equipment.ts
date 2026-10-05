// src/pages/api/events/[id]/equipment.ts
//
// POST — ask Tixflow for gate scanners (Sunmi V2s: scanner + receipt
// printer) and/or trained scanning staff for the event day(s). The platform
// admin confirms the quote and arranges it; nothing is charged here.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { normalizeKenyanPhone } from '@/lib/phone';
import { RENTAL_RATES } from '@/lib/plans';
import { sendPlatformAlertEmail } from '@/lib/email';

const whole = (v: unknown, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can request equipment.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, include: { tenant: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const b = req.body || {};
  const devices = whole(b.devices, 50);
  const staff = whole(b.staff, 50);
  const days = Math.max(whole(b.days, 14), 1);
  const contactName = typeof b.contactName === 'string' ? b.contactName.trim().slice(0, 80) : '';
  const contactPhone = normalizeKenyanPhone(b.contactPhone);
  if (devices + staff === 0) return res.status(400).json({ error: 'Ask for at least one scanner or one staff member.' });
  if (!contactName || !contactPhone) return res.status(400).json({ error: 'Enter a contact name and phone number.' });

  const estimate = (devices * RENTAL_RATES.devicePerDay + staff * RENTAL_RATES.staffPerDay) * days;
  const request = await prisma.equipmentRequest.create({
    data: {
      tenantId: event.tenantId,
      eventId: event.id,
      devices,
      staff,
      days,
      contactName,
      contactPhone,
      notes: typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 1000) : null,
      estimate,
    },
  });

  sendPlatformAlertEmail(
    `Gear request: ${event.tenant.businessName}`,
    `${event.tenant.businessName} wants ${devices} scanner(s) and ${staff} staff for ${days} day(s) at "${event.title}" ` +
      `(${event.date.toISOString().slice(0, 10)}, ${event.location}). Estimate KES ${estimate.toLocaleString()}. ` +
      `Contact: ${contactName}, ${contactPhone}.`
  ).catch((error) => console.error('CRITICAL_EQUIPMENT_ALERT_ERROR:', request.id, error));

  return res.status(201).json({ success: true, data: request });
}
