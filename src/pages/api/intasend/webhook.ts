// src/pages/api/intasend/webhook.ts
//
// IntaSend's collection webhook. Set its URL in the IntaSend dashboard to
// {APP_URL}/api/intasend/webhook with the challenge INTASEND_WEBHOOK_CHALLENGE.
// The challenge proves the call is from IntaSend; even so, the order is only
// resolved from IntaSend's own record of the invoice (resolveCardOrder).
// Events can arrive out of order or more than once — resolving is idempotent.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { safeEqual } from '@/lib/secrets';
import { resolveCardOrder } from '@/lib/intasend';
import { failPendingOrder, fulfillPaidOrder } from '@/lib/orders';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const expected = process.env.INTASEND_WEBHOOK_CHALLENGE;
  const body = req.body || {};
  if (!expected || typeof body.challenge !== 'string' || !safeEqual(body.challenge, expected)) {
    return res.status(401).json({ error: 'Invalid challenge.' });
  }

  const apiRef = typeof body.api_ref === 'string' ? body.api_ref : '';
  const invoiceId = body.invoice_id ? String(body.invoice_id) : '';
  // Not one of our orders (e.g. a test event from the dashboard) — accept it.
  if (!/^[a-f0-9]{24}$/i.test(apiRef) || !invoiceId) return res.status(200).json({ received: true });

  const order = await prisma.pendingOrder.findUnique({ where: { id: apiRef } });
  if (!order || order.paymentMethod !== 'card') return res.status(200).json({ received: true });
  if (order.status !== 'pending') return res.status(200).json({ received: true, status: order.status });

  try {
    const status = await resolveCardOrder(order, invoiceId, fulfillPaidOrder, failPendingOrder);
    return res.status(200).json({ received: true, status });
  } catch (error) {
    console.error('CRITICAL_INTASEND_WEBHOOK_ERROR:', apiRef, error);
    // Non-2xx so IntaSend retries.
    return res.status(500).json({ error: 'Could not process.' });
  }
}
