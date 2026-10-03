// src/lib/attendeeMessaging.ts
//
// Messaging an event's ticket holders by email and WhatsApp — used by
// Event Space invites, event reminders, feedback surveys and certificates.
//
// Sends are spaced out on purpose: the WhatsApp number is an unofficial
// Baileys session, and a burst of hundreds of identical messages is the
// quickest way to get it banned. Callers run this in the background.
import type { TicketStatus } from '@prisma/client';
import { prisma } from './prisma';
import { sendWhatsapp } from './whatsappSender';
import type { WhatsappMessage } from './whatsappTemplates';
import { normalizeKenyanPhone } from './phone';

const EMAIL_GAP_MS = 600;
const WHATSAPP_GAP_MS = 2_500;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Recipient {
  name: string;
  email: string | null;
  whatsapp: string | null;
  // The ticket codes this person holds for the event (for per-ticket links
  // such as certificates).
  ticketCodes: string[];
}

// One entry per person: tickets bought in one order (or several orders by
// the same buyer) share an email, and possibly a WhatsApp number.
export async function collectEventRecipients(
  eventId: string,
  statuses: TicketStatus[] = ['active', 'scanned']
): Promise<Recipient[]> {
  const tickets = await prisma.ticket.findMany({
    where: { eventId, status: { in: statuses } },
    select: { buyerName: true, buyerEmail: true, orderId: true, ticketCode: true },
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
      existing.ticketCodes.push(ticket.ticketCode);
    } else {
      byEmail.set(email, { name: ticket.buyerName, email, whatsapp, ticketCodes: [ticket.ticketCode] });
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

export interface Message {
  // Throws on failure, like the functions in src/lib/email.ts.
  email?: (to: string) => Promise<void>;
  // Built with src/lib/whatsappTemplates.ts so it works on either provider.
  whatsapp?: WhatsappMessage | WhatsappMessage[];
}

// Returns whether at least one channel reached the person.
export async function deliverMessage(recipient: Recipient, message: Message, label: string): Promise<boolean> {
  let delivered = false;
  if (recipient.email && message.email) {
    try {
      await message.email(recipient.email);
      delivered = true;
    } catch (error) {
      console.error(`CRITICAL_${label}_EMAIL_ERROR:`, recipient.email, error);
    }
    await sleep(EMAIL_GAP_MS);
  }
  if (recipient.whatsapp && message.whatsapp) {
    const result = await sendWhatsapp(recipient.whatsapp, message.whatsapp);
    if (result.success) delivered = true;
    await sleep(WHATSAPP_GAP_MS);
  }
  return delivered;
}

// Sends a personalised message to each recipient in turn; returns how many
// were reached.
export async function deliverToAll(
  recipients: Recipient[],
  build: (recipient: Recipient) => Message,
  label: string
): Promise<number> {
  let delivered = 0;
  for (const recipient of recipients) {
    if (await deliverMessage(recipient, build(recipient), label)) delivered++;
  }
  return delivered;
}

// For a single buyer straight after their order completes.
export const recipientFromOrder = (order: {
  buyerName: string;
  buyerEmail: string;
  buyerWhatsapp: string | null;
}): Recipient => ({
  name: order.buyerName,
  email: order.buyerEmail,
  whatsapp: normalizeKenyanPhone(order.buyerWhatsapp ?? ''),
  ticketCodes: [],
});

// "Starts in" text and a maps link people can tap on the way to the venue.
export const mapsLink = (location: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
