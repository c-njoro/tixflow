// src/lib/plans.ts
//
// Tixflow's pricing, in one place. Change numbers here (or the env vars)
// and everything — checkout, limits, the dashboard — follows.
//
// Ticketed events (selling at least one paid ticket type): the platform
// takes a fee per ticket sold (FEE_PERCENT, never less than
// MIN_TICKET_FEE). Every feature is included, with one Event Space room of
// any size.
// Events with no ticket revenue (free registration, guest list only, an
// Event Space on its own): no fees and no limit on people; they pay for
// each Event Space room they open, priced by size (ROOM_SIZES).
// Ticketed events buy any extra rooms the same way. Certificates and
// exhibitor lead scanning come with ticket sales or with any bought room.
import type { Event, TicketTier } from '@prisma/client';

export const FEE_PERCENT = () => Number(process.env.PLATFORM_FEE_PERCENT || 5);
export const MIN_TICKET_FEE = () => Number(process.env.MIN_TICKET_FEE || 20);

export type RoomSize = 'small' | 'medium' | 'large';

// An Event Space room, by how many people can be in it at once.
export const ROOM_SIZES: Record<RoomSize, { label: string; capacity: number | null; price: number }> = {
  small: { label: 'Small', capacity: 100, price: Number(process.env.ROOM_PRICE_SMALL || 1000) },
  medium: { label: 'Medium', capacity: 500, price: Number(process.env.ROOM_PRICE_MEDIUM || 2500) },
  large: { label: 'Large', capacity: null, price: Number(process.env.ROOM_PRICE_LARGE || 5000) },
};
export const ROOM_SIZE_IDS = Object.keys(ROOM_SIZES) as RoomSize[];
export const isRoomSize = (v: unknown): v is RoomSize => typeof v === 'string' && v in ROOM_SIZES;

// Plans sold before rooms were priced one by one (Event.eventPlan). Events
// that bought one keep what it came with.
const LEGACY_PLANS: Record<string, { rooms: number; size: RoomSize }> = {
  plus: { rooms: 3, size: 'medium' },
  pro: { rooms: 10, size: 'large' },
};

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

// Does this event earn from ticket sales (and so get a room included)?
export function isTicketedEvent(
  event: Pick<Event, 'guestListOnly'>,
  tiers: Pick<TicketTier, 'price' | 'isGuestList'>[]
) {
  return !event.guestListOnly && tiers.some((t) => !t.isGuestList && t.price > 0);
}

// The room size a room created without one (before room pricing) has.
const legacyCapacity = (event: Pick<Event, 'eventPlan'>, ticketed: boolean) => {
  const legacy = event.eventPlan ? LEGACY_PLANS[event.eventPlan] : null;
  if (legacy) return ROOM_SIZES[legacy.size].capacity;
  return ticketed ? null : 100;
};

export interface RoomAllowance {
  ticketed: boolean;
  // The free room that comes with ticket sales (no size limit).
  included: { owned: number; used: number };
  // Bought rooms, per size.
  bought: Record<RoomSize, { owned: number; used: number }>;
  // Rooms of any kind that can still be opened.
  available: number;
  // Certificates and exhibitor lead scanning.
  extras: boolean;
  // People at once in a room opened before room pricing (null = no limit).
  legacyCapacity: number | null;
}

// What Event Space rooms this event has paid for (or got with ticket
// sales), and how many are in use.
export async function roomAllowance(eventId: string): Promise<RoomAllowance | null> {
  const { prisma } = await import('./prisma');
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { eventPlan: true, guestListOnly: true, ticketTiers: { select: { price: true, isGuestList: true } } },
  });
  if (!event) return null;
  const [purchases, spaces] = await Promise.all([
    prisma.pendingOrder.findMany({
      where: { eventId, kind: 'event_plan', status: 'completed', eventPlanTier: { in: ROOM_SIZE_IDS } },
      select: { eventPlanTier: true },
    }),
    prisma.eventSpace.findMany({ where: { eventId }, select: { size: true } }),
  ]);
  const ticketed = isTicketedEvent(event, event.ticketTiers);
  const bought = Object.fromEntries(
    ROOM_SIZE_IDS.map((size) => [
      size,
      {
        owned: purchases.filter((p) => p.eventPlanTier === size).length,
        used: spaces.filter((s) => s.size === size).length,
      },
    ])
  ) as RoomAllowance['bought'];
  const legacy = event.eventPlan ? LEGACY_PLANS[event.eventPlan] : null;
  if (legacy) bought[legacy.size].owned += legacy.rooms;
  const included = { owned: ticketed ? 1 : 0, used: spaces.filter((s) => s.size === 'included').length };
  const available =
    Math.max(included.owned - included.used, 0) +
    ROOM_SIZE_IDS.reduce((n, size) => n + Math.max(bought[size].owned - bought[size].used, 0), 0);
  return {
    ticketed,
    included,
    bought,
    available,
    extras: ticketed || !!legacy || purchases.length > 0,
    legacyCapacity: legacyCapacity(event, ticketed),
  };
}

// Which room a new Event Space takes: the size asked for if there's one
// free, otherwise the biggest free one (the included room first).
export function pickRoom(allowance: RoomAllowance, wanted?: unknown): 'included' | RoomSize | null {
  const free = (size: RoomSize) => allowance.bought[size].owned > allowance.bought[size].used;
  if (wanted === 'included' && allowance.included.owned > allowance.included.used) return 'included';
  if (isRoomSize(wanted) && free(wanted)) return wanted;
  if (allowance.included.owned > allowance.included.used) return 'included';
  return (['large', 'medium', 'small'] as RoomSize[]).find(free) ?? null;
}

// People at once in a room (null = no limit).
export function roomCapacity(size: string | null, allowance: Pick<RoomAllowance, 'legacyCapacity'>) {
  if (size === 'included') return null;
  if (isRoomSize(size)) return ROOM_SIZES[size].capacity;
  return allowance.legacyCapacity;
}

// Copy for something that needs a bought room.
export const roomHint = (what: string) => `${what} Buy one under Rooms & gear.`;

// The tiers an organiser sells and edits: everything but the hidden
// guest-list tier (src/lib/guests.ts).
export const salesTiers = <T extends Pick<TicketTier, 'isGuestList'>>(tiers: T[]) => tiers.filter((t) => !t.isGuestList);

// An event for the dashboard: its sales tiers, plus how many guest passes
// are out (they're not "sold" tickets).
export function forDashboard<E extends { ticketTiers: Pick<TicketTier, 'isGuestList' | 'sold'>[] }>(event: E) {
  return {
    ...event,
    ticketTiers: salesTiers(event.ticketTiers),
    guestPasses: event.ticketTiers.filter((t) => t.isGuestList).reduce((n, t) => n + t.sold, 0),
  };
}
