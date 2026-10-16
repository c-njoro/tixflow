// src/lib/transfers.ts
//
// Giving a ticket to someone else: "I can't make it, my friend is going."
// The holder proves who they are with the Find my tickets link (it's sent
// to their email), and names the new holder. Their ticket is cancelled and
// the new holder gets a brand-new ticket code, so a screenshot of the old
// QR can't get a second person in. Free, and nothing is resold: the order
// and the money stay with whoever paid.
//
// Not for guest-list passes (the organiser named those people), tickets
// still being paid off, used tickets, or ones with a refund in progress.
import crypto from 'crypto';
import type { Ticket } from '@prisma/client';
import { prisma } from './prisma';
import { deliverTickets } from './orders';
import { sendTicketTransferredEmail } from './email';
import { normalizeKenyanPhone } from './phone';
import { OPEN_REFUND_STATUSES } from './refunds';

const generateTicketCode = () => `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type TicketForCheck = Pick<Ticket, 'status' | 'ticketTierId'> & {
  ticketTier: { isGuestList: boolean };
  event: { date: Date; transfersEnabled: boolean; transferCutoffHours: number; status: string };
};

// Why this ticket can't be given away right now, or null if it can.
export function transferBlocker(t: TicketForCheck): string | null {
  if (t.ticketTier.isGuestList) return 'Guest list passes are in your name. Ask the organiser to change the guest list.';
  if (!t.event.transfersEnabled) return 'The organiser has turned off ticket transfers for this event.';
  if (t.event.status === 'cancelled') return 'This event has been cancelled.';
  if (t.status === 'pending') return 'Finish paying for this ticket before you give it to someone.';
  if (t.status !== 'active') return `This ticket is ${t.status === 'scanned' ? 'already used' : t.status}.`;
  const cutoff = t.event.date.getTime() - t.event.transferCutoffHours * 60 * 60_000;
  if (Date.now() > cutoff) {
    return t.event.transferCutoffHours > 0
      ? `Transfers close ${t.event.transferCutoffHours} hour${t.event.transferCutoffHours === 1 ? '' : 's'} before the event starts.`
      : 'This event has already started.';
  }
  return null;
}

export interface NewHolder {
  name: string;
  email: string;
  whatsapp: string | null;
}

export function cleanNewHolder(input: { name?: unknown; email?: unknown; whatsapp?: unknown }): NewHolder | string {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (name.length < 2) return 'Enter the name of the person you’re giving the ticket to.';
  const email = typeof input.email === 'string' ? input.email.toLowerCase().trim() : '';
  if (!EMAIL_REGEX.test(email)) return 'Enter their email address. Their ticket goes there.';
  const raw = typeof input.whatsapp === 'string' ? input.whatsapp.trim() : '';
  const whatsapp = raw ? normalizeKenyanPhone(raw) : null;
  if (raw && !whatsapp) return 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.';
  return { name, email, whatsapp };
}

// Gives the ticket `ticketId`, held by `email`, to `to`. Returns the new
// ticket's code.
export async function transferTicket(
  email: string,
  ticketId: string,
  to: NewHolder
): Promise<{ ticketCode: string } | { error: string; status: number }> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, buyerEmail: { equals: email, mode: 'insensitive' } },
    include: {
      ticketTier: { select: { name: true, isGuestList: true } },
      event: { select: { title: true, date: true, status: true, transfersEnabled: true, transferCutoffHours: true } },
    },
  });
  if (!ticket) return { error: 'Ticket not found.', status: 404 };
  const blocked = transferBlocker(ticket);
  if (blocked) return { error: blocked, status: 409 };
  if (to.email === email.toLowerCase().trim()) return { error: 'This ticket is already yours. Enter the other person’s email.', status: 400 };
  const refund = await prisma.refundRequest.findFirst({
    where: { ticketIds: { has: ticket.id }, status: { in: OPEN_REFUND_STATUSES } },
    select: { id: true },
  });
  if (refund) return { error: 'A refund for this ticket is in progress, so it can’t be given away.', status: 409 };

  const ticketCode = generateTicketCode();
  const now = new Date();
  const created = await prisma
    .$transaction(async (tx) => {
      const next = await tx.ticket.create({
        data: {
          ticketCode,
          status: 'active',
          buyerName: to.name,
          buyerEmail: to.email,
          holderWhatsapp: to.whatsapp,
          orderId: ticket.orderId,
          transferredFromId: ticket.id,
          transferredAt: now,
          tenantId: ticket.tenantId,
          eventId: ticket.eventId,
          ticketTierId: ticket.ticketTierId,
        },
      });
      // Only if it's still unused: a scan at the gate (or a second
      // transfer) at the same moment wins, and this rolls back.
      const old = await tx.ticket.updateMany({
        where: { id: ticket.id, status: 'active' },
        data: { status: 'cancelled', isInside: false, transferredToId: next.id, transferredAt: now },
      });
      if (old.count === 0) throw new Error('TICKET_CHANGED');
      return next;
    })
    .catch((error) => {
      if (error instanceof Error && error.message === 'TICKET_CHANGED') return null;
      throw error;
    });
  if (!created) return { error: 'This ticket was just used or changed. Refresh and try again.', status: 409 };

  // Sends don't hold up the answer; the new holder can also use Find my
  // tickets with their email.
  (async () => {
    await deliverTickets(
      {
        id: ticket.orderId ?? created.id,
        eventId: ticket.eventId,
        buyerName: to.name,
        buyerEmail: to.email,
        buyerWhatsapp: to.whatsapp,
        buyerPhone: to.whatsapp ?? '',
      },
      [{ ticketCode, tierName: ticket.ticketTier.name }],
      { fromName: ticket.buyerName }
    );
    await sendTicketTransferredEmail({
      to: ticket.buyerEmail,
      fromName: ticket.buyerName,
      toName: to.name,
      toEmail: to.email,
      eventTitle: ticket.event.title,
      eventDate: ticket.event.date,
      ticketCode: ticket.ticketCode,
    });
  })().catch((error) => console.error('CRITICAL_TICKET_TRANSFER_SEND_ERROR:', ticket.id, error));

  return { ticketCode };
}

// The WhatsApp number a ticket's holder can be reached on: their own if
// the ticket was passed to them, otherwise the buyer's (from the order).
export const holderWhatsapp = (
  ticket: Pick<Ticket, 'transferredFromId' | 'holderWhatsapp'>,
  orderWhatsapp: string | null | undefined
) => (ticket.transferredFromId ? ticket.holderWhatsapp : orderWhatsapp) ?? null;
