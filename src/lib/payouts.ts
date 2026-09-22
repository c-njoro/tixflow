// src/lib/payouts.ts
import { prisma } from './prisma';

// The platform's cut, taken out of each individual payout request — not
// pre-deducted from the tenant's overall balance. Change this one value to
// change the fee for every payout requested from now on; payouts already
// made keep the fee percent that was snapshotted onto them at request time.
export function getPlatformFeePercent(): number {
  return Number(process.env.PLATFORM_FEE_PERCENT || 3);
}

export function computePayoutSplit(amount: number) {
  const feePercent = getPlatformFeePercent();
  const feeAmount = Math.round(amount * (feePercent / 100) * 100) / 100;
  const netAmount = Math.round((amount - feeAmount) * 100) / 100;
  return { feePercent, feeAmount, netAmount };
}

// Payout statuses that hold money against the tenant's balance — a request
// that's awaiting approval or already in flight still counts as "spoken
// for", so a tenant can't request the same balance twice while the first
// request is still being reviewed or sent.
const HELD_STATUSES = ['pending_approval', 'processing', 'completed'] as const;

export async function getTenantBalance(tenantId: string) {
  // Revenue is the actual amount collected per completed order, not
  // recomputed from current ticket prices.
  const completedOrders = await prisma.pendingOrder.aggregate({
    where: { tenantId, status: 'completed' },
    _sum: { totalAmount: true },
  });
  const totalRevenue = completedOrders._sum.totalAmount || 0;

  // The tenant's balance is gross revenue minus whatever they've already
  // requested or been paid — the platform's fee is taken out of each
  // withdrawal individually, not pre-deducted here.
  const heldPayouts = await prisma.payout.aggregate({
    where: { tenantId, status: { in: [...HELD_STATUSES] } },
    _sum: { amount: true },
  });
  const totalRequestedOrPaid = heldPayouts._sum.amount || 0;

  return {
    totalRevenue,
    platformFeePercent: getPlatformFeePercent(),
    totalPaidOrPending: totalRequestedOrPaid,
    outstandingBalance: Math.max(totalRevenue - totalRequestedOrPaid, 0),
  };
}
