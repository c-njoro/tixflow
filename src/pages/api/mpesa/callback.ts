// src/pages/api/mpesa/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import mpesaService from "@/lib/mpesaService";
import { hasValidCallbackSecret } from "@/lib/mpesaCallbacks";
import { fulfillPaidOrder, failPendingOrder } from "@/lib/orders";

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

  // Without this, anyone could POST a fake "ResultCode: 0" for their own
  // checkout and get tickets without paying.
  if (!hasValidCallbackSecret(req)) {
    console.error("CRITICAL_MPESA_CALLBACK_BAD_SECRET:", req.headers["x-forwarded-for"] || req.socket.remoteAddress);
    return res.status(403).json({ error: "Forbidden" });
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
  // that's already been resolved (fulfillPaidOrder also guards this
  // atomically; this just skips the work early).
  if (order.status !== "pending") {
    return res.status(200).json(ACK);
  }

  if (parsed.resultCode !== 0) {
    await failPendingOrder(
      order.id,
      mpesaService.getResultCodeDescription(parsed.resultCode),
    );
    return res.status(200).json(ACK);
  }

  // The STK push was for exactly Math.round(totalAmount) — anything else
  // means this callback isn't for the payment we asked for. Leave the order
  // pending: the reconcile job will ask Safaricom directly and settle it.
  if (Number(parsed.amount) !== Math.round(order.totalAmount)) {
    console.error("CRITICAL_MPESA_CALLBACK_AMOUNT_MISMATCH:", order.id, {
      expected: Math.round(order.totalAmount),
      received: parsed.amount,
    });
    return res.status(200).json(ACK);
  }

  try {
    await fulfillPaidOrder(order.id, parsed.mpesaReceiptNumber ?? null);
    return res.status(200).json(ACK);
  } catch (error) {
    console.error("CRITICAL_MPESA_CALLBACK_FULFILLMENT_ERROR:", error);
    // Unlike the ack-and-move-on cases above, this is our own failure
    // (e.g. a DB hiccup) — returning 500 lets Safaricom retry delivery, and
    // the reconcile job will also pick the order up if retries run out.
    return res.status(500).json({ error: "Failed to process callback." });
  }
}
