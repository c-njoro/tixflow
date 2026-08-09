// src/lib/payouts.ts
import { prisma } from './prisma';

const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 5);

export async function getTenantBalance(tenantId: string) {
  // Revenue is the actual amount collected per completed order, not
  // recomputed from current ticket prices.
  const completedOrders = await prisma.pendingOrder.aggregate({
    where: { tenantId, status: 'completed' },
    _sum: { totalAmount: true },
  });
  const totalRevenue = completedOrders._sum.totalAmount || 0;
  const netPayable = totalRevenue * (1 - FEE_PERCENT / 100);

  // Include 'pending' payouts in what's already accounted for — not just
  // 'completed' — so a tenant can't fire off several payout requests before
  // the first one's B2C result comes back and get paid multiple times for
  // the same balance.
  const paidOrInFlight = await prisma.payout.aggregate({
    where: { tenantId, status: { in: ['completed', 'pending'] } },
    _sum: { amount: true },
  });
  const totalPaidOrPending = paidOrInFlight._sum.amount || 0;

  return {
    totalRevenue,
    platformFeePercent: FEE_PERCENT,
    netPayable,
    totalPaidOrPending,
    outstandingBalance: Math.max(netPayable - totalPaidOrPending, 0),
  };
}