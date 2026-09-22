// src/pages/api/platform-admin/tenants.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { getTenantBalance } from '@/lib/payouts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      businessName: true,
      slug: true,
      payoutMethod: true,
      payoutPhoneNumber: true,
      payoutBankName: true,
      payoutBankPaybill: true,
      payoutBankAccountName: true,
      payoutBankAccountNumber: true,
      isOnboarded: true,
    },
    orderBy: { businessName: 'asc' },
  });

  const data = await Promise.all(
    tenants.map(async (tenant) => {
      const balance = await getTenantBalance(tenant.id);

      const paidOut = await prisma.payout.aggregate({
        where: { tenantId: tenant.id, status: 'completed' },
        _sum: { amount: true },
      });
      const pendingApprovalCount = await prisma.payout.count({
        where: { tenantId: tenant.id, status: 'pending_approval' },
      });

      return {
        ...tenant,
        ...balance,
        totalPaidOut: paidOut._sum.amount || 0,
        pendingApprovalCount,
      };
    })
  );

  return res.status(200).json({ success: true, data });
}
