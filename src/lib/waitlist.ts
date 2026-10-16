// src/lib/waitlist.ts
//
// Waitlists for sold-out ticket types. People join from the event page.
// Whenever seats come back (a refund, a Lipa Pole Pole plan that expired,
// a cancelled ticket, more capacity), the next people in line get an
// offer: their seats are held for OFFER_HOLD_MS, so nobody else can buy
// them, and they get a link by email and WhatsApp that opens checkout with
// those tickets. An offer nobody takes up goes to the next person.
//
// Held seats (src/lib/holds.ts) are subtracted wherever availability is
// checked, except for the person they're held for.
import type { WaitlistEntry } from '@prisma/client';
import { prisma } from './prisma';
import { heldSeats } from './holds';
import { createLinkToken, verifyLinkToken } from './signedLinks';
import { getAppUrl } from './mpesaCallbacks';
import { normalizeKenyanPhone } from './phone';
import { sendWaitlistOfferEmail } from './email';
import { waitlistOfferMessage } from './whatsappTemplates';
import { deliverMessage } from './attendeeMessaging';

export const OFFER_HOLD_MS = 2 * 60 * 60_000;
export const MAX_WAITLIST_QUANTITY = 10;
// No offers this close to the start: there's no time to use them.
const STOP_OFFERS_BEFORE_MS = 30 * 60_000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const offerToken = (entryId: string) => createLinkToken('waitlist-offer', entryId);

// The live offer behind a link, if it's genuine and hasn't run out.
export async function offerFromToken(token: unknown): Promise<WaitlistEntry | null> {
  const id = verifyLinkToken('waitlist-offer', token);
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return null;
  const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
  if (!entry || entry.status !== 'offered' || !entry.offerExpiresAt || entry.offerExpiresAt <= new Date()) return null;
  return entry;
}

export async function joinWaitlist(input: {
  eventId: unknown;
  ticketTierId: unknown;
  name: unknown;
  email: unknown;
  whatsapp?: unknown;
  quantity?: unknown;
}): Promise<{ entry: WaitlistEntry; position: number } | { error: string; status: number }> {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!name || !EMAIL_REGEX.test(email)) return { error: 'Your name and a valid email are required.', status: 400 };
  const whatsapp = input.whatsapp ? normalizeKenyanPhone(input.whatsapp) : null;
  if (input.whatsapp && !whatsapp) return { error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.', status: 400 };
  const quantity = Math.floor(Number(input.quantity ?? 1));
  if (!(quantity >= 1 && quantity <= MAX_WAITLIST_QUANTITY)) {
    return { error: `Join for between 1 and ${MAX_WAITLIST_QUANTITY} tickets.`, status: 400 };
  }
  if (typeof input.eventId !== 'string' || typeof input.ticketTierId !== 'string') return { error: 'Choose a ticket type.', status: 400 };

  const tier = await prisma.ticketTier.findFirst({
    where: { id: input.ticketTierId, eventId: input.eventId, isActive: true, isGuestList: false },
    include: { event: true },
  });
  if (!tier || tier.event.status !== 'published' || tier.event.guestListOnly) return { error: 'Event not found.', status: 404 };
  if (!tier.event.waitlistEnabled) return { error: "This event doesn't have a waitlist.", status: 409 };
  const held = (await heldSeats([tier.id])).get(tier.id) ?? 0;
  if (tier.capacity - tier.sold - held >= quantity) {
    return { error: `${tier.name} tickets are available. Buy them on the event page.`, status: 409 };
  }

  // Joining again updates your place rather than adding a second one.
  const existing = await prisma.waitlistEntry.findFirst({
    where: { ticketTierId: tier.id, email, status: { in: ['waiting', 'offered'] } },
  });
  const entry = existing
    ? await prisma.waitlistEntry.update({ where: { id: existing.id }, data: { name, whatsapp, quantity } })
    : await prisma.waitlistEntry.create({
        data: { name, email, whatsapp, quantity, ticketTierId: tier.id, eventId: tier.eventId, tenantId: tier.event.tenantId },
      });
  const position = await prisma.waitlistEntry.count({
    where: { ticketTierId: tier.id, status: 'waiting', createdAt: { lte: entry.createdAt } },
  });
  return { entry, position: Math.max(position, 1) };
}

const formatUntil = (d: Date) =>
  d.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function sendOffer(entry: WaitlistEntry, ctx: { title: string; date: Date; tenantSlug: string; eventSlug: string; tierName: string }) {
  const url = `${getAppUrl()}/${ctx.tenantSlug}/${ctx.eventSlug}?offer=${offerToken(entry.id)}`;
  const what = `${entry.quantity} × ${ctx.tierName}`;
  const until = formatUntil(entry.offerExpiresAt!);
  await deliverMessage(
    { key: entry.email, name: entry.name, email: entry.email, whatsapp: entry.whatsapp, ticketCodes: [] },
    {
      email: (to) => sendWaitlistOfferEmail({ to, buyerName: entry.name, eventTitle: ctx.title, eventDate: ctx.date, what, until, url }),
      whatsapp: waitlistOfferMessage({ name: entry.name, what, eventTitle: ctx.title, until, url }),
    },
    'WAITLIST_OFFER'
  );
}

// Expires offers that ran out, then offers free seats to the next people
// in line. For one event, or every event with someone waiting.
export async function processWaitlist(eventId?: string, now = new Date()) {
  const expired = await prisma.waitlistEntry.updateMany({
    where: { status: 'offered', offerExpiresAt: { lte: now }, ...(eventId && { eventId }) },
    data: { status: 'expired' },
  });

  const eventIds = eventId
    ? [eventId]
    : [...new Set((await prisma.waitlistEntry.findMany({ where: { status: 'waiting' }, select: { eventId: true } })).map((e) => e.eventId))];

  let offered = 0;
  for (const id of eventIds) {
    const event = await prisma.event.findUnique({
      where: { id },
      include: { ticketTiers: true, tenant: { select: { slug: true } } },
    });
    if (!event || event.status !== 'published' || event.guestListOnly || !event.waitlistEnabled) continue;
    if (event.date.getTime() - now.getTime() < STOP_OFFERS_BEFORE_MS) continue;

    const held = await heldSeats(event.ticketTiers.map((t) => t.id));
    for (const tier of event.ticketTiers) {
      if (!tier.isActive || tier.isGuestList || (tier.salesEnd && tier.salesEnd < now)) continue;
      let free = tier.capacity - tier.sold - (held.get(tier.id) ?? 0);
      if (free <= 0) continue;
      const waiting = await prisma.waitlistEntry.findMany({
        where: { ticketTierId: tier.id, status: 'waiting' },
        orderBy: { createdAt: 'asc' },
      });
      // In order; someone who wants more than is free is passed over
      // (keeping their place) for the next person who fits.
      for (const entry of waiting) {
        if (free <= 0) break;
        if (entry.quantity > free) continue;
        const offerExpiresAt = new Date(now.getTime() + OFFER_HOLD_MS);
        const claim = await prisma.waitlistEntry.updateMany({
          where: { id: entry.id, status: 'waiting' },
          data: { status: 'offered', offeredAt: now, offerExpiresAt },
        });
        if (claim.count === 0) continue;
        free -= entry.quantity;
        offered++;
        await sendOffer(
          { ...entry, status: 'offered', offeredAt: now, offerExpiresAt },
          { title: event.title, date: event.date, tenantSlug: event.tenant.slug, eventSlug: event.slug, tierName: tier.name }
        ).catch((error) => console.error('CRITICAL_WAITLIST_OFFER_ERROR:', entry.id, error));
      }
    }
  }
  return { expired: expired.count, offered };
}

// Kicks the waitlist after seats came back, without making the caller wait.
export function nudgeWaitlist(eventId: string) {
  processWaitlist(eventId).catch((error) => console.error('CRITICAL_WAITLIST_PROCESS_ERROR:', eventId, error));
}
