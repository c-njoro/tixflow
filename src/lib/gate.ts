// src/lib/gate.ts
//
// What happens when a ticket is scanned at the gate. Shared by the live
// scan API and the offline-sync API, so a scan made without signal gets
// exactly the same verdict when it syncs.
//
// Re-entry: an event allows `reentryLimit` re-entries per ticket. Leaving,
// the attendee scans OUT (marked outside); coming back they scan IN again,
// which counts one re-entry. A ticket scanned IN while it's already inside
// is rejected — that's a second person with a copy of the same QR code.
import type { Ticket } from '@prisma/client';
import { prisma } from './prisma';

export type Direction = 'in' | 'out';

export type ScanResult =
  | 'admitted' // first entry
  | 'reentry'
  | 'exit'
  | 'not_found'
  | 'wrong_event'
  | 'already_inside'
  | 'already_scanned' // used, and this event has no re-entry
  | 'no_reentries_left'
  | 'not_inside' // scanned out but was never let in / already out
  | 'cancelled'
  | 'refunded'
  | 'pending';

export interface ScanOutcome {
  status: number; // HTTP status for the live API
  success: boolean;
  result: ScanResult;
  error?: string;
  message?: string;
  data?: {
    buyerName: string;
    buyerEmail?: string;
    tierName: string;
    eventTitle?: string;
    scannedAt: Date | null;
    reentryCount: number;
    reentryLimit: number;
    reentriesLeft: number;
    isInside: boolean;
  };
}

type LoadedTicket = Ticket & {
  ticketTier: { name: string };
  event: { id: string; title: string; reentryLimit: number };
};

const details = (t: LoadedTicket, patch: Partial<Ticket> = {}) => {
  const ticket = { ...t, ...patch };
  return {
    buyerName: ticket.buyerName,
    buyerEmail: ticket.buyerEmail,
    tierName: t.ticketTier.name,
    eventTitle: t.event.title,
    scannedAt: ticket.scannedAt,
    reentryCount: ticket.reentryCount,
    reentryLimit: t.event.reentryLimit,
    reentriesLeft: Math.max(t.event.reentryLimit - ticket.reentryCount, 0),
    isInside: ticket.isInside,
  };
};

const reject = (status: number, result: ScanResult, error: string, ticket?: LoadedTicket): ScanOutcome => ({
  status,
  success: false,
  result,
  error,
  ...(ticket && { data: details(ticket) }),
});

// One attempt at the state change. Each update is conditional on the
// ticket being exactly as we read it, so two gates scanning the same code
// at the same moment can't both succeed — the loser re-reads and gets the
// right verdict (e.g. "already inside").
async function attempt(ticket: LoadedTicket, direction: Direction, staffId: string | null, at: Date): Promise<ScanOutcome | null> {
  const limit = ticket.event.reentryLimit;

  switch (ticket.status) {
    case 'cancelled':
      return reject(409, 'cancelled', 'This ticket has been cancelled.', ticket);
    case 'refunded':
      return reject(409, 'refunded', 'This ticket has been refunded.', ticket);
    case 'pending':
      return reject(409, 'pending', 'This ticket has not been paid for yet.');
  }

  if (direction === 'out') {
    if (ticket.status !== 'scanned' || !ticket.isInside) {
      return reject(409, 'not_inside', 'This ticket isn’t checked in — nothing to scan out.', ticket);
    }
    const done = await prisma.ticket.updateMany({
      where: { id: ticket.id, status: 'scanned', isInside: true },
      data: { isInside: false },
    });
    if (done.count === 0) return null;
    const left = Math.max(limit - ticket.reentryCount, 0);
    return {
      status: 200,
      success: true,
      result: 'exit',
      message:
        limit === 0
          ? 'Scanned out. This event has no re-entry.'
          : left === 0
            ? 'Scanned out. No re-entries left on this ticket.'
            : `Scanned out. ${left} re-entr${left === 1 ? 'y' : 'ies'} left.`,
      data: details(ticket, { isInside: false }),
    };
  }

  // direction 'in'
  if (ticket.status === 'active') {
    const done = await prisma.ticket.updateMany({
      where: { id: ticket.id, status: 'active' },
      data: { status: 'scanned', scannedAt: at, scannedById: staffId, isInside: true },
    });
    if (done.count === 0) return null;
    return { status: 200, success: true, result: 'admitted', data: details(ticket, { status: 'scanned', scannedAt: at, isInside: true }) };
  }

  // Already used.
  if (ticket.isInside) {
    return reject(
      409,
      limit > 0 ? 'already_inside' : 'already_scanned',
      limit > 0
        ? 'This ticket is already inside — it was never scanned out. Possible copied ticket.'
        : 'This ticket has already been scanned.',
      ticket
    );
  }
  if (limit === 0) return reject(409, 'already_scanned', 'This ticket has already been scanned. No re-entry at this event.', ticket);
  if (ticket.reentryCount >= limit) {
    return reject(409, 'no_reentries_left', `No re-entries left — this ticket has used all ${limit}.`, ticket);
  }
  const done = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: 'scanned', isInside: false, reentryCount: ticket.reentryCount },
    data: { isInside: true, reentryCount: { increment: 1 } },
  });
  if (done.count === 0) return null;
  const count = ticket.reentryCount + 1;
  return {
    status: 200,
    success: true,
    result: 'reentry',
    message: `Re-entry ${count} of ${limit}.`,
    data: details(ticket, { isInside: true, reentryCount: count }),
  };
}

export async function processScan({
  tenantId,
  eventId,
  ticketCode,
  direction,
  staffId,
  scannedAt = new Date(),
  offline = false,
}: {
  tenantId: string;
  eventId?: string | null;
  ticketCode: string;
  direction: Direction;
  staffId: string | null;
  scannedAt?: Date;
  offline?: boolean;
}): Promise<ScanOutcome> {
  // Scanners may hand over a URL or stray characters around the code.
  const upper = ticketCode.trim().toUpperCase();
  const code = upper.match(/TIX-[0-9A-F]{6,}/)?.[0] ?? upper;
  const load = () =>
    prisma.ticket.findFirst({
      where: { ticketCode: code, tenantId },
      include: { ticketTier: { select: { name: true } }, event: { select: { id: true, title: true, reentryLimit: true } } },
    });

  let ticket = await load();
  let outcome: ScanOutcome;
  if (!ticket) {
    outcome = reject(404, 'not_found', 'Ticket not found.');
  } else if (eventId && ticket.eventId !== eventId) {
    outcome = reject(400, 'wrong_event', `This ticket is for "${ticket.event.title}", not this event.`);
  } else {
    let result: ScanOutcome | null = null;
    // Lost a race → re-read and decide again (twice is plenty).
    for (let i = 0; i < 3 && !result && ticket; i++) {
      result = await attempt(ticket, direction, staffId, scannedAt);
      if (!result) ticket = await load();
    }
    outcome = result ?? reject(409, 'already_scanned', 'This ticket was just scanned at another gate.');
  }

  const logEventId = eventId || ticket?.eventId;
  if (logEventId) {
    await prisma.scanLog
      .create({
        data: {
          ticketId: ticket?.id ?? null,
          eventId: logEventId,
          ticketCode: code.slice(0, 64),
          direction,
          result: outcome.success ? (outcome.result as 'admitted' | 'reentry' | 'exit') : 'rejected',
          reason: outcome.success ? null : outcome.result,
          staffId,
          offline,
          scannedAt,
        },
      })
      .catch((error) => console.error('CRITICAL_SCAN_LOG_ERROR:', error));
  }
  return outcome;
}
