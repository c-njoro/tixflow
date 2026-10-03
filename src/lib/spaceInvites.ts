// src/lib/spaceInvites.ts
//
// Sends ticket holders the link to their event's Event Space. A space
// created well before the event waits until INVITE_LEAD_MS before the
// start (picked up by /api/cron/space-invites); one created later than
// that sends right away. Tickets bought after the invites went out get the
// link along with their ticket (see deliverTickets in src/lib/orders.ts).
//
// Sends are spaced out on purpose — the WhatsApp number is an unofficial
// Baileys session, and a burst of hundreds of identical messages is the
// quickest way to get it banned.
import type { PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import { sendSpaceInviteEmail } from './email';
import { sendWhatsappText } from './whatsapp';
import { normalizeKenyanPhone } from './phone';
import { spaceUrl } from './eventSpace';

export const INVITE_LEAD_MS = 60 * 60_000;
// No invites for an event that has already finished.
const DEFAULT_EVENT_LENGTH_MS = 12 * 60 * 60_000;
const EMAIL_GAP_MS = 600;
const WHATSAPP_GAP_MS = 2_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface EventTiming {
  date: Date;
  endDate: Date | null;
  status: string;
}

export const inviteDueAt = (event: EventTiming) => new Date(event.date.getTime() - INVITE_LEAD_MS);

const eventEndsAt = (event: EventTiming) => event.endDate ?? new Date(event.date.getTime() + DEFAULT_EVENT_LENGTH_MS);

export function invitesAreDue(event: EventTiming, now = new Date()) {
  return event.status !== 'cancelled' && inviteDueAt(event) <= now && now < eventEndsAt(event);
}

interface Recipient {
  name: string;
  email: string | null;
  whatsapp: string | null;
}

const whatsappMessage = (name: string, eventTitle: string, url: string) =>
  `Hi ${name}, *${eventTitle}* has a live space for attendees.\n\n` +
  `Open it during the event to follow the programme, answer live polls and ask questions:\n${url}`;

// One message per person: tickets bought in one order (or several orders
// by the same buyer) share an email, and possibly a WhatsApp number.
async function collectRecipients(eventId: string): Promise<Recipient[]> {
  const tickets = await prisma.ticket.findMany({
    where: { eventId, status: { in: ['active', 'scanned'] } },
    select: { buyerName: true, buyerEmail: true, orderId: true },
  });

  const orderIds = [...new Set(tickets.map((t) => t.orderId).filter((id): id is string => !!id))];
  const orders = orderIds.length
    ? await prisma.pendingOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, buyerWhatsapp: true } })
    : [];
  const whatsappByOrder = new Map(orders.map((o) => [o.id, o.buyerWhatsapp]));

  const byEmail = new Map<string, Recipient>();
  for (const ticket of tickets) {
    const email = ticket.buyerEmail.toLowerCase().trim();
    const whatsapp = ticket.orderId ? normalizeKenyanPhone(whatsappByOrder.get(ticket.orderId) ?? '') : null;
    const existing = byEmail.get(email);
    if (existing) {
      existing.whatsapp ??= whatsapp;
    } else {
      byEmail.set(email, { name: ticket.buyerName, email, whatsapp });
    }
  }

  // Two emails sharing one WhatsApp number (e.g. a parent who bought for
  // family) should still get only one WhatsApp message.
  const seenWhatsapp = new Set<string>();
  for (const recipient of byEmail.values()) {
    if (!recipient.whatsapp) continue;
    if (seenWhatsapp.has(recipient.whatsapp)) recipient.whatsapp = null;
    else seenWhatsapp.add(recipient.whatsapp);
  }
  return [...byEmail.values()];
}

async function deliverInvite(recipient: Recipient, eventTitle: string, spaceTitle: string, url: string) {
  let delivered = false;
  if (recipient.email) {
    try {
      await sendSpaceInviteEmail({ to: recipient.email, buyerName: recipient.name, eventTitle, spaceTitle, url });
      delivered = true;
    } catch (error) {
      console.error('CRITICAL_SPACE_INVITE_EMAIL_ERROR:', recipient.email, error);
    }
    await sleep(EMAIL_GAP_MS);
  }
  if (recipient.whatsapp) {
    const result = await sendWhatsappText(recipient.whatsapp, whatsappMessage(recipient.name, eventTitle, url));
    if (result.success) delivered = true;
    await sleep(WHATSAPP_GAP_MS);
  }
  return delivered;
}

// Safe to call from several places at once — the pending → sending claim
// means only one caller ever sends a given space's invites.
export async function sendSpaceInvites(spaceId: string): Promise<'sent' | 'already_handled'> {
  const claim = await prisma.eventSpace.updateMany({
    where: { id: spaceId, inviteStatus: 'pending' },
    data: { inviteStatus: 'sending' },
  });
  if (claim.count === 0) return 'already_handled';

  const space = await prisma.eventSpace.findUniqueOrThrow({
    where: { id: spaceId },
    include: { event: { select: { id: true, title: true } } },
  });
  const url = spaceUrl(space.joinCode);
  const recipients = await collectRecipients(space.event.id);

  let delivered = 0;
  for (const recipient of recipients) {
    if (await deliverInvite(recipient, space.event.title, space.title, url)) delivered++;
  }

  await prisma.eventSpace.update({
    where: { id: spaceId },
    data: { inviteStatus: 'sent', invitesSentAt: new Date(), inviteCount: delivered },
  });
  return 'sent';
}

// Kicks off sending in the background if the space's invites are due now.
// The request that triggered it doesn't wait for hundreds of messages.
export function sendSpaceInvitesIfDue(spaceId: string, event: EventTiming) {
  if (!invitesAreDue(event)) return;
  sendSpaceInvites(spaceId).catch((error) => console.error('CRITICAL_SPACE_INVITES_ERROR:', spaceId, error));
}

export async function sendDueSpaceInvites() {
  const spaces = await prisma.eventSpace.findMany({
    where: { inviteStatus: 'pending', isOpen: true },
    include: { event: { select: { date: true, endDate: true, status: true } } },
  });

  const due = spaces.filter((space) => invitesAreDue(space.event));
  for (const space of due) {
    try {
      await sendSpaceInvites(space.id);
    } catch (error) {
      console.error('CRITICAL_SPACE_INVITES_ERROR:', space.id, error);
    }
  }
  return { checked: spaces.length, sent: due.length };
}

// For a ticket bought after the space's invites already went out.
export async function sendSpaceInviteForOrder(order: PendingOrder, eventTitle: string) {
  const space = await prisma.eventSpace.findUnique({ where: { eventId: order.eventId } });
  if (!space || !space.isOpen || space.inviteStatus !== 'sent') return;

  const delivered = await deliverInvite(
    { name: order.buyerName, email: order.buyerEmail, whatsapp: normalizeKenyanPhone(order.buyerWhatsapp ?? '') },
    eventTitle,
    space.title,
    spaceUrl(space.joinCode)
  );
  if (delivered) {
    await prisma.eventSpace.update({ where: { id: space.id }, data: { inviteCount: { increment: 1 } } });
  }
}
