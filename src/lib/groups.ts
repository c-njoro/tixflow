// src/lib/groups.ts
//
// Group bookings: friends buying together without one person paying for
// everyone. Someone starts a group on the event page for a number of seats
// of one ticket type and pays for their own seat(s). They share the group
// link (/g/<code>) in their WhatsApp group; each friend pays their own
// share by M-Pesa and gets their own ticket in their own name.
//
// The unpaid seats are held for the group (src/lib/holds.ts) until the
// deadline: GROUP_WINDOW_MS after it's started, but never later than
// CLOSE_BEFORE_EVENT_MS before the event. Then they go back on sale (and
// to the waitlist first). Nobody is ever charged for someone else, so a
// group that doesn't fill needs no refunds.
//
// Until the starter's own payment goes through, the group only holds its
// seats for START_HOLD_MS, so an abandoned start can't lock seats up.
import crypto from 'crypto';
import type { GroupBooking, PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import { heldSeats } from './holds';
import { getAppUrl } from './mpesaCallbacks';
import { normalizeKenyanPhone } from './phone';
import { sendGroupEmail } from './email';
import { groupLinkMessage, groupUpdateMessage } from './whatsappTemplates';
import { deliverMessage } from './attendeeMessaging';
import { nudgeWaitlist } from './waitlist';

export const MIN_GROUP_SIZE = 2;
export const MAX_GROUP_SIZE = 20;
const START_HOLD_MS = 15 * 60_000;
const GROUP_WINDOW_MS = 48 * 60 * 60_000;
const CLOSE_BEFORE_EVENT_MS = 3 * 60 * 60_000;
// Not worth starting a group with less time than this to fill it.
const MIN_WINDOW_MS = 2 * 60 * 60_000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// No 0/O or 1/I: people read these codes out and type them.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const newCode = () => Array.from(crypto.randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

export const groupUrl = (code: string) => `${getAppUrl()}/g/${code}`;

export const groupDeadline = (event: { date: Date }, now = new Date()) =>
  new Date(Math.min(now.getTime() + GROUP_WINDOW_MS, event.date.getTime() - CLOSE_BEFORE_EVENT_MS));

const formatWhen = (d: Date) =>
  d.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const isLive = (g: Pick<GroupBooking, 'status' | 'expiresAt'>, now = new Date()) =>
  (g.status === 'pending' || g.status === 'open') && g.expiresAt > now;

export async function startGroup(input: {
  eventId: unknown;
  ticketTierId: unknown;
  size: unknown;
  name: unknown;
  email: unknown;
  whatsapp?: unknown;
}): Promise<{ group: GroupBooking } | { error: string; status: number }> {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!name || !EMAIL_REGEX.test(email)) return { error: 'Your name and a valid email are required.', status: 400 };
  const whatsapp = input.whatsapp ? normalizeKenyanPhone(input.whatsapp) : null;
  if (input.whatsapp && !whatsapp) return { error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.', status: 400 };
  const size = Math.floor(Number(input.size));
  if (!(size >= MIN_GROUP_SIZE && size <= MAX_GROUP_SIZE)) {
    return { error: `A group is between ${MIN_GROUP_SIZE} and ${MAX_GROUP_SIZE} people.`, status: 400 };
  }
  if (typeof input.eventId !== 'string' || typeof input.ticketTierId !== 'string') return { error: 'Choose a ticket type.', status: 400 };

  const tier = await prisma.ticketTier.findFirst({
    where: { id: input.ticketTierId, eventId: input.eventId, isActive: true, isGuestList: false },
    include: { event: true },
  });
  const event = tier?.event;
  if (!tier || !event || event.status !== 'published' || event.guestListOnly) return { error: 'Event not found.', status: 404 };
  if (!event.groupBookingEnabled) return { error: "This event doesn't take group bookings.", status: 409 };
  if (tier.price <= 0) return { error: 'Free tickets don’t need a group: everyone can register on their own.', status: 409 };
  if (groupDeadline(event).getTime() - Date.now() < MIN_WINDOW_MS) {
    return { error: 'It’s too close to the event to start a group. Buy your tickets together instead.', status: 409 };
  }
  const now = new Date();
  if ((tier.salesStart && tier.salesStart > now) || (tier.salesEnd && tier.salesEnd < now)) {
    return { error: `${tier.name} is not currently on sale.`, status: 409 };
  }
  const held = (await heldSeats([tier.id])).get(tier.id) ?? 0;
  const free = tier.capacity - tier.sold - held;
  if (free < size) {
    return { error: free <= 0 ? `${tier.name} is sold out.` : `Only ${free} ${tier.name} ticket${free === 1 ? '' : 's'} left.`, status: 409 };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const group = await prisma.groupBooking.create({
        data: {
          code: newCode(),
          size,
          ticketTierId: tier.id,
          leaderName: name,
          leaderEmail: email,
          leaderWhatsapp: whatsapp,
          status: 'pending',
          expiresAt: new Date(now.getTime() + START_HOLD_MS),
          tenantId: event.tenantId,
          eventId: event.id,
        },
      });
      return { group };
    } catch (error: unknown) {
      // A code collision: try another.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }
  return { error: 'Could not start the group. Please try again.', status: 500 };
}

// The group a checkout is paying into, if it's still taking payments.
export async function groupForCheckout(code: unknown) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{6,12}$/.test(code)) return null;
  const group = await prisma.groupBooking.findUnique({ where: { code } });
  return group && isLive(group) ? group : null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type GroupNews = { groupId: string; became: 'open' | 'complete' };

// A share was paid (inside the order's fulfilment transaction). The
// starter's first payment opens the group for the full window; the last
// seat completes it.
export async function recordGroupPayment(tx: Tx, order: Pick<PendingOrder, 'groupBookingId'>, seats: number): Promise<GroupNews | null> {
  if (!order.groupBookingId || seats <= 0) return null;
  const group = await tx.groupBooking.update({
    where: { id: order.groupBookingId },
    data: { paidSeats: { increment: seats } },
  });
  if (group.status === 'complete') return null;
  if (group.paidSeats >= group.size) {
    await tx.groupBooking.update({ where: { id: group.id }, data: { status: 'complete' } });
    return { groupId: group.id, became: 'complete' };
  }
  if (group.status === 'pending') {
    const event = await tx.event.findUniqueOrThrow({ where: { id: group.eventId }, select: { date: true } });
    await tx.groupBooking.update({ where: { id: group.id }, data: { status: 'open', expiresAt: groupDeadline(event) } });
    return { groupId: group.id, became: 'open' };
  }
  return null;
}

// Tells the starter: here's your link / everyone's paid / time's up.
export async function notifyGroupStarter(groupId: string, kind: 'started' | 'complete' | 'expired') {
  const group = await prisma.groupBooking.findUnique({ where: { id: groupId } });
  if (!group) return;
  const event = await prisma.event.findUnique({ where: { id: group.eventId }, select: { title: true } });
  if (!event) return;
  const url = groupUrl(group.code);
  const until = formatWhen(group.expiresAt);
  const update =
    kind === 'complete'
      ? `everyone has paid, all ${group.size} seats are booked`
      : `time's up with ${group.paidSeats} of ${group.size} seats paid. Everyone who paid has their ticket, and the unpaid seats went back on sale`;
  await deliverMessage(
    { key: group.leaderEmail, name: group.leaderName, email: group.leaderEmail, whatsapp: group.leaderWhatsapp, ticketCodes: [] },
    {
      email: (to) =>
        sendGroupEmail({ to, name: group.leaderName, eventTitle: event.title, url, kind, paid: group.paidSeats, size: group.size, until }),
      whatsapp:
        kind === 'started'
          ? groupLinkMessage({ name: group.leaderName, eventTitle: event.title, paid: group.paidSeats, size: group.size, url, until })
          : groupUpdateMessage({ name: group.leaderName, eventTitle: event.title, update, url }),
    },
    'GROUP_BOOKING'
  );
}

export function announceGroupNews(news: GroupNews | null | undefined) {
  if (!news) return;
  notifyGroupStarter(news.groupId, news.became === 'open' ? 'started' : 'complete').catch((error) =>
    console.error('CRITICAL_GROUP_NOTIFY_ERROR:', news.groupId, error)
  );
}

// Run by the scheduler: closes groups whose time is up. Their unpaid
// seats are already free (holds end at expiresAt); offer them to the
// waitlist and tell the starter how it went.
export async function expireGroups(now = new Date()) {
  const due = await prisma.groupBooking.findMany({
    where: { status: { in: ['pending', 'open'] }, expiresAt: { lte: now } },
    take: 200,
  });
  let expired = 0;
  for (const group of due) {
    const claim = await prisma.groupBooking.updateMany({
      where: { id: group.id, status: group.status },
      data: { status: 'expired' },
    });
    if (claim.count === 0) continue;
    expired++;
    nudgeWaitlist(group.eventId);
    // A start that was never paid for has nothing to report.
    if (group.status === 'open') {
      await notifyGroupStarter(group.id, 'expired').catch((error) => console.error('CRITICAL_GROUP_NOTIFY_ERROR:', group.id, error));
    }
  }
  return { expired };
}

// What the group page shows. Members appear by first name only.
export async function publicGroup(code: string) {
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return null;
  const group = await prisma.groupBooking.findUnique({ where: { code } });
  if (!group) return null;
  const [event, tier, orders] = await Promise.all([
    prisma.event.findUnique({
      where: { id: group.eventId },
      select: { id: true, title: true, slug: true, date: true, location: true, coverImageUrl: true, tenant: { select: { slug: true, businessName: true } } },
    }),
    prisma.ticketTier.findUnique({ where: { id: group.ticketTierId }, select: { id: true, name: true, price: true, tierColor: true } }),
    prisma.pendingOrder.findMany({
      where: { groupBookingId: group.id, status: 'completed' },
      orderBy: { createdAt: 'asc' },
      select: { buyerName: true, items: true },
    }),
  ]);
  if (!event || !tier) return null;
  const live = isLive(group);
  return {
    code: group.code,
    size: group.size,
    paidSeats: Math.min(group.paidSeats, group.size),
    // Expired-but-not-yet-swept counts as expired.
    status: group.status === 'pending' || group.status === 'open' ? (live ? group.status : 'expired') : group.status,
    expiresAt: group.expiresAt.toISOString(),
    starter: group.leaderName.split(' ')[0],
    members: orders.map((o) => ({ name: o.buyerName.split(' ')[0], seats: o.items.reduce((n, i) => n + i.quantity, 0) })),
    tier,
    event: {
      id: event.id,
      title: event.title,
      date: event.date.toISOString(),
      location: event.location,
      coverImageUrl: event.coverImageUrl,
      url: `/${event.tenant.slug}/${event.slug}`,
      organiser: event.tenant.businessName,
    },
  };
}
