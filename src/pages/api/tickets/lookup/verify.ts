// src/pages/api/tickets/lookup/verify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { verifyLookupToken } from "@/lib/ticketLookupAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { token } = req.query;
  if (typeof token !== "string") {
    return res.status(400).json({ error: "Missing token." });
  }

  const payload = verifyLookupToken(token);
  if (!payload) {
    return res
      .status(401)
      .json({
        error: "This link is invalid or has expired. Request a new one.",
      });
  }

  const tickets = await prisma.ticket.findMany({
    // Case-insensitive so tickets bought before emails were stored
    // lowercased still show up.
    where: { buyerEmail: { equals: payload.email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    include: {
      event: {
        select: {
          title: true,
          date: true,
          location: true,
          coverImageUrl: true,
        },
      },
      ticketTier: { select: { name: true } },
    },
  });

  return res.status(200).json({ success: true, data: tickets });
}
