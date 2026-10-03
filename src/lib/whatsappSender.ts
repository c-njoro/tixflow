// src/lib/whatsappSender.ts
//
// The one entry point for sending WhatsApp messages. Picks the provider
// from WHATSAPP_PROVIDER:
//   'baileys' (default) — the unofficial number linked by QR code in
//                         /platform-admin. Needs one long-running server
//                         with a persistent disk (see README).
//   'cloud'             — Meta's official Cloud API with approved
//                         templates (src/lib/whatsappTemplates.ts).
// Moving to Meta is configuration only: create the templates, set the
// Cloud API env vars, set WHATSAPP_PROVIDER=cloud.
import { sendTicketWhatsapp, sendWhatsappText } from './whatsapp';
import { cloudConfig, sendCloudTemplate, type SendResult } from './whatsappCloud';
import { ticketMessage, type WhatsappMessage } from './whatsappTemplates';
import { getAppUrl } from './mpesaCallbacks';

export type WhatsappProvider = 'baileys' | 'cloud';

export const getWhatsappProvider = (): WhatsappProvider =>
  process.env.WHATSAPP_PROVIDER === 'cloud' ? 'cloud' : 'baileys';

export function isWhatsappConfigured() {
  return getWhatsappProvider() === 'baileys' || !!cloudConfig();
}

// Sends one or more messages in order; succeeds if every one did.
export async function sendWhatsapp(phone: string, messages: WhatsappMessage | WhatsappMessage[]): Promise<SendResult> {
  const list = Array.isArray(messages) ? messages : [messages];
  for (const message of list) {
    const result =
      getWhatsappProvider() === 'cloud'
        ? await sendCloudTemplate(phone, message)
        : await sendWhatsappText(phone, message.text);
    if (!result.success) return result;
  }
  return { success: true };
}

interface TicketDetails {
  phone: string;
  buyerName: string;
  eventTitle: string;
  eventDate: Date | string;
  eventLocation: string;
  tickets: { ticketCode: string; tierName: string }[];
}

// Tickets with their QR codes. Baileys sends the QR images directly; the
// Cloud API sends one template per ticket with the QR as its header image
// (fetched by Meta from this app's public QR endpoint).
export async function sendTicketsWhatsapp(details: TicketDetails): Promise<SendResult> {
  if (getWhatsappProvider() === 'baileys') return sendTicketWhatsapp(details);
  return sendWhatsapp(
    details.phone,
    details.tickets.map((t) =>
      ticketMessage({
        name: details.buyerName,
        tierName: t.tierName,
        eventTitle: details.eventTitle,
        eventDate: details.eventDate,
        eventLocation: details.eventLocation,
        ticketCode: t.ticketCode,
        qrImageUrl: `${getAppUrl()}/api/tickets/qr/${encodeURIComponent(t.ticketCode)}`,
      })
    )
  );
}
