// src/pages/api/mpesa/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import mpesaService from "@/lib/mpesaService";
import { sendTicketConfirmationEmail } from "@/lib/email";
import { sendTicketWhatsapp } from "@/lib/whatsapp";

const generateTicketCode = () =>
  `TIX-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

// mpesaService.js is plain JS — TypeScript's inferred return type for
// parseCallback() only picks up the properties set in its initial object
// literal, not the ones added conditionally inside `if (ResultCode === 0)`.
// This interface reflects what actually comes back at runtime.
interface ParsedMpesaCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount?: number;
  mpesaReceiptNumber?: string;
  transactionDate?: number;
  phoneNumber?: string;
  accountReference?: string;
}

// Daraja expects this exact ack shape on every call, regardless of whether
// the payment itself succeeded — this just confirms "we received the
// callback," so Safaricom stops retrying delivery of it.
const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  let parsed: ParsedMpesaCallback;
  try {
    parsed = mpesaService.parseCallback(req.body) as ParsedMpesaCallback;
  } catch (err) {
    console.error(
      "CRITICAL_MPESA_CALLBACK_PARSE_ERROR:",
      err,
      JSON.stringify(req.body),
    );
    // Malformed payload isn't something retrying will fix — ack anyway so
    // Safaricom doesn't hammer this endpoint with the same bad payload.
    return res.status(200).json(ACK);
  }

  const order = await prisma.pendingOrder.findFirst({
    where: { checkoutRequestId: parsed.checkoutRequestId },
  });

  if (!order) {
    console.error(
      "CRITICAL_MPESA_CALLBACK_ORDER_NOT_FOUND:",
      parsed.checkoutRequestId,
    );
    return res.status(200).json(ACK);
  }

  // Safaricom can and does redeliver callbacks — never re-process an order
  // that's already been resolved.
  if (order.status !== "pending") {
    return res.status(200).json(ACK);
  }

  if (parsed.resultCode !== 0) {
    await prisma.pendingOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        failureReason: mpesaService.getResultCodeDescription(parsed.resultCode),
      },
    });
    return res.status(200).json(ACK);
  }

  try {
    const shortfalls: string[] = [];
    const createdTickets: { ticketCode: string; tierName: string }[] = [];

    // Each item's claim needs its tier's current capacity read first, then
    // an atomic conditional update against that literal number — Prisma's
    // updateMany can't compare two fields on the same document directly.
    await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const tier = await tx.ticketTier.findUnique({
          where: { id: item.ticketTierId },
        });
        if (!tier) {
          shortfalls.push(
            `Ticket tier no longer exists (${item.quantity} tickets not issued).`,
          );
          continue;
        }

        const claim = await tx.ticketTier.updateMany({
          where: {
            id: item.ticketTierId,
            sold: { lte: tier.capacity - item.quantity },
          },
          data: { sold: { increment: item.quantity } },
        });

        if (claim.count === 0) {
          // Money has already been captured by M-Pesa at this point. We
          // can't silently drop the ticket — flag it loudly for manual
          // follow-up (refund or manual seat allocation) rather than
          // pretending nothing went wrong.
          shortfalls.push(
            `${item.quantity}x tier ${tier.name} sold out before this order could be fulfilled.`,
          );
          continue;
        }

        for (let i = 0; i < item.quantity; i++) {
          const newTicketCode = generateTicketCode();
          await tx.ticket.create({
            data: {
              ticketCode: newTicketCode,
              status: "active",
              buyerName: order.buyerName,
              buyerEmail: order.buyerEmail,
              mpesaReceiptNumber: parsed.mpesaReceiptNumber,
              orderId: order.id,
              tenantId: order.tenantId,
              eventId: order.eventId,
              ticketTierId: item.ticketTierId,
            },
          });
          createdTickets.push({
            ticketCode: newTicketCode,
            tierName: tier.name,
          });
        }
      }

      await tx.pendingOrder.update({
        where: { id: order.id },
        data: {
          status: "completed",
          mpesaReceiptNumber: parsed.mpesaReceiptNumber,
          failureReason: shortfalls.length > 0 ? shortfalls.join(" ") : null,
        },
      });
    });

    if (shortfalls.length > 0) {
      console.error(
        "CRITICAL_MPESA_OVERSOLD_AFTER_PAYMENT:",
        order.id,
        shortfalls,
      );
    }

    if (createdTickets.length > 0) {
      try {
        const event = await prisma.event.findUnique({
          where: { id: order.eventId },
          select: { title: true, date: true, location: true },
        });
        if (event) {
          await sendTicketConfirmationEmail({
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            eventTitle: event.title,
            eventDate: event.date,
            eventLocation: event.location,
            tickets: createdTickets,
          });
        }
      } catch (emailError) {
        // The purchase itself already succeeded — a failed confirmation
        // email shouldn't undo that or fail the webhook. The buyer can
        // still retrieve their tickets via /lookup.
        console.error("CRITICAL_TICKET_CONFIRMATION_EMAIL_ERROR:", emailError);
      }

      // WhatsApp is a convenience channel alongside email, never a
      // replacement for it — a failure here (including "not connected,"
      // which is expected any time the unofficial session has dropped)
      // never affects the order, the ticket, or the email that already
      // went out above.
      if (order.buyerWhatsapp) {
        try {
          const event = await prisma.event.findUnique({
            where: { id: order.eventId },
            select: { title: true, date: true, location: true },
          });
          if (event) {
            const result = await sendTicketWhatsapp({
              phone: order.buyerWhatsapp,
              buyerName: order.buyerName,
              eventTitle: event.title,
              eventDate: event.date,
              eventLocation: event.location,
              tickets: createdTickets,
            });
            await prisma.pendingOrder.update({
              where: { id: order.id },
              data: {
                whatsappStatus: result.success ? "sent" : "failed",
                whatsappError: result.success ? null : result.error,
              },
            });
          }
        } catch (whatsappError: any) {
          console.error("CRITICAL_TICKET_WHATSAPP_SEND_ERROR:", whatsappError);
          await prisma.pendingOrder
            .update({
              where: { id: order.id },
              data: { whatsappStatus: "failed", whatsappError: whatsappError?.message || "Unknown error" },
            })
            .catch(() => {});
        }
      }
    }

    return res.status(200).json(ACK);
  } catch (error) {
    console.error("CRITICAL_MPESA_CALLBACK_FULFILLMENT_ERROR:", error);
    // Unlike the ack-and-move-on cases above, this is our own failure
    // (e.g. a DB hiccup) — returning 500 lets Safaricom retry delivery so
    // we get another chance to fulfill an order that was actually paid for.
    return res.status(500).json({ error: "Failed to process callback." });
  }
}
