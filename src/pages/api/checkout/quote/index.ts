// src/pages/api/checkout/quote/index.ts
//
// What the selected tickets come to — promo code applied and booking fee
// included (when the event passes it on) — so checkout shows the real total
// before paying. Nothing is reserved; checkout checks everything again.
import type { NextApiRequest, NextApiResponse } from 'next';
import { findPromoCode, isPricingError, priceOrder } from '@/lib/pricing';
import { loadSellableEvent } from '@/lib/checkoutQuote';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const { eventId, items, promoCode } = req.body || {};
  // Slows down guessing promo codes.
  if (!rateLimit(res, `quote:ip:${getClientIp(req)}`, promoCode ? 30 : 120, 10 * 60_000)) return;

  const event = await loadSellableEvent(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  let promo = null;
  if (promoCode) {
    const tickets = Array.isArray(items) ? items.reduce((n: number, i: any) => n + (Number(i.quantity) || 0), 0) : 0;
    const found = await findPromoCode(event.tenantId, event.id, promoCode, Math.max(tickets, 1));
    if (isPricingError(found)) return res.status(found.status).json({ error: found.error, promoInvalid: true });
    promo = found.promo;
  }
  const priced = priceOrder(event, event.ticketTiers, items, { promo });
  if (isPricingError(priced)) {
    return res.status(priced.status).json({ error: priced.error, promoInvalid: !!promo });
  }
  return res.status(200).json({
    success: true,
    data: {
      promoCode: promo?.code ?? null,
      subtotal: priced.subtotal,
      discount: priced.discount,
      bookingFee: priced.bookingFee,
      total: priced.total,
    },
  });
}
