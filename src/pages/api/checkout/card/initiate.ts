// src/pages/api/checkout/card/initiate.ts
//
// Checkout by card (IntaSend). Same checks and prices as M-Pesa checkout;
// returns the IntaSend URL to send the buyer to. They come back to the
// event page with ?order=&key=, which polls /api/checkout/mpesa/status.
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { createFreeOrder } from '@/lib/checkout';
import { isQuoteError, quoteCheckout } from '@/lib/checkoutQuote';
import { startCardCheckout } from '@/lib/intasend';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `card:ip:${getClientIp(req)}`, 10, 10 * 60_000)) return;

  const quote = await quoteCheckout(req.body || {}, { requirePhone: false });
  if (isQuoteError(quote)) return res.status(quote.status).json({ error: quote.error });

  try {
    if (quote.chargeNow <= 0) {
      const free = await createFreeOrder(quote.order);
      return res.status(200).json({ success: true, data: { ...free, free: true } });
    }
    const order = await prisma.pendingOrder.create({
      data: {
        ...quote.order,
        paymentMethod: 'card',
        status: 'pending',
        accessKey: crypto.randomBytes(24).toString('base64url'),
      },
    });
    const result = await startCardCheckout(order);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({
      success: true,
      data: { orderId: order.id, accessKey: order.accessKey, redirectUrl: result.url },
    });
  } catch (error) {
    console.error('CRITICAL_CARD_INITIATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
