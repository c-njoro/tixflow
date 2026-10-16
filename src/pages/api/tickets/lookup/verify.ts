// src/pages/api/tickets/lookup/verify.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { verifyLookupToken } from "@/lib/ticketLookupAuth";
import { transferBlocker } from "@/lib/transfers";
import { OPEN_REFUND_STATUSES } from "@/lib/refunds";

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
          status: true,
          transfersEnabled: true,
          transferCutoffHours: true,
        },
      },
      ticketTier: { select: { name: true, isGuestList: true } },
    },
  });

  // The latest refund request covering each ticket, so the page can show it.
  const refunds = await prisma.refundRequest.findMany({
    where: { ticketIds: { hasSome: tickets.map((t) => t.id) } },
    orderBy: { createdAt: "desc" },
    select: { ticketIds: true, status: true, amount: true, organiserNote: true },
  });

  // Who each given-away ticket went to, and who gave the ones passed on.
  const linkedIds = tickets.flatMap((t) => [t.transferredToId, t.transferredFromId]).filter((id): id is string => !!id);
  const linked = linkedIds.length
    ? await prisma.ticket.findMany({ where: { id: { in: linkedIds } }, select: { id: true, buyerName: true } })
    : [];
  const nameOf = (id: string | null) => (id && linked.find((l) => l.id === id)?.buyerName) || null;

  return res.status(200).json({
    success: true,
    data: tickets.map((t) => {
      const refund = refunds.find((r) => r.ticketIds.includes(t.id));
      const openRefund = refund && OPEN_REFUND_STATUSES.includes(refund.status);
      // Only what the page needs: not the holder's WhatsApp or ticket ids.
      const { transferredToId, transferredFromId, event } = t;
      return {
        id: t.id,
        ticketCode: t.ticketCode,
        status: t.status,
        ticketTier: { name: t.ticketTier.name },
        event: { title: event.title, date: event.date, location: event.location, coverImageUrl: event.coverImageUrl },
        refund: refund ? { status: refund.status, organiserNote: refund.organiserNote } : null,
        transfer: {
          blocker: transferredToId
            ? "You gave this ticket away."
            : openRefund
              ? "A refund for this ticket is in progress."
              : transferBlocker(t),
          givenTo: nameOf(transferredToId),
          givenBy: nameOf(transferredFromId),
        },
      };
    }),
  });
}
