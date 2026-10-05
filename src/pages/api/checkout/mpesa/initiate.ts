// src/pages/api/checkout/mpesa/initiate.ts
//
// Checkout by M-Pesa STK push. An order that comes to KES 0 (a free event,
// or a 100% promo code) needs no payment and is fulfilled right away.
import type { NextApiRequest, NextApiResponse } from 'next';
import { createFreeOrder, createOrderAndPush } from '@/lib/checkout';
import { isQuoteError, quoteCheckout } from '@/lib/checkoutQuote';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Every call pops a PIN prompt on someone's phone (or issues free
  // tickets) — don't let this be used to spam a number or flood an event.
  if (!rateLimit(res, `stk:ip:${getClientIp(req)}`, 10, 10 * 60_000)) return;

  const quote = await quoteCheckout(req.body || {}, { requirePhone: true });
  if (isQuoteError(quote)) return res.status(quote.status).json({ error: quote.error });

  try {
    if (quote.chargeNow <= 0) {
      const free = await createFreeOrder(quote.order);
      return res.status(200).json({ success: true, data: { ...free, free: true } });
    }

    const phone = quote.order.buyerPhone;
    if (!rateLimit(res, `stk:phone:${phone}`, 5, 10 * 60_000)) return;
    const result = await createOrderAndPush({ ...quote.order, paymentMethod: 'mpesa' }, quote.event.title);
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    return res.status(200).json({
      success: true,
      data: { orderId: result.orderId, accessKey: result.accessKey, customerMessage: result.customerMessage },
    });
  } catch (error) {
    console.error('CRITICAL_MPESA_INITIATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
