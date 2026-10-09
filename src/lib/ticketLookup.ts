// src/lib/ticketLookup.ts
//
// "Find my tickets": emails a buyer a 15-minute link to their tickets, and
// sends it to WhatsApp too when the number matches one they gave at
// checkout. Shared by the lookup page (/api/tickets/lookup/request) and the
// website assistant (/api/assistant/send-ticket-link). Callers must answer
// with the same generic message whether or not anything was sent, so
// neither can be used to find out which emails have bought tickets.
import { prisma } from "./prisma";
import { createLookupToken } from "./ticketLookupAuth";
import { sendLookupMagicLinkEmail } from "./email";
import { sendWhatsapp } from "./whatsappSender";
import { ticketLookupMessage } from "./whatsappTemplates";
import { getAppUrl } from "./mpesaCallbacks";
import { normalizeKenyanPhone } from "./phone";

export const LOOKUP_GENERIC_MESSAGE = "If that email has tickets, a link to view them has been sent.";

export async function sendTicketLookupLink(email: string, whatsapp?: unknown) {
  const normalizedEmail = email.toLowerCase().trim();
  // `mode: insensitive` also matches tickets bought before emails were
  // stored lowercased.
  const emailFilter = { equals: normalizedEmail, mode: "insensitive" as const };

  const hasTickets = await prisma.ticket.findFirst({
    where: { buyerEmail: emailFilter },
    select: { id: true },
  });
  if (!hasTickets) return;

  const token = createLookupToken(normalizedEmail);
  const magicLink = `${getAppUrl()}/lookup/verify?token=${token}`;

  try {
    await sendLookupMagicLinkEmail(normalizedEmail, magicLink);
  } catch (error) {
    // Don't leak send failures to the caller, and don't block the flow.
    console.error("CRITICAL_LOOKUP_EMAIL_SEND_ERROR:", error);
  }

  // The magic link is as good as the tickets themselves, so it only ever
  // goes to a WhatsApp number the buyer gave at checkout for this email —
  // never to whatever number is typed here, or anyone who knows a buyer's
  // email could have their tickets sent to themselves.
  const requestedWhatsapp = normalizeKenyanPhone(whatsapp);
  if (!requestedWhatsapp) return;
  const knownNumber = await prisma.pendingOrder.findFirst({
    where: {
      buyerEmail: emailFilter,
      buyerWhatsapp: requestedWhatsapp,
      status: "completed",
    },
    select: { id: true },
  });
  if (!knownNumber) return;
  try {
    await sendWhatsapp(requestedWhatsapp, ticketLookupMessage(magicLink));
  } catch (error) {
    console.error("CRITICAL_LOOKUP_WHATSAPP_SEND_ERROR:", error);
  }
}
