// src/lib/whatsappOutbox.ts
//
// Messages for the QR-linked (Baileys) number that couldn't go out right
// away — usually because the server just restarted and the connection is
// still coming back. They wait in MongoDB and are sent, oldest first and
// spaced out, as soon as the connection opens (or on the next scheduled
// run). Anything older than OUTBOX_TTL_MS is dropped: a "starts in 2 hours"
// reminder delivered a day late is worse than none.
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { isWhatsappConnected, onWhatsappOpen, sendTicketWhatsapp, sendWhatsappText } from './whatsapp';

const OUTBOX_TTL_MS = 24 * 60 * 60_000;
const SEND_GAP_MS = 2_500;
const MAX_ATTEMPTS = 3;

export interface TicketPayload {
  phone: string;
  buyerName: string;
  eventTitle: string;
  eventDate: Date | string;
  eventLocation: string;
  tickets: { ticketCode: string; tierName: string }[];
}

type Payload = { kind: 'text'; texts: string[] } | { kind: 'tickets'; details: TicketPayload };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function enqueueWhatsapp(phone: string, payload: Payload, orderId?: string) {
  await prisma.whatsappOutbox.create({
    data: { phone, payload: payload as unknown as Prisma.InputJsonValue, orderId: orderId ?? null },
  });
}

async function deliver(phone: string, payload: Payload) {
  if (payload.kind === 'tickets') return sendTicketWhatsapp(payload.details);
  for (const text of payload.texts) {
    const result = await sendWhatsappText(phone, text);
    if (!result.success) return result;
  }
  return { success: true };
}

// One flush at a time per process.
const globalForOutbox = globalThis as unknown as { __tixflowOutboxFlushing?: boolean; __tixflowOutboxHooked?: boolean };

export async function flushWhatsappOutbox() {
  if (globalForOutbox.__tixflowOutboxFlushing || !isWhatsappConnected()) return { sent: 0, skipped: true };
  globalForOutbox.__tixflowOutboxFlushing = true;
  const summary = { sent: 0, failed: 0, expired: 0 };
  try {
    const expired = await prisma.whatsappOutbox.updateMany({
      where: { status: 'queued', createdAt: { lt: new Date(Date.now() - OUTBOX_TTL_MS) } },
      data: { status: 'expired' },
    });
    summary.expired = expired.count;

    const queued = await prisma.whatsappOutbox.findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, take: 200 });
    for (const item of queued) {
      if (!isWhatsappConnected()) break; // dropped mid-flush — the rest wait for the next open
      // Claim it, so an overlapping flush never sends the same message twice.
      const claim = await prisma.whatsappOutbox.updateMany({
        where: { id: item.id, status: 'queued' },
        data: { status: 'sending', attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;

      const result = await deliver(item.phone, item.payload as unknown as Payload).catch((error: unknown) => ({
        success: false,
        error: error instanceof Error ? error.message : 'Send failed',
      }));
      if (result.success) {
        await prisma.whatsappOutbox.update({ where: { id: item.id }, data: { status: 'sent', sentAt: new Date(), lastError: null } });
        if (item.orderId) {
          await prisma.pendingOrder
            .update({ where: { id: item.orderId }, data: { whatsappStatus: 'sent', whatsappError: null } })
            .catch(() => {});
        }
        summary.sent++;
      } else {
        const giveUp = item.attempts + 1 >= MAX_ATTEMPTS;
        await prisma.whatsappOutbox.update({
          where: { id: item.id },
          data: { status: giveUp ? 'failed' : 'queued', lastError: result.error ?? null },
        });
        summary.failed++;
      }
      await sleep(SEND_GAP_MS);
    }
  } finally {
    globalForOutbox.__tixflowOutboxFlushing = false;
  }
  return summary;
}

// Flush whenever the connection (re)opens. Registered once per process.
if (!globalForOutbox.__tixflowOutboxHooked) {
  globalForOutbox.__tixflowOutboxHooked = true;
  onWhatsappOpen(() => {
    // Give WhatsApp a moment to finish its post-connect sync first.
    setTimeout(() => {
      flushWhatsappOutbox().catch((error) => console.error('CRITICAL_WHATSAPP_OUTBOX_FLUSH_ERROR:', error));
    }, 5_000);
  });
}
