// src/pages/api/events/[id]/plan.ts
//
// Rooms & gear.
// GET  — the event's Event Space rooms (included with ticket sales, or
//        bought), room prices, gate-gear rental rates and this event's
//        rental requests.
// POST — buy a room: { size, method: 'mpesa' | 'card', phoneNumber? }.
//        Same order flow as tickets (kind 'event_plan'); the dashboard polls
//        /api/checkout/mpesa/status. Card returns to this page.
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { createOrderAndPush } from '@/lib/checkout';
import { cardPaymentsEnabled, startCardCheckout } from '@/lib/intasend';
import { normalizeKenyanPhone } from '@/lib/phone';
import { isRoomSize, RENTAL_RATES, ROOM_SIZES, roomAllowance } from '@/lib/plans';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can buy rooms and gear.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    const [rooms, equipment] = await Promise.all([
      roomAllowance(event.id),
      prisma.equipmentRequest.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        title: event.title,
        date: event.date,
        endDate: event.endDate,
        rooms,
        roomSizes: ROOM_SIZES,
        cardPayments: cardPaymentsEnabled(),
        rentalRates: RENTAL_RATES,
        equipment,
      },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `plan:${session.userId}`, 10, 10 * 60_000)) return;

  if (event.status === 'cancelled') return res.status(400).json({ error: 'This event is cancelled.' });
  const { size, method, phoneNumber } = req.body || {};
  if (!isRoomSize(size)) return res.status(400).json({ error: 'Choose a room size.' });
  const room = ROOM_SIZES[size];
  const phone = method === 'mpesa' ? normalizeKenyanPhone(phoneNumber) : null;
  if (method === 'mpesa' && !phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number (e.g. 0712345678).' });
  if (method !== 'mpesa' && method !== 'card') return res.status(400).json({ error: 'Choose M-Pesa or card.' });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: event.tenantId } });
  const order = {
    kind: 'event_plan',
    eventPlanTier: size,
    buyerName: tenant.businessName,
    buyerEmail: session.email.toLowerCase(),
    buyerPhone: phone ?? '',
    totalAmount: room.price,
    platformFee: 0,
    items: [],
    tenantId: event.tenantId,
    eventId: event.id,
  };

  try {
    if (method === 'mpesa') {
      const result = await createOrderAndPush({ ...order, paymentMethod: 'mpesa' }, `Tixflow room`);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({ success: true, data: { orderId: result.orderId, accessKey: result.accessKey } });
    }
    const created = await prisma.pendingOrder.create({
      data: { ...order, paymentMethod: 'card', status: 'pending', accessKey: crypto.randomBytes(24).toString('base64url') },
    });
    const result = await startCardCheckout(created);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({
      success: true,
      data: { orderId: created.id, accessKey: created.accessKey, redirectUrl: result.url },
    });
  } catch (error) {
    console.error('CRITICAL_EVENT_ROOM_PURCHASE_ERROR:', event.id, error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
