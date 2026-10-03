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
// memory (and on disk at WA_SESSION_DIR). This only works correctly when
// the app runs as ONE long-running `next start` process — it will NOT
// work behind serverless functions or multiple clustered instances, since
// each instance would fight over the same WhatsApp session file and only
// one could ever hold the real connection.
import path from 'path';
import fs from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import mpesaService from './mpesaService';
import { formatEventDate } from './email';

export type WhatsappStatus = 'disconnected' | 'connecting' | 'qr_pending' | 'connected';

interface WhatsappState {
  sock: WASocket | null;
  starting: boolean;
  status: WhatsappStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  lastError: string | null;
}

// Survives Next.js dev-mode hot reload the same way src/lib/prisma.ts's
// PrismaClient singleton does — without this, every file edit in dev would
// spin up a second competing Baileys socket.
const globalForWa = globalThis as unknown as { __tixflowWa?: WhatsappState };

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

if (process.env.NODE_ENV !== 'production') globalForWa.__tixflowWa = state;

const SESSION_DIR = process.env.WA_SESSION_DIR || path.join(process.cwd(), 'wa-session');
const baileysLogger = pino({ level: 'warn' });

const clearSession = () => {
  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  }
};

// Baileys writes creds.json the moment pairing first succeeds — its
// presence means "resume this session automatically," independent of
// whether anyone has opened the admin dashboard since the server restarted.
const hasExistingSession = () => fs.existsSync(path.join(SESSION_DIR, 'creds.json'));

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

export async function connectWhatsapp() {
  if (state.starting || state.sock) return;
  state.starting = true;
  state.status = 'connecting';
  state.lastError = null;

  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    // `useMultiFileAuthState` is a Baileys utility, not a React hook — it
    // just happens to be named like one. eslint-plugin-react-hooks can't
    // tell the difference from the name alone.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: authState,
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
      }

      if (connection === 'close') {
        state.sock = null;
        state.starting = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          clearSession();
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
  clearSession();
  state.status = 'disconnected';
  state.qrDataUrl = null;
  state.phoneNumber = null;
  state.lastError = null;
}

// Called before every send attempt so a plain server restart (session
// still valid on disk, just not loaded into memory yet) doesn't require
// an admin to visit the dashboard first for sends to start working again.
async function ensureResumed() {
  if (!state.sock && !state.starting && state.status !== 'qr_pending' && hasExistingSession()) {
    await connectWhatsapp().catch((err) => {
      state.lastError = err?.message || 'Failed to resume WhatsApp session.';
    });
  }
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
        `Sending ${plural ? 'your tickets' : 'your ticket'} below — show the QR code${plural ? 's' : ''} at the door.`,
    });

    for (const ticket of details.tickets) {
      const qrBuffer = await QRCode.toBuffer(ticket.ticketCode, { type: 'png', width: 480, margin: 1 });
      await state.sock!.sendMessage(jid, {
        image: qrBuffer,
        caption: `${ticket.tierName}\n${ticket.ticketCode}`,
      });
    }

    return { success: true };
  } catch (error: any) {
    console.error('CRITICAL_WHATSAPP_TICKET_SEND_ERROR:', error);
    return { success: false, error: error?.message || 'Failed to send tickets via WhatsApp.' };
  }
}
