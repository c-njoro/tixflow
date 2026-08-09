// src/pages/api/platform-admin/tenants.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';

// TODO: keep this in sync with whatever fee percentage the landing page
// promises, and with whatever gets used in real checkout deductions once
// that exists — right now this is only used for the payout ledger display.
const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 5);

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
      payoutBankAccountName: true,
      payoutBankAccountNumber: true,
      isOnboarded: true,
    },
    orderBy: { businessName: 'asc' },
  });

  const data = await Promise.all(
    tenants.map(async (tenant) => {
      // Revenue is the actual amount collected per completed order, not
      // recomputed from current ticket prices — accurate even if a tier's
      // price changed after some tickets already sold.
      const completedOrders = await prisma.pendingOrder.aggregate({
        where: { tenantId: tenant.id, status: 'completed' },
        _sum: { totalAmount: true },
      });
      const totalRevenue = completedOrders._sum.totalAmount || 0;
      const netPayable = totalRevenue * (1 - FEE_PERCENT / 100);

      const paidOut = await prisma.payout.aggregate({
        where: { tenantId: tenant.id, status: 'completed' },
        _sum: { amount: true },
      });
      const totalPaidOut = paidOut._sum.amount || 0;

      return {
        ...tenant,
        totalRevenue,
        platformFeePercent: FEE_PERCENT,
        netPayable,
        totalPaidOut,
        outstandingBalance: Math.max(netPayable - totalPaidOut, 0),
      };
    })
  );

  return res.status(200).json({ success: true, data });
}