// src/lib/plans.ts
//
// Tixflow's pricing, in one place. Change numbers here (or the env vars)
// and everything — checkout, limits, the dashboard — follows.
//
// Paid events: the platform takes a fee per ticket sold (FEE_PERCENT, never
// less than MIN_TICKET_FEE) and every feature is included, with
// PAID_EVENT_ROOMS Event Space rooms.
// Free events: free up to the 'free' plan's limits; organisers buy a plan
// per event (M-Pesa or card) for more registrations, rooms and the
// conference extras (certificates, exhibitors).
import type { Event, TicketTier } from '@prisma/client';

export const FEE_PERCENT = () => Number(process.env.PLATFORM_FEE_PERCENT || 5);
export const MIN_TICKET_FEE = () => Number(process.env.MIN_TICKET_FEE || 20);

export type PlanId = 'free' | 'plus' | 'pro';

export interface PlanLimits {
  label: string;
  price: number; // KES per event
  registrations: number | null; // null = unlimited
  rooms: number;
  roomCapacity: number | null; // people in one Event Space room at a time
  extras: boolean; // certificates + exhibitor lead scanning
}

export const FREE_EVENT_PLANS: Record<PlanId, PlanLimits> = {
  free: { label: 'Free', price: 0, registrations: 300, rooms: 1, roomCapacity: 100, extras: false },
  plus: { label: 'Plus', price: 2500, registrations: 1000, rooms: 3, roomCapacity: 500, extras: true },
  pro: { label: 'Pro', price: 6000, registrations: null, rooms: 10, roomCapacity: null, extras: true },
};

// Paid (ticketed) events: everything included in the per-ticket fee.
export const PAID_EVENT_ROOMS = 3;
// A paid event that needs more rooms can still buy Pro for this many.
export const PAID_EVENT_PRO_ROOMS = FREE_EVENT_PLANS.pro.rooms;

// Gate equipment & staff the platform rents out for an event day.
export const RENTAL_RATES = {
  devicePerDay: Number(process.env.RENTAL_DEVICE_PER_DAY || 1500), // Sunmi V2s handheld scanner + printer
  staffPerDay: Number(process.env.RENTAL_STAFF_PER_DAY || 2000), // trained gate scanner
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// The platform's cut on one ticket at this (already discounted) price.
// Free tickets pay nothing; a ticket cheaper than the minimum fee pays its
// own price at most.
export function ticketFee(unitPrice: number) {
  if (unitPrice <= 0) return 0;
  return round2(Math.min(Math.max(unitPrice * (FEE_PERCENT() / 100), MIN_TICKET_FEE()), unitPrice));
}

export function isFreeEvent(tiers: Pick<TicketTier, 'price'>[]) {
  return tiers.length > 0 && tiers.every((t) => t.price <= 0);
}

export interface Entitlements {
  freeEvent: boolean;
  plan: PlanId | 'paid';
  planLabel: string;
  registrations: number | null;
  rooms: number;
  roomCapacity: number | null;
  extras: boolean;
}

// What this event may use right now.
export function eventEntitlements(event: Pick<Event, 'eventPlan'>, tiers: Pick<TicketTier, 'price'>[]): Entitlements {
  const bought = (event.eventPlan as PlanId | null) ?? null;
  if (!isFreeEvent(tiers)) {
    const pro = bought === 'pro';
    return {
      freeEvent: false,
      plan: pro ? 'pro' : 'paid',
      planLabel: pro ? 'Pro' : 'Included with ticket sales',
      registrations: null,
      rooms: pro ? PAID_EVENT_PRO_ROOMS : PAID_EVENT_ROOMS,
      roomCapacity: null,
      extras: true,
    };
  }
  const plan = bought && bought in FREE_EVENT_PLANS ? bought : 'free';
  const limits = FREE_EVENT_PLANS[plan];
  return {
    freeEvent: true,
    plan,
    planLabel: limits.label,
    registrations: limits.registrations,
    rooms: limits.rooms,
    roomCapacity: limits.roomCapacity,
    extras: limits.extras,
  };
}

// Plans this event could upgrade to, with prices.
export function availableUpgrades(event: Pick<Event, 'eventPlan'>, tiers: Pick<TicketTier, 'price'>[]) {
  const current = eventEntitlements(event, tiers);
  if (!current.freeEvent) {
    return current.plan === 'pro' ? [] : [{ id: 'pro' as PlanId, ...FREE_EVENT_PLANS.pro, rooms: PAID_EVENT_PRO_ROOMS }];
  }
  const order: PlanId[] = ['free', 'plus', 'pro'];
  return order
    .filter((id) => order.indexOf(id) > order.indexOf(current.plan as PlanId))
    .map((id) => ({ id, ...FREE_EVENT_PLANS[id] }));
}

// The entitlements of a stored event (loads its tiers).
export async function loadEntitlements(eventId: string) {
  const { prisma } = await import('./prisma');
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { eventPlan: true, ticketTiers: { select: { price: true } } },
  });
  return event ? eventEntitlements(event, event.ticketTiers) : null;
}

// Copy for a feature locked on this event's plan.
export const upgradeHint = (what: string) => `${what} Upgrade this event's plan under Plan & Gear.`;
