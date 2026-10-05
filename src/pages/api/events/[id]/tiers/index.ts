// src/pages/api/events/[id]/tiers/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage ticket tiers.' });

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid event id.' });

  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { name, price, capacity, tierColor, description, doorPrice } = req.body;
  const door = doorPrice === '' || doorPrice == null ? null : Number(doorPrice);
  if (door !== null && !(door >= 0)) return res.status(400).json({ error: 'Door price cannot be negative.' });
  if (!name || price == null || capacity == null) {
    return res.status(400).json({ error: 'name, price, and capacity are required.' });
  }
  if (price < 0 || capacity < 1) {
    return res.status(400).json({ error: 'price cannot be negative and capacity must be at least 1.' });
  }

  try {
    const tier = await prisma.ticketTier.create({
      data: {
        name: name.trim(),
        price: Number(price),
        doorPrice: door,
        capacity: Number(capacity),
        tierColor: tierColor ?? '#000000',
        description: description?.trim(),
        eventId: id,
      },
    });
    return res.status(201).json({ success: true, data: tier });
  } catch (error) {
    console.error('CRITICAL_TIER_CREATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}