// src/lib/guests.ts
//
// Guest lists. An organiser adds people by name (plus any guests they may
// bring), with an email or WhatsApp number if they want the pass sent.
// Each guest gets one ticket per head on the event's hidden "Guest list"
// tier, under a KES 0 order of kind 'guest', so everything built for
// ticket holders works for guests too: the gate (scan the pass, or find the
// name), reminders, Event Space invites, surveys and certificates.
//
// There's no limit on guests: events without ticket sales pay for their
// Event Space rooms instead (src/lib/plans.ts).
import crypto from 'crypto';
import type { Event, Guest, TicketTier } from '@prisma/client';
import { prisma } from './prisma';
import { normalizeKenyanPhone } from './phone';
import { deliverTickets } from './orders';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_PLUS_ONES = 20;
export const MAX_GUESTS_PER_ADD = 500;
const GUEST_TIER_CAPACITY = 1_000_000; // guest lists have no real limit

const generateTicketCode = () => `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
// Room for a large party's passes over a slow link to the database.
const TX = { timeout: 20_000 };

export interface GuestInput {
  name: string;
  email?: string | null;
  whatsapp?: string | null;
  plusOnes?: number;
  group?: string | null;
  note?: string | null;
}

export interface CleanGuest {
  name: string;
  email: string | null;
  whatsapp: string | null;
  plusOnes: number;
  group: string | null;
  note: string | null;
}

const trimTo = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Checks one guest. Returns the cleaned guest or what's wrong with it.
export function cleanGuest(input: GuestInput): CleanGuest | string {
  const name = trimTo(input.name, 120);
  if (!name) return 'Every guest needs a name.';
  const email = trimTo(input.email, 200)?.toLowerCase() ?? null;
  if (email && !EMAIL_REGEX.test(email)) return `${name}: "${email}" isn't a valid email address.`;
  let whatsapp: string | null = null;
  if (trimTo(input.whatsapp, 40)) {
    whatsapp = normalizeKenyanPhone(input.whatsapp);
    if (!whatsapp) return `${name}: "${input.whatsapp}" isn't a valid phone number (e.g. 0712345678).`;
  }
  const plusOnes = Math.floor(Number(input.plusOnes ?? 0));
  if (!Number.isFinite(plusOnes) || plusOnes < 0 || plusOnes > MAX_PLUS_ONES) {
    return `${name}: guests they bring must be between 0 and ${MAX_PLUS_ONES}.`;
  }
  return { name, email, whatsapp, plusOnes, group: trimTo(input.group, 40), note: trimTo(input.note, 300) };
}

// A pasted list, one guest per line: name, then in any order an email, a
// phone number, "+2" for guests they bring, and a group ("Press"). Commas
// or tabs (a spreadsheet copy) between them.
export function parseGuestLines(text: string): { guests: CleanGuest[]; errors: string[] } {
  const guests: CleanGuest[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const input: GuestInput = { name: '' };
      const rest: string[] = [];
      for (const part of line.split(/\t|,|;/).map((p) => p.trim()).filter(Boolean)) {
        if (part.includes('@')) input.email = part;
        else if (/^\+\d{1,2}$/.test(part)) input.plusOnes = Number(part.slice(1));
        else if (/^[+\d][\d\s-]{6,}$/.test(part)) input.whatsapp = part;
        else rest.push(part);
      }
      input.name = rest[0] ?? '';
      input.group = rest[1] ?? null;
      const cleaned = cleanGuest(input);
      if (typeof cleaned === 'string') errors.push(`Line ${i + 1}: ${cleaned}`);
      else guests.push(cleaned);
    });
  return { guests, errors };
}

// The event's guest-list tier, created the first time it's needed.
export async function guestTier(eventId: string): Promise<TicketTier> {
  const existing = await prisma.ticketTier.findFirst({ where: { eventId, isGuestList: true } });
  if (existing) return existing;
  return prisma.ticketTier.create({
    data: {
      eventId,
      name: 'Guest list',
      price: 0,
      capacity: GUEST_TIER_CAPACITY,
      isActive: false,
      isGuestList: true,
      tierColor: '#0f766e',
    },
  });
}

const headName = (name: string, i: number) => (i === 0 ? name : `${name} +${i}`);

// Adds guests and issues their passes. `send`: email/WhatsApp each pass now
// (only for guests with an email or number).
// MongoDB aborts a transaction that collides with another write to the
// same document (the guest-list tier's count, say two admins adding guests
// at once); it's safe to run again.
async function withRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2034' || i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
}

// A new MongoDB ObjectId (time, then random), so a whole batch of guests,
// their orders and passes can be written in a handful of bulk inserts.
const objectId = () => Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') + crypto.randomBytes(8).toString('hex');

// Adds guests and issues their passes, in one transaction of bulk writes
// however long the list. `send`: email/WhatsApp each pass now (only for
// guests with an email or number).
export async function addGuests(
  event: Pick<Event, 'id' | 'tenantId'>,
  guests: CleanGuest[],
  { send }: { send: boolean }
): Promise<{ added: Guest[] }> {
  const tier = await guestTier(event.id);
  const now = new Date();
  const added: Guest[] = guests.map((g) => ({
    ...g,
    id: objectId(),
    orderId: objectId(),
    passSentAt: null,
    tenantId: event.tenantId,
    eventId: event.id,
    createdAt: now,
  }));
  const heads = guests.reduce((n, g) => n + 1 + g.plusOnes, 0);

  await withRetry(() => prisma.$transaction(async (tx) => {
    await tx.ticketTier.update({ where: { id: tier.id }, data: { sold: { increment: heads } } });
    await tx.pendingOrder.createMany({
      data: added.map((g) => ({
        id: g.orderId,
        kind: 'guest',
        status: 'completed' as const,
        paymentMethod: 'none',
        buyerName: g.name,
        buyerEmail: g.email ?? '',
        buyerPhone: g.whatsapp ?? '',
        buyerWhatsapp: g.whatsapp,
        totalAmount: 0,
        items: [{ ticketTierId: tier.id, quantity: 1 + g.plusOnes, unitPrice: 0 }],
        tenantId: event.tenantId,
        eventId: event.id,
      })),
    });
    await tx.ticket.createMany({
      data: added.flatMap((g) =>
        Array.from({ length: 1 + g.plusOnes }, (_, i) => ({
          ticketCode: generateTicketCode(),
          status: 'active' as const,
          buyerName: headName(g.name, i),
          buyerEmail: g.email ?? '',
          orderId: g.orderId,
          tenantId: event.tenantId,
          eventId: event.id,
          ticketTierId: tier.id,
        }))
      ),
    });
    // passSentAt written as null, not left out, so "not sent" queries match it.
    await tx.guest.createMany({ data: added });
  }, TX));

  if (send) {
    // In the background, one after another: WhatsApp sends are spaced out.
    (async () => {
      for (const guest of added) {
        if (guest.email || guest.whatsapp) await sendGuestPass(guest).catch((e) => console.error('CRITICAL_GUEST_PASS_ERROR:', guest.id, e));
      }
    })();
  }
  return { added };
}

const LIVE = ['active', 'scanned'] as const;

// Emails/WhatsApps the guest their passes (again).
export async function sendGuestPass(guest: Guest) {
  const order = await prisma.pendingOrder.findUnique({ where: { id: guest.orderId } });
  if (!order || (!guest.email && !guest.whatsapp)) return false;
  const tickets = await prisma.ticket.findMany({
    where: { orderId: order.id, status: { in: [...LIVE] } },
    orderBy: { createdAt: 'asc' },
    select: { ticketCode: true },
  });
  if (tickets.length === 0) return false;
  await prisma.guest.update({ where: { id: guest.id }, data: { passSentAt: new Date() } });
  await deliverTickets(
    { ...order, buyerName: guest.name, buyerEmail: guest.email ?? '', buyerWhatsapp: guest.whatsapp },
    tickets.map((t) => ({ ticketCode: t.ticketCode, tierName: 'Guest list' })),
    { guestList: true }
  );
  return true;
}

// Edits a guest. Changing how many people they bring adds passes or
// cancels ones not used yet.
export async function updateGuest(guest: Guest, changes: CleanGuest): Promise<{ guest?: Guest; error?: string }> {
  const tickets = await prisma.ticket.findMany({
    where: { orderId: guest.orderId, status: { in: [...LIVE] } },
    orderBy: { createdAt: 'asc' },
  });
  const want = 1 + changes.plusOnes;
  const extra = want - tickets.length;
  const unused = tickets.filter((t) => t.status === 'active').reverse(); // cancel the last-added first
  if (extra < 0 && unused.length < -extra) {
    return { error: `${tickets.length - unused.length} of ${guest.name}'s passes are already checked in.` };
  }
  const tier = await guestTier(guest.eventId);
  const updated = await withRetry(() => prisma.$transaction(async (tx) => {
    if (extra > 0) {
      await tx.ticketTier.update({ where: { id: tier.id }, data: { sold: { increment: extra } } });
      await tx.ticket.createMany({
        data: Array.from({ length: extra }, (_, k) => ({
          ticketCode: generateTicketCode(),
          status: 'active' as const,
          buyerName: headName(changes.name, tickets.length + k),
          buyerEmail: changes.email ?? '',
          orderId: guest.orderId,
          tenantId: guest.tenantId,
          eventId: guest.eventId,
          ticketTierId: tier.id,
        })),
      });
    } else if (extra < 0) {
      const drop = unused.slice(0, -extra).map((t) => t.id);
      await tx.ticket.updateMany({ where: { id: { in: drop } }, data: { status: 'cancelled' } });
      await tx.ticketTier.update({ where: { id: tier.id }, data: { sold: { decrement: drop.length } } });
    }
    // Names and contacts follow the guest onto their passes and order.
    if (changes.email !== guest.email) {
      await tx.ticket.updateMany({ where: { orderId: guest.orderId }, data: { buyerEmail: changes.email ?? '' } });
    }
    if (changes.name !== guest.name) {
      const kept = await tx.ticket.findMany({
        where: { orderId: guest.orderId, status: { in: [...LIVE] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      for (const [i, t] of kept.entries()) {
        await tx.ticket.update({ where: { id: t.id }, data: { buyerName: headName(changes.name, i) } });
      }
    }
    await tx.pendingOrder.update({
      where: { id: guest.orderId },
      data: {
        buyerName: changes.name,
        buyerEmail: changes.email ?? '',
        buyerPhone: changes.whatsapp ?? '',
        buyerWhatsapp: changes.whatsapp,
        items: [{ ticketTierId: tier.id, quantity: want, unitPrice: 0 }],
      },
    });
    return tx.guest.update({ where: { id: guest.id }, data: changes });
  }, TX));
  return { guest: updated };
}

// Takes someone off the list: their unused passes stop working. Anyone
// already checked in stays in the attendance records.
export async function removeGuest(guest: Guest) {
  const tier = await guestTier(guest.eventId);
  await withRetry(() => prisma.$transaction(async (tx) => {
    const unused = await tx.ticket.updateMany({
      where: { orderId: guest.orderId, status: 'active' },
      data: { status: 'cancelled' },
    });
    if (unused.count > 0) await tx.ticketTier.update({ where: { id: tier.id }, data: { sold: { decrement: unused.count } } });
    await tx.guest.delete({ where: { id: guest.id } });
  }, TX));
}

export interface GuestRow {
  id: string;
  name: string;
  email: string | null;
  whatsapp: string | null;
  plusOnes: number;
  group: string | null;
  note: string | null;
  passSentAt: Date | null;
  createdAt: Date;
  passes: { code: string; name: string; checkedIn: boolean }[];
}

// The list with each guest's passes and who has arrived.
export async function listGuests(eventId: string): Promise<GuestRow[]> {
  const guests = await prisma.guest.findMany({ where: { eventId }, orderBy: { name: 'asc' } });
  const tickets = await prisma.ticket.findMany({
    where: { orderId: { in: guests.map((g) => g.orderId) }, status: { in: [...LIVE] } },
    orderBy: { createdAt: 'asc' },
    select: { orderId: true, ticketCode: true, buyerName: true, status: true },
  });
  return guests.map((g) => ({
    id: g.id,
    name: g.name,
    email: g.email,
    whatsapp: g.whatsapp,
    plusOnes: g.plusOnes,
    group: g.group,
    note: g.note,
    passSentAt: g.passSentAt,
    createdAt: g.createdAt,
    passes: tickets
      .filter((t) => t.orderId === g.orderId)
      .map((t) => ({ code: t.ticketCode, name: t.buyerName, checkedIn: t.status === 'scanned' })),
  }));
}
