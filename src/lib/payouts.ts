// src/lib/payouts.ts
import { prisma } from './prisma';
import { getOwedCommissionTotal } from './promoters';

// The platform earns its fee per ticket sold (src/lib/plans.ts), recorded
// on each order as `platformFee`. A withdrawal itself is free by default;
// PAYOUT_FEE_PERCENT can add a cut per withdrawal (e.g. to cover M-Pesa B2C
// charges). Payouts keep the percent snapshotted at request time.
export function getPayoutFeePercent(): number {
  return Number(process.env.PAYOUT_FEE_PERCENT || 0);
}

// Kept for older imports — this is the withdrawal fee, not the ticket fee.
export const getPlatformFeePercent = getPayoutFeePercent;

export function computePayoutSplit(amount: number) {
  const feePercent = getPayoutFeePercent();
  const feeAmount = Math.round(amount * (feePercent / 100) * 100) / 100;
  const netAmount = Math.round((amount - feeAmount) * 100) / 100;
  return { feePercent, feeAmount, netAmount };
}

// Payout statuses that hold money against the tenant's balance — a request
// that's awaiting approval or already in flight still counts as "spoken
// for", so a tenant can't request the same balance twice while the first
// request is still being reviewed or sent.
const HELD_STATUSES = ['pending_approval', 'processing', 'completed'] as const;

// Orders whose money the PLATFORM collected (M-Pesa, card) — only those
// count towards what the organiser can withdraw. Cash at the gate is
// already in the organiser's hands; free/manual orders are KES 0.
// Event-plan purchases are the platform's own revenue, not the organiser's.
const COLLECTED_METHODS = ['mpesa', 'card'];
const ORGANISER_ORDER = { status: 'completed' as const, kind: { not: 'event_plan' } };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getTenantBalance(tenantId: string) {
  const [collected, fees, heldPayouts, owedToPromoters] = await Promise.all([
    prisma.pendingOrder.aggregate({
      where: { tenantId, ...ORGANISER_ORDER, paymentMethod: { in: COLLECTED_METHODS } },
      _sum: { totalAmount: true },
    }),
    // Every sale pays the per-ticket fee, cash sales included — for those
    // it comes out of the organiser's next payout.
    prisma.pendingOrder.aggregate({ where: { tenantId, ...ORGANISER_ORDER }, _sum: { platformFee: true } }),
    prisma.payout.aggregate({ where: { tenantId, status: { in: [...HELD_STATUSES] } }, _sum: { amount: true } }),
    // Commission earned by promoters but not yet paid is theirs, not the
    // tenant's. (Promoter payouts already made are part of heldPayouts.)
    getOwedCommissionTotal(tenantId),
  ]);

  const totalRevenue = round2(collected._sum.totalAmount || 0);
  const platformFees = round2(fees._sum.platformFee || 0);
  const totalRequestedOrPaid = round2(heldPayouts._sum.amount || 0);

  return {
    totalRevenue,
    platformFees,
    platformFeePercent: getPayoutFeePercent(),
    totalPaidOrPending: totalRequestedOrPaid,
    owedToPromoters,
    outstandingBalance: Math.max(round2(totalRevenue - platformFees - totalRequestedOrPaid - owedToPromoters), 0),
  };
}

export interface PayoutDestination {
  method: 'mpesa' | 'bank';
  destination: string;
  destPhoneNumber: string | null;
  destBankPaybill: string | null;
  destAccountNumber: string | null;
}

// The tenant's currently configured payout target, in the shape that gets
// snapshotted onto a Payout. Null if the method isn't fully set up.
export function getPayoutDestination(tenant: {
  payoutMethod: string | null;
  payoutPhoneNumber: string | null;
  payoutBankName: string | null;
  payoutBankPaybill: string | null;
  payoutBankAccountNumber: string | null;
}): PayoutDestination | null {
  if (tenant.payoutMethod === 'mpesa' && tenant.payoutPhoneNumber) {
    return {
      method: 'mpesa',
      destination: `M-Pesa: ${tenant.payoutPhoneNumber}`,
      destPhoneNumber: tenant.payoutPhoneNumber,
      destBankPaybill: null,
      destAccountNumber: null,
    };
  }
  if (tenant.payoutMethod === 'bank' && tenant.payoutBankPaybill && tenant.payoutBankAccountNumber) {
    return {
      method: 'bank',
      destination: `${tenant.payoutBankName || 'Bank'} paybill ${tenant.payoutBankPaybill} — acct ${tenant.payoutBankAccountNumber}`,
      destPhoneNumber: null,
      destBankPaybill: tenant.payoutBankPaybill,
      destAccountNumber: tenant.payoutBankAccountNumber,
    };
  }
  return null;
}
