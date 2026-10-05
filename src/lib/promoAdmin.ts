// src/lib/promoAdmin.ts
//
// Organiser-side promo codes: parsing the form and listing codes with how
// they've performed.
import type { PromoCode } from '@prisma/client';
import { prisma } from './prisma';
import { normalizePromoCode } from './pricing';

export const PROMO_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,23}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

type PromoInput = Partial<
  Pick<PromoCode, 'code' | 'discountType' | 'discountValue' | 'eventId' | 'tierIds' | 'maxUses' | 'startsAt' | 'endsAt' | 'promoterId' | 'isActive'>
>;

const optionalDate = (v: unknown) => (v === '' || v === null ? null : v === undefined ? undefined : new Date(String(v)));

// Validates the create/edit form. `partial`: only the fields sent are checked.
export async function parsePromoInput(
  body: Record<string, any>,
  tenantId: string,
  partial: boolean
): Promise<{ data: PromoInput } | { error: string }> {
  const data: PromoInput = {};

  if (!partial || body.code !== undefined) {
    const code = normalizePromoCode(body.code);
    if (!PROMO_CODE_PATTERN.test(code)) return { error: 'Codes are 2–24 letters, numbers or dashes (e.g. MUKURU).' };
    data.code = code;
  }
  if (!partial || body.discountType !== undefined || body.discountValue !== undefined) {
    const type = body.discountType;
    const value = Number(body.discountValue);
    if (type !== 'percent' && type !== 'fixed') return { error: 'Choose a percentage or a fixed amount off.' };
    if (!Number.isFinite(value) || value <= 0) return { error: 'The discount must be more than zero.' };
    if (type === 'percent' && value > 100) return { error: 'A percentage discount can be at most 100%.' };
    data.discountType = type;
    data.discountValue = Math.round(value * 100) / 100;
  }
  if (body.eventId !== undefined) {
    if (body.eventId === null || body.eventId === '') data.eventId = null;
    else {
      const event = OBJECT_ID.test(body.eventId) && (await prisma.event.findFirst({ where: { id: body.eventId, tenantId } }));
      if (!event) return { error: 'Event not found.' };
      data.eventId = body.eventId;
    }
  }
  if (body.tierIds !== undefined) {
    if (!Array.isArray(body.tierIds) || !body.tierIds.every((t: unknown) => typeof t === 'string' && OBJECT_ID.test(t))) {
      return { error: 'Invalid ticket types.' };
    }
    data.tierIds = body.tierIds;
  }
  if (body.maxUses !== undefined) {
    if (body.maxUses === null || body.maxUses === '') data.maxUses = null;
    else {
      const n = Number(body.maxUses);
      if (!Number.isInteger(n) || n < 1) return { error: 'Max uses must be a whole number of at least 1, or blank.' };
      data.maxUses = n;
    }
  }
  const startsAt = optionalDate(body.startsAt);
  const endsAt = optionalDate(body.endsAt);
  if ((startsAt && isNaN(startsAt.getTime())) || (endsAt && isNaN(endsAt.getTime()))) return { error: 'Invalid date.' };
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end must be after the start.' };
  if (startsAt !== undefined) data.startsAt = startsAt;
  if (endsAt !== undefined) data.endsAt = endsAt;
  if (body.promoterId !== undefined) {
    if (body.promoterId === null || body.promoterId === '') data.promoterId = null;
    else {
      const promoter =
        OBJECT_ID.test(body.promoterId) && (await prisma.promoter.findFirst({ where: { id: body.promoterId, tenantId } }));
      if (!promoter) return { error: 'Promoter not found.' };
      data.promoterId = body.promoterId;
    }
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  return { data };
}

// Codes for one event (plus the tenant's all-events codes), with sales.
export async function listPromoCodes(tenantId: string, eventId?: string) {
  const codes = await prisma.promoCode.findMany({
    where: { tenantId, ...(eventId && { OR: [{ eventId }, { eventId: { isSet: false } }, { eventId: null }] }) },
    orderBy: { createdAt: 'desc' },
  });
  const sales = await prisma.pendingOrder.groupBy({
    by: ['promoCodeId'],
    where: { tenantId, status: 'completed', promoCodeId: { in: codes.map((c) => c.id) } },
    _sum: { totalAmount: true, discountAmount: true },
    _count: { _all: true },
  });
  const promoters = await prisma.promoter.findMany({
    where: { id: { in: codes.map((c) => c.promoterId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  return codes.map((c) => {
    const s = sales.find((x) => x.promoCodeId === c.id);
    return {
      ...c,
      promoterName: promoters.find((p) => p.id === c.promoterId)?.name ?? null,
      orders: s?._count._all ?? 0,
      revenue: s?._sum.totalAmount ?? 0,
      discountGiven: s?._sum.discountAmount ?? 0,
    };
  });
}
