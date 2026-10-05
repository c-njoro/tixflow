// src/lib/pricing.ts
//
// How much an order costs. One function for online checkout, the promo
// code preview and the box office, so the price a buyer is shown is always
// the price they're charged:
//   base price (or door price at the box office)
//   − promo discount (per ticket, on eligible ticket types)
//   = what the ticket costs
//   + the platform fee per ticket, only if the event passes it to buyers
import type { Event, PromoCode, TicketTier } from '@prisma/client';
import { prisma } from './prisma';
import { ticketFee } from './plans';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PricedLine {
  ticketTierId: string;
  tierName: string;
  quantity: number;
  basePrice: number;
  discountPerTicket: number;
  unitPrice: number; // after discount — what one ticket costs (excl. booking fee)
  feePerTicket: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  ticketCount: number;
  subtotal: number; // base prices
  discount: number;
  ticketsTotal: number; // subtotal − discount (the organiser's gross)
  fees: number; // platform fee on the whole order
  bookingFee: number; // part of `fees` added to the buyer's total (0 unless passed on)
  total: number; // what the buyer pays
  promo: PromoCode | null;
}

export type PricingError = { error: string; status: number };

// ---- promo codes --------------------------------------------------------------

export const normalizePromoCode = (code: unknown) =>
  typeof code === 'string' ? code.trim().toUpperCase().replace(/\s+/g, '') : '';

// Valid for this event right now? Checks dates, scope and remaining uses
// (completed uses plus tickets in orders still waiting for payment, so the
// last code can't be "sold" twice).
export async function findPromoCode(
  tenantId: string,
  eventId: string,
  rawCode: unknown,
  ticketsWanted: number
): Promise<{ promo: PromoCode } | PricingError> {
  const code = normalizePromoCode(rawCode);
  if (!code) return { error: 'Enter a promo code.', status: 400 };
  const promo = await prisma.promoCode.findUnique({ where: { tenantId_code: { tenantId, code } } });
  const now = new Date();
  if (!promo || !promo.isActive || (promo.eventId && promo.eventId !== eventId)) {
    return { error: `"${code}" isn't a valid promo code for this event.`, status: 404 };
  }
  if (promo.startsAt && promo.startsAt > now) return { error: `"${code}" isn't active yet.`, status: 409 };
  if (promo.endsAt && promo.endsAt < now) return { error: `"${code}" has expired.`, status: 409 };
  if (promo.maxUses !== null) {
    const pending = await prisma.pendingOrder.findMany({
      where: { promoCodeId: promo.id, status: 'pending', createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      select: { items: true },
    });
    const reserved = pending.reduce((n, o) => n + o.items.reduce((m, i) => m + i.quantity, 0), 0);
    const left = promo.maxUses - promo.usedCount - reserved;
    if (left <= 0) return { error: `"${code}" has been fully used.`, status: 409 };
    if (ticketsWanted > left) return { error: `"${code}" only has ${left} use${left === 1 ? '' : 's'} left.`, status: 409 };
  }
  return { promo };
}

function discountFor(promo: PromoCode, tierId: string, price: number) {
  if (promo.tierIds.length > 0 && !promo.tierIds.includes(tierId)) return 0;
  const raw = promo.discountType === 'percent' ? price * (promo.discountValue / 100) : promo.discountValue;
  return round2(Math.min(Math.max(raw, 0), price));
}

// ---- pricing -----------------------------------------------------------------

export function priceOrder(
  event: Pick<Event, 'passFeeToBuyer'>,
  tiers: TicketTier[],
  items: { ticketTierId: string; quantity: number }[],
  { promo = null, atDoor = false }: { promo?: PromoCode | null; atDoor?: boolean } = {}
): PricedOrder | PricingError {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Choose at least one ticket.', status: 400 };
  const lines: PricedLine[] = [];
  for (const item of items) {
    const tier = tiers.find((t) => t.id === item.ticketTierId);
    const quantity = Number(item.quantity);
    if (!tier) return { error: 'One of the selected ticket types is invalid.', status: 400 };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return { error: 'Ticket quantities must be whole numbers from 1 to 50.', status: 400 };
    }
    const basePrice = atDoor && tier.doorPrice !== null && tier.doorPrice !== undefined ? tier.doorPrice : tier.price;
    const discountPerTicket = promo ? discountFor(promo, tier.id, basePrice) : 0;
    const unitPrice = round2(basePrice - discountPerTicket);
    lines.push({
      ticketTierId: tier.id,
      tierName: tier.name,
      quantity,
      basePrice,
      discountPerTicket,
      unitPrice,
      feePerTicket: ticketFee(unitPrice),
    });
  }

  if (promo && lines.every((l) => l.discountPerTicket === 0)) {
    return { error: `"${promo.code}" doesn't apply to the tickets you picked.`, status: 409 };
  }

  const sum = (f: (l: PricedLine) => number) => round2(lines.reduce((n, l) => n + f(l) * l.quantity, 0));
  const subtotal = sum((l) => l.basePrice);
  const discount = sum((l) => l.discountPerTicket);
  const ticketsTotal = sum((l) => l.unitPrice);
  const fees = sum((l) => l.feePerTicket);
  const bookingFee = event.passFeeToBuyer ? fees : 0;
  return {
    lines,
    ticketCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal,
    discount,
    ticketsTotal,
    fees,
    bookingFee,
    total: round2(ticketsTotal + bookingFee),
    promo,
  };
}

export const isPricingError = (x: unknown): x is PricingError => !!x && typeof x === 'object' && 'error' in x;

