// src/lib/whatsapp.ts
//
// WhatsApp delivery via Baileys (unofficial WhatsApp Web protocol) — one
// shared number for the whole platform, connected by scanning a QR code
// from the platform-admin dashboard, the same way WhatsApp Web works on a
// browser. This is a stopgap until the business's official WhatsApp
// Business (Cloud API) account is approved; nothing else in the app
// depends on it, and every call site treats a send failure the same way it
// already treats an email failure — logged, never blocking the purchase or
// the ticket record.
//
// IMPORTANT: because this isn't an official integration, WhatsApp can
// disconnect or rate-limit the number at any time, without warning. This
// module is deliberately built so that never breaks ticket delivery:
// email is the source of truth, this is a convenience layer on top.
//
// Single-process assumption: the live socket lives in this process's
// memory. The login itself is stored in MongoDB (src/lib/whatsappAuthStore.ts),
// so it survives restarts and deploys without a disk — but only ONE
// long-running `next start` process may use it. Serverless functions or
// several instances would each connect with the same login and WhatsApp
// would keep kicking them off (and may ban the number).
import makeWASocket, {
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import mpesaService from './mpesaService';
import { formatEventDate } from './email';
import { clearStoredWhatsappSession, hasStoredWhatsappSession, useMongoAuthState } from './whatsappAuthStore';
import { renderTicketImages } from './ticketImage';

export type WhatsappStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected';

interface WhatsappState {
  sock: WASocket | null;
  starting: boolean;
  status: WhatsappStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  lastError: string | null;
}

// One connection per PROCESS, kept on globalThis in every environment:
// Next bundles API routes and the startup hook (src/instrumentation.ts)
// separately, and in production each bundle can get its own copy of this
// module — without this they'd each see (and open) a different socket.
// Also survives dev-mode hot reload.
const globalForWa = globalThis as unknown as { __tixflowWa?: WhatsappState; __tixflowWaOnOpen?: (() => void)[] };

const state: WhatsappState =
  globalForWa.__tixflowWa ??
  ({
    sock: null,
    starting: false,
    status: 'disconnected',
    qrDataUrl: null,
    phoneNumber: null,
    lastError: null,
  } as WhatsappState);

globalForWa.__tixflowWa = state;
const openListeners = (globalForWa.__tixflowWaOnOpen ??= []);

// Called every time the connection opens — used to flush the outbox
// (src/lib/whatsappOutbox.ts) without a circular import.
export function onWhatsappOpen(listener: () => void) {
  openListeners.push(listener);
}

const baileysLogger = pino({ level: 'warn' });

const clearSession = () =>
  clearStoredWhatsappSession().catch((err) => console.error('CRITICAL_WHATSAPP_SESSION_CLEAR_ERROR:', err));

export function getWhatsappStatus() {
  return {
    status: state.status,
    qr: state.qrDataUrl,
    phoneNumber: state.phoneNumber,
    lastError: state.lastError,
  };
}

export function isWhatsappConnected() {
  return state.status === 'connected' && !!state.sock;
}

// Serverless hosts (Vercel, AWS Lambda) run short-lived, parallel copies
// of the app — a Baileys connection can't stay open there, and copies
// would fight over the one login. Say so plainly instead of failing.
export const SERVERLESS_HOST_ERROR =
  'The QR-linked WhatsApp connection needs one long-running server (e.g. Render or Railway), not a serverless ' +
  'host like Vercel. Deploy there, or switch to the official Cloud API (WHATSAPP_PROVIDER=cloud).';

export const isServerlessHost = () => !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export async function connectWhatsapp() {
  if (state.starting || state.sock) return;
  if (isServerlessHost()) {
    state.status = 'disconnected';
    state.lastError = SERVERLESS_HOST_ERROR;
    return;
  }
  state.starting = true;
  state.status = 'connecting';
  state.lastError = null;

  try {
    // `useMongoAuthState` follows Baileys' naming (useMultiFileAuthState);
    // it's not a React hook. eslint-plugin-react-hooks can't tell from the name.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state: authState, saveCreds } = await useMongoAuthState();
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      // Keys cached in memory in front of the database — Baileys reads
      // them on every message.
      auth: { creds: authState.creds, keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger) },
      version,
      logger: baileysLogger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    state.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        state.qrDataUrl = await QRCode.toDataURL(qr);
        state.status = 'qr_pending';
      }

      if (connection === 'open') {
        const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || null;
        state.status = 'connected';
        state.qrDataUrl = null;
        state.phoneNumber = phoneNumber;
        state.lastError = null;
        for (const listener of openListeners) {
          try {
            listener();
          } catch (err) {
            console.error('WHATSAPP_OPEN_LISTENER_ERROR:', err);
          }
        }
      }

      if (connection === 'close') {
        state.sock = null;
        state.starting = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          await clearSession();
          state.status = 'disconnected';
          state.qrDataUrl = null;
          state.phoneNumber = null;
        } else {
          // Any other drop (network blip, server restart, WhatsApp's own
          // hiccups) — reconnect automatically rather than requiring the
          // admin to notice and re-scan. A real logout is the only case
          // that needs a human with the phone.
          state.status = 'connecting';
          connectWhatsapp().catch((err) => {
            state.lastError = err?.message || 'Failed to reconnect.';
          });
        }
      }
    });
  } catch (error: any) {
    state.sock = null;
    state.status = 'disconnected';
    state.lastError = error?.message || 'Failed to start WhatsApp session.';
    throw error;
  } finally {
    state.starting = false;
  }
}

export async function disconnectWhatsapp() {
  if (state.sock) {
    try {
      await state.sock.logout();
    } catch {
      // Best-effort — clear local state either way below.
    }
    state.sock = null;
  }
  await clearSession();
  state.status = 'disconnected';
  state.qrDataUrl = null;
  state.phoneNumber = null;
  state.lastError = null;
}

const RESUME_WAIT_MS = 15_000;

// Called before every send attempt so a plain server restart (login still
// stored, just not loaded into memory yet) doesn't require an admin to
// visit the dashboard first for sends to start working again. Waits for
// the connection to actually open, so the first message after a restart
// isn't dropped as "not connected".
export async function ensureResumed() {
  if (isServerlessHost()) return;
  if (!state.sock && !state.starting && state.status !== 'qr_pending' && (await hasStoredWhatsappSession())) {
    await connectWhatsapp().catch((err) => {
      state.lastError = err?.message || 'Failed to resume WhatsApp session.';
    });
  }
  const deadline = Date.now() + RESUME_WAIT_MS;
  while (state.status === 'connecting' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// Reconnects a stored login in the background — e.g. from the scheduled
// jobs, so the number is online again soon after a restart rather than
// only when the next message is due.
export function resumeWhatsappIfStored() {
  ensureResumed().catch((err) => console.error('WHATSAPP_RESUME_ERROR:', err));
}

const toWhatsappJid = (phone: string) => `${mpesaService.formatPhoneNumber(phone)}@s.whatsapp.net`;

interface SendResult {
  success: boolean;
  error?: string;
}

export async function sendWhatsappText(phone: string, text: string): Promise<SendResult> {
  await ensureResumed();
  if (!isWhatsappConnected()) {
    return { success: false, error: 'WhatsApp is not connected.' };
  }
  try {
    await state.sock!.sendMessage(toWhatsappJid(phone), { text });
    return { success: true };
  } catch (error: any) {
    console.error('CRITICAL_WHATSAPP_SEND_ERROR:', error);
    return { success: false, error: error?.message || 'Failed to send WhatsApp message.' };
  }
}

interface TicketWhatsappDetails {
  phone: string;
  buyerName: string;
  eventTitle: string;
  eventDate: Date | string;
  eventLocation: string;
  tickets: { ticketCode: string; tierName: string }[];
}

export async function sendTicketWhatsapp(details: TicketWhatsappDetails): Promise<SendResult> {
  await ensureResumed();
  if (!isWhatsappConnected()) {
    return { success: false, error: 'WhatsApp is not connected.' };
  }

  const jid = toWhatsappJid(details.phone);
  const plural = details.tickets.length > 1;

  try {
    await state.sock!.sendMessage(jid, {
      text:
        `Hi ${details.buyerName}, you're going to *${details.eventTitle}*!\n` +
        `${formatEventDate(details.eventDate)} · ${details.eventLocation}\n\n` +
        `Sending ${plural ? 'your tickets' : 'your ticket'} below — show the QR code${plural ? 's' : ''} at the door (save the image${plural ? 's' : ''} or print ${plural ? 'them' : 'it'}).`,
    });

    // The designed ticket card per ticket; a plain QR for any card that
    // couldn't be rendered.
    const cards = await renderTicketImages(details.tickets.map((t) => t.ticketCode)).catch(() => []);
    for (const [i, ticket] of details.tickets.entries()) {
      const card = cards.find((c) => c.ticketCode === ticket.ticketCode);
      const image = card?.data ?? (await QRCode.toBuffer(ticket.ticketCode, { type: 'png', width: 480, margin: 1 }));
      await state.sock!.sendMessage(jid, {
        image,
        caption: `${plural ? `Ticket ${i + 1} of ${details.tickets.length} · ` : ''}${ticket.tierName}\n${ticket.ticketCode}`,
      });
    }

    return { success: true };
  } catch (error: any) {
    console.error('CRITICAL_WHATSAPP_TICKET_SEND_ERROR:', error);
    return { success: false, error: error?.message || 'Failed to send tickets via WhatsApp.' };
  }
}
