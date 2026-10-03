// src/pages/api/tickets/lookup/request.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { createLookupToken } from "@/lib/ticketLookupAuth";
import { sendLookupMagicLinkEmail } from "@/lib/email";
import { sendWhatsapp } from "@/lib/whatsappSender";
import { ticketLookupMessage } from "@/lib/whatsappTemplates";
import { getAppUrl } from "@/lib/mpesaCallbacks";
import { normalizeKenyanPhone } from "@/lib/phone";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { email, whatsapp } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Each request sends an email (and maybe a WhatsApp) — cap it per sender
  // and per inbox so this can't be used to spam someone.
  if (!rateLimit(res, `lookup:ip:${getClientIp(req)}`, 10, 15 * 60_000)) return;
  if (!rateLimit(res, `lookup:email:${normalizedEmail}`, 3, 15 * 60_000)) return;

  // `mode: insensitive` also matches tickets bought before emails were
  // stored lowercased.
  const emailFilter = { equals: normalizedEmail, mode: "insensitive" as const };

  const hasTickets = await prisma.ticket.findFirst({
    where: { buyerEmail: emailFilter },
    select: { id: true },
  });

  // Always return the same generic response whether or not this email has
  // tickets — confirming/denying existence here would let someone enumerate
  // which email addresses have bought tickets to what.
  const genericResponse = {
    success: true,
    message: "If that email has tickets, a link to view them has been sent.",
  };

  if (!hasTickets) {
    return res.status(200).json(genericResponse);
  }

  const token = createLookupToken(normalizedEmail);
  const magicLink = `${getAppUrl()}/lookup/verify?token=${token}`;

  try {
    await sendLookupMagicLinkEmail(normalizedEmail, magicLink);
  } catch (error) {
    console.error("CRITICAL_LOOKUP_EMAIL_SEND_ERROR:", error);
    // Still respond with the generic success message — don't leak send
    // failures to the client, and don't block the flow.
  }

  // The magic link is as good as the tickets themselves, so it only ever
  // goes to a WhatsApp number the buyer gave at checkout for this email —
  // never to whatever number is typed here, or anyone who knows a buyer's
  // email could have their tickets sent to themselves.
  const requestedWhatsapp = normalizeKenyanPhone(whatsapp);
  if (requestedWhatsapp) {
    const knownNumber = await prisma.pendingOrder.findFirst({
      where: {
        buyerEmail: emailFilter,
        buyerWhatsapp: requestedWhatsapp,
        status: "completed",
      },
      select: { id: true },
    });
    if (knownNumber) {
      try {
        await sendWhatsapp(requestedWhatsapp, ticketLookupMessage(magicLink));
      } catch (error) {
        console.error("CRITICAL_LOOKUP_WHATSAPP_SEND_ERROR:", error);
      }
    }
  }

  return res.status(200).json(genericResponse);
}
