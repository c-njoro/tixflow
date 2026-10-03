// src/lib/promoters.ts
//
// Promoter attribution and commission. A promoter's link carries ?ref=<code>;
// checkout looks the code up and fixes the commission on the order.
// Commission is owed once the order completes, held back from the tenant's
// withdrawable balance (see getTenantBalance), and paid out through the
// normal payout flow — emailed code, then platform-admin approval — to the
// promoter's M-Pesa.
import crypto from 'crypto';
import type { Promoter } from '@prisma/client';
import { prisma } from './prisma';
import { getPlatformFeePercent } from './payouts';
import { getAppUrl } from './mpesaCallbacks';

export const PROMOTER_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

export const normalizePromoterCode = (code: unknown) =>
  typeof code === 'string' ? code.trim().toLowerCase() : '';

export const generatePromoterToken = () => crypto.randomBytes(24).toString('base64url');

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeCommission(
  promoter: Pick<Promoter, 'commissionType' | 'commissionValue'>,
  order: { totalAmount: number; ticketCount: number }
): number {
  const raw =
    promoter.commissionType === 'percent'
      ? order.totalAmount * (promoter.commissionValue / 100)
      : promoter.commissionValue * order.ticketCount;
  // Never more than the order itself.
  return round2(Math.min(Math.max(raw, 0), order.totalAmount));
}

// The promoter that a checkout's ref code points to, if it's valid for this
// event. Invalid or stale codes are ignored — the sale still goes through.
export async function resolvePromoter(tenantId: string, eventId: string, ref: unknown) {
  const code = normalizePromoterCode(ref);
  if (!code || !PROMOTER_CODE_PATTERN.test(code)) return null;
  const promoter = await prisma.promoter.findUnique({ where: { tenantId_code: { tenantId, code } } });
  if (!promoter || !promoter.isActive) return null;
  if (promoter.eventId && promoter.eventId !== eventId) return null;
  return promoter;
}

// Payout statuses that count as "paid or on its way" — same idea as the
// tenant's own HELD_STATUSES in src/lib/payouts.ts.
const PAID_STATUSES = ['pending_approval', 'processing', 'completed'] as const;

export interface PromoterStats {
  tickets: number;
  sales: number;
  earned: number;
  paid: number;
  owed: number;
}

export async function getPromoterStats(tenantId: string, promoterIds?: string[]): Promise<Map<string, PromoterStats>> {
  // `{ not: null }` alone doesn't exclude old orders that have no promoterId
  // field at all — require a set, non-null value.
  const scope = promoterIds ? { in: promoterIds } : { isSet: true, not: null };
  const [orders, payouts] = await Promise.all([
    prisma.pendingOrder.findMany({
      where: { tenantId, status: 'completed', promoterId: scope },
      select: { promoterId: true, totalAmount: true, promoterCommission: true, items: true },
    }),
    prisma.payout.groupBy({
      by: ['promoterId'],
      where: { tenantId, promoterId: scope, status: { in: [...PAID_STATUSES] } },
      _sum: { netAmount: true },
    }),
  ]);

  const stats = new Map<string, PromoterStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { tickets: 0, sales: 0, earned: 0, paid: 0, owed: 0 }));
    return s;
  };
  for (const order of orders) {
    if (!order.promoterId) continue;
    const s = get(order.promoterId);
    s.tickets += order.items.reduce((n, item) => n + item.quantity, 0);
    s.sales += order.totalAmount;
    s.earned += order.promoterCommission ?? 0;
  }
  for (const p of payouts) {
    if (p.promoterId) get(p.promoterId).paid += p._sum.netAmount ?? 0;
  }
  for (const s of stats.values()) {
    s.sales = round2(s.sales);
    s.earned = round2(s.earned);
    s.paid = round2(s.paid);
    s.owed = round2(Math.max(s.earned - s.paid, 0));
  }
  return stats;
}

// Total commission owed to all of a tenant's promoters — held back from
// what the tenant can withdraw for themselves.
export async function getOwedCommissionTotal(tenantId: string): Promise<number> {
  const stats = await getPromoterStats(tenantId);
  return round2([...stats.values()].reduce((sum, s) => sum + s.owed, 0));
}

// Paying a promoter X: the promoter receives exactly X, and the platform's
// usual payout fee comes on top, out of the tenant's balance.
export function computePromoterPayoutSplit(commission: number) {
  const feePercent = getPlatformFeePercent();
  const amount = round2(commission / (1 - feePercent / 100));
  return { feePercent, amount, feeAmount: round2(amount - commission), netAmount: round2(commission) };
}

export const promoterStatsUrl = (token: string) => `${getAppUrl()}/promoter/${token}`;
