// src/pages/api/platform-admin/payouts.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method === 'GET') {
    const { tenantId } = req.query;
    if (typeof tenantId !== 'string') {
      return res.status(400).json({ error: 'tenantId is required.' });
    }

    const payouts = await prisma.payout.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ success: true, data: payouts });
  }

  if (req.method === 'POST') {
    const { tenantId, amount, method, reference, note } = req.body;

    if (!tenantId || !amount || !method) {
      return res.status(400).json({ error: 'tenantId, amount, and method are required.' });
    }
    if (!['mpesa', 'bank'].includes(method)) {
      return res.status(400).json({ error: 'method must be either "mpesa" or "bank".' });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be greater than zero.' });
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

    try {
      // This records a transfer you've already sent manually — it does not
      // trigger any money movement itself.
      const payout = await prisma.payout.create({
        data: {
          tenantId,
          amount: Number(amount),
          method,
          status: 'completed',
          reference: reference?.trim() || undefined,
          note: note?.trim() || undefined,
        },
      });

      return res.status(201).json({ success: true, data: payout });
    } catch (error) {
      console.error('CRITICAL_PAYOUT_RECORD_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}