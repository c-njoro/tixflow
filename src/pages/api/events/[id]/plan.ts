// src/pages/api/events/[id]/plan.ts
//
// GET  — what this event's plan includes, what's used, upgrades on offer,
//        gate-gear rental rates and this event's rental requests.
// POST — buy an upgrade: { plan, method: 'mpesa' | 'card', phoneNumber? }.
//        Same order flow as tickets (kind 'event_plan'); the dashboard polls
//        /api/checkout/mpesa/status. Card returns to the plan page.
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { createOrderAndPush } from '@/lib/checkout';
import { cardPaymentsEnabled, startCardCheckout } from '@/lib/intasend';
import { normalizeKenyanPhone } from '@/lib/phone';
import { availableUpgrades, eventEntitlements, FREE_EVENT_PLANS, RENTAL_RATES, type PlanId } from '@/lib/plans';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage the event plan.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, include: { ticketTiers: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const current = eventEntitlements(event, event.ticketTiers);
  const currentPrice = current.plan === 'paid' ? 0 : FREE_EVENT_PLANS[current.plan].price;
  // Upgrading from a plan already bought: pay the difference.
  const upgrades = availableUpgrades(event, event.ticketTiers).map((u) => ({
    ...u,
    charge: Math.max(u.price - currentPrice, 0),
  }));

  if (req.method === 'GET') {
    const [rooms, equipment] = await Promise.all([
      prisma.eventSpace.count({ where: { eventId: event.id } }),
      prisma.equipmentRequest.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        title: event.title,
        date: event.date,
        endDate: event.endDate,
        entitlements: current,
        usage: { registrations: event.ticketTiers.reduce((n, t) => n + t.sold, 0), rooms },
        upgrades,
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

  const { plan, method, phoneNumber } = req.body || {};
  const upgrade = upgrades.find((u) => u.id === (plan as PlanId));
  if (!upgrade || upgrade.charge <= 0) return res.status(400).json({ error: 'That plan is not available for this event.' });
  const phone = method === 'mpesa' ? normalizeKenyanPhone(phoneNumber) : null;
  if (method === 'mpesa' && !phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number (e.g. 0712345678).' });
  if (method !== 'mpesa' && method !== 'card') return res.status(400).json({ error: 'Choose M-Pesa or card.' });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: event.tenantId } });
  const order = {
    kind: 'event_plan',
    eventPlanTier: upgrade.id,
    buyerName: tenant.businessName,
    buyerEmail: session.email.toLowerCase(),
    buyerPhone: phone ?? '',
    totalAmount: upgrade.charge,
    platformFee: 0,
    items: [],
    tenantId: event.tenantId,
    eventId: event.id,
  };

  try {
    if (method === 'mpesa') {
      const result = await createOrderAndPush({ ...order, paymentMethod: 'mpesa' }, `Tixflow ${upgrade.label}`);
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
    console.error('CRITICAL_EVENT_PLAN_PURCHASE_ERROR:', event.id, error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
