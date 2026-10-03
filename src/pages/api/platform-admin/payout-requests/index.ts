// src/pages/api/platform-admin/payout-requests/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import type { PayoutStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Default view is the approval queue; ?status=all returns every
  // tenant-initiated request regardless of where it landed.
  const statusParam = typeof req.query.status === 'string' ? req.query.status : 'pending_approval';
  const VALID = ['all', 'pending_approval', 'processing', 'completed', 'failed', 'rejected'];
  if (!VALID.includes(statusParam)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}.` });
  }

  const payouts = await prisma.payout.findMany({
    where: {
      initiatedBy: 'tenant',
      ...(statusParam === 'all' ? {} : { status: statusParam as PayoutStatus }),
    },
    include: {
      tenant: {
        select: { id: true, businessName: true, slug: true },
      },
    },
    orderBy: { createdAt: statusParam === 'pending_approval' ? 'asc' : 'desc' },
  });

  return res.status(200).json({ success: true, data: payouts });
}
