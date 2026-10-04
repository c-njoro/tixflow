// src/lib/spaceInvites.ts
//
// Sends ticket holders the links to their event's Event Spaces (rooms). A
// space created well before the event waits until INVITE_LEAD_MS before
// the start (picked up by /api/cron/scheduled); one created later than
// that sends right away. Tickets bought after the invites went out get the
// links along with their ticket (see deliverTickets in src/lib/orders.ts).
//
// Invites are per event, not per room: everyone gets one message listing
// every room that's due. A room added after the others' invites went out
// gets its own short follow-up.
import type { EventSpace, PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import { sendSpaceInviteEmail } from './email';
import { spaceUrl } from './eventSpace';
import { collectEventRecipients, deliverMessage, deliverToAll, recipientFromOrder } from './attendeeMessaging';
import { eventSpaceMessage } from './whatsappTemplates';

export const INVITE_LEAD_MS = 60 * 60_000;
// No invites for an event that has already finished.
const DEFAULT_EVENT_LENGTH_MS = 12 * 60 * 60_000;

interface EventTiming {
  date: Date;
  endDate: Date | null;
  status: string;
}

export const inviteDueAt = (event: EventTiming) => new Date(event.date.getTime() - INVITE_LEAD_MS);

export const eventEndsAt = (event: Pick<EventTiming, 'date' | 'endDate'>) =>
  event.endDate ?? new Date(event.date.getTime() + DEFAULT_EVENT_LENGTH_MS);

export function invitesAreDue(event: EventTiming, now = new Date()) {
  return event.status !== 'cancelled' && inviteDueAt(event) <= now && now < eventEndsAt(event);
}

type Room = Pick<EventSpace, 'title' | 'joinCode'>;

function inviteMessage(name: string, eventTitle: string, rooms: Room[]) {
  const links = rooms.map((r) => ({ title: r.title, url: spaceUrl(r.joinCode) }));
  return {
    email: (to: string) => sendSpaceInviteEmail({ to, buyerName: name, eventTitle, rooms: links }),
    whatsapp: eventSpaceMessage(name, eventTitle, links),
  };
}

// Step 1 — claim (pending → sending) every room of the event that's still
// waiting, and work out who gets the message. Safe to call from several
// places at once: invitesSentAt doubles as the claim marker, so each room's
// invites only ever go out once. Returns null if there was nothing to claim.
export async function claimSpaceInvites(eventId: string) {
  const claimedAt = new Date();
  const claim = await prisma.eventSpace.updateMany({
    where: { eventId, inviteStatus: 'pending', isOpen: true },
    data: { inviteStatus: 'sending', invitesSentAt: claimedAt },
  });
  if (claim.count === 0) return null;

  const rooms = await prisma.eventSpace.findMany({
    where: { eventId, inviteStatus: 'sending', invitesSentAt: claimedAt },
    orderBy: { createdAt: 'asc' },
  });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { title: true } });
  const recipients = await collectEventRecipients(eventId);
  return { eventTitle: event.title, rooms, recipients };
}

// Step 2 — send to everyone (slow on purpose: sends are spaced out), then
// mark the rooms sent.
export async function deliverClaimedInvites(claimed: NonNullable<Awaited<ReturnType<typeof claimSpaceInvites>>>) {
  const delivered = await deliverToAll(
    claimed.recipients,
    (r) => inviteMessage(r.name, claimed.eventTitle, claimed.rooms),
    'SPACE_INVITE'
  );
  await prisma.eventSpace.updateMany({
    where: { id: { in: claimed.rooms.map((r) => r.id) } },
    data: { inviteStatus: 'sent', invitesSentAt: new Date(), inviteCount: delivered },
  });
  return delivered;
}

export async function sendSpaceInvites(eventId: string): Promise<number> {
  const claimed = await claimSpaceInvites(eventId);
  return claimed ? deliverClaimedInvites(claimed) : 0;
}

// Kicks off sending in the background if the event's invites are due now.
export function sendSpaceInvitesIfDue(eventId: string, event: EventTiming) {
  if (!invitesAreDue(event)) return;
  sendSpaceInvites(eventId).catch((error) => console.error('CRITICAL_SPACE_INVITES_ERROR:', eventId, error));
}

export async function sendDueSpaceInvites() {
  const spaces = await prisma.eventSpace.findMany({
    where: { inviteStatus: 'pending', isOpen: true },
    include: { event: { select: { id: true, date: true, endDate: true, status: true } } },
  });

  const dueEventIds = [...new Set(spaces.filter((s) => invitesAreDue(s.event)).map((s) => s.event.id))];
  for (const eventId of dueEventIds) {
    try {
      await sendSpaceInvites(eventId);
    } catch (error) {
      console.error('CRITICAL_SPACE_INVITES_ERROR:', eventId, error);
    }
  }
  return { checkedRooms: spaces.length, eventsSent: dueEventIds.length };
}

// For a ticket bought after the event's room invites already went out.
export async function sendSpaceInviteForOrder(
  order: Pick<PendingOrder, 'eventId' | 'buyerName' | 'buyerEmail' | 'buyerWhatsapp'>,
  eventTitle: string
) {
  const rooms = await prisma.eventSpace.findMany({
    where: { eventId: order.eventId, isOpen: true, inviteStatus: 'sent' },
    orderBy: { createdAt: 'asc' },
  });
  if (rooms.length === 0) return;

  const delivered = await deliverMessage(
    recipientFromOrder(order),
    inviteMessage(order.buyerName, eventTitle, rooms),
    'SPACE_INVITE'
  );
  if (delivered) {
    await prisma.eventSpace.updateMany({
      where: { id: { in: rooms.map((r) => r.id) } },
      data: { inviteCount: { increment: 1 } },
    });
  }
}
