// src/lib/promoterAdmin.ts
//
// Organiser-side promoter helpers shared by /api/tenant/promoters/*.
import type { Promoter } from '@prisma/client';
import { prisma } from './prisma';
import { getAppUrl } from './mpesaCallbacks';
import { normalizeKenyanPhone } from './phone';
import { getPromoterStats, normalizePromoterCode, PROMOTER_CODE_PATTERN, promoterStatsUrl } from './promoters';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validates the editable fields of a promoter (all of them, or only those sent when `partial`).
export async function parsePromoterInput(
  body: Record<string, unknown>,
  tenantId: string,
  partial: boolean
): Promise<{ data: Partial<Pick<Promoter, 'name' | 'phone' | 'email' | 'code' | 'commissionType' | 'commissionValue' | 'eventId' | 'isActive'>> } | { error: string }> {
  const data: Record<string, unknown> = {};
  const has = (key: string) => body[key] !== undefined;

  if (!partial || has('name')) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!name) return { error: 'Enter the promoter’s name.' };
    data.name = name;
  }
  if (!partial || has('phone')) {
    const phone = normalizeKenyanPhone(body.phone);
    if (!phone) return { error: 'Enter the promoter’s M-Pesa number (e.g. 0712345678).' };
    data.phone = phone;
  }
  if (has('email')) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email && !EMAIL_REGEX.test(email)) return { error: 'Enter a valid email, or leave it blank.' };
    data.email = email || null;
  }
  if (!partial || has('code')) {
    const code = normalizePromoterCode(body.code);
    if (!PROMOTER_CODE_PATTERN.test(code)) {
      return { error: 'The link code can use lowercase letters, numbers and dashes (up to 30), e.g. "wanjiku".' };
    }
    data.code = code;
  }
  if (!partial || has('commissionType') || has('commissionValue')) {
    const type = body.commissionType;
    const value = Number(body.commissionValue);
    if (type !== 'percent' && type !== 'fixed') return { error: 'Commission must be a percentage or a fixed amount per ticket.' };
    if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a commission greater than zero.' };
    if (type === 'percent' && value > 50) return { error: 'A percentage commission can be at most 50%.' };
    data.commissionType = type;
    data.commissionValue = Math.round(value * 100) / 100;
  }
  if (has('eventId')) {
    if (body.eventId === null || body.eventId === '') {
      data.eventId = null;
    } else {
      const event =
        typeof body.eventId === 'string' && /^[a-f0-9]{24}$/i.test(body.eventId)
          ? await prisma.event.findFirst({ where: { id: body.eventId, tenantId }, select: { id: true } })
          : null;
      if (!event) return { error: 'That event was not found.' };
      data.eventId = event.id;
    }
  }
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
  return { data };
}

export async function listPromoters(tenantId: string) {
  const [promoters, tenant] = await Promise.all([
    prisma.promoter.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
  ]);
  const eventIds = [...new Set(promoters.map((p) => p.eventId).filter((id): id is string => !!id))];
  const events = eventIds.length
    ? await prisma.event.findMany({ where: { id: { in: eventIds }, tenantId }, select: { id: true, slug: true, title: true } })
    : [];
  const eventById = new Map(events.map((e) => [e.id, e]));
  const stats = await getPromoterStats(tenantId, promoters.map((p) => p.id));
  const base = `${getAppUrl()}/${tenant?.slug}`;

  return promoters.map((p) => {
    const event = p.eventId ? eventById.get(p.eventId) : undefined;
    return {
      ...p,
      eventTitle: event?.title ?? null,
      // A single-event promoter links straight to that event; otherwise to
      // the storefront (the ref sticks to whichever event they buy).
      link: event ? `${base}/${event.slug}?ref=${p.code}` : `${base}?ref=${p.code}`,
      statsUrl: promoterStatsUrl(p.accessToken),
      stats: stats.get(p.id) ?? { tickets: 0, sales: 0, earned: 0, paid: 0, owed: 0 },
    };
  });
}
