// src/pages/api/tickets/lookup/request.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { LOOKUP_GENERIC_MESSAGE, sendTicketLookupLink } from "@/lib/ticketLookup";
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

  await sendTicketLookupLink(normalizedEmail, whatsapp);

  // Same response whether or not this email has tickets — confirming or
  // denying it would let someone enumerate who bought tickets to what.
  return res.status(200).json({ success: true, message: LOOKUP_GENERIC_MESSAGE });
}
