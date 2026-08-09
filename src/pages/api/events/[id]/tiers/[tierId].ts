// src/pages/api/events/[id]/tiers/[tierId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage ticket tiers.' });

  const { id, tierId } = req.query;
  if (typeof id !== 'string' || typeof tierId !== 'string') {
    return res.status(400).json({ error: 'Invalid identifiers.' });
  }

  // Ownership chain checked in one query: tier -> event -> tenant
  const tier = await prisma.ticketTier.findFirst({
    where: { id: tierId, eventId: id, event: { tenantId: session.tenantId } },
  });
  if (!tier) return res.status(404).json({ error: 'Ticket tier not found.' });

  if (req.method === 'PATCH') {
    const { name, price, capacity, tierColor, description, isActive } = req.body;

    if (capacity != null && capacity < tier.sold) {
      return res.status(409).json({
        error: `Capacity cannot be less than tickets already sold (${tier.sold}).`,
      });
    }
    if (price != null && price < 0) {
      return res.status(400).json({ error: 'price cannot be negative.' });
    }

    try {
      const updated = await prisma.ticketTier.update({
        where: { id: tierId },
        data: {
          ...(name && { name: name.trim() }),
          ...(price != null && { price: Number(price) }),
          ...(capacity != null && { capacity: Number(capacity) }),
          ...(tierColor && { tierColor }),
          ...(description !== undefined && { description: description?.trim() }),
          ...(isActive !== undefined && { isActive }),
        },
      });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error('CRITICAL_TIER_UPDATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  if (req.method === 'DELETE') {
    if (tier.sold > 0) {
      return res.status(409).json({
        error: 'This tier has sold tickets and cannot be deleted. Deactivate it instead.',
      });
    }
    try {
      await prisma.ticketTier.delete({ where: { id: tierId } });
      return res.status(200).json({ success: true, message: 'Ticket tier deleted.' });
    } catch (error) {
      console.error('CRITICAL_TIER_DELETE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['PATCH', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}