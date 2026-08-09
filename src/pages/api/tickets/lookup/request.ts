// src/pages/api/tickets/lookup/request.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { createLookupToken } from "@/lib/ticketLookupAuth";
import { sendLookupMagicLinkEmail } from "@/lib/email";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const hasTickets = await prisma.ticket.findFirst({
    where: { buyerEmail: normalizedEmail },
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const magicLink = `${appUrl}/lookup/verify?token=${token}`;

  try {
    await sendLookupMagicLinkEmail(normalizedEmail, magicLink);
  } catch (error) {
    console.error("CRITICAL_LOOKUP_EMAIL_SEND_ERROR:", error);
    // Still respond with the generic success message — don't leak send
    // failures to the client, and don't block the flow.
  }

  return res.status(200).json(genericResponse);
}
