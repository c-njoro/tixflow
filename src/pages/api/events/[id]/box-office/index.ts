// src/pages/api/events/[id]/box-office/index.ts
//
// Selling at the gate (admins and gate staff).
// GET  — tiers at their door prices, and box-office takings so far (cash
//        by seller, so cash can be counted against it at the end).
// POST — sell: { items, method: 'cash' | 'mpesa', buyerName?, buyerPhone?,
//        buyerEmail?, buyerWhatsapp? }.
//        cash  → tickets issued now; returned for printing / admitting.
//        mpesa → STK push to the buyer's phone; poll /api/checkout/mpesa/status.
//        Tickets go out by email / WhatsApp / SMS — whatever was given.
// Every sale carries the per-ticket platform fee; for cash the organiser
// already holds the money, so it's deducted from their next payout.
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { checkAvailability } from '@/lib/checkoutQuote';
import { createOrderAndPush } from '@/lib/checkout';
import { fulfillPaidOrder } from '@/lib/orders';
import { isPricingError, priceOrder } from '@/lib/pricing';
import { normalizeKenyanPhone } from '@/lib/phone';
import { ticketFee } from '@/lib/plans';
import { rateLimit } from '@/lib/rateLimit';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId }, include: { ticketTiers: true } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    const sales = await prisma.pendingOrder.groupBy({
      by: ['boxOfficeById', 'paymentMethod'],
      where: { eventId: event.id, status: 'completed', boxOfficeById: { not: null } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
    const sellerIds = [...new Set(sales.map((s) => s.boxOfficeById).filter((x): x is string => !!x))];
    const sellers = await prisma.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true } });
    return res.status(200).json({
      success: true,
      data: {
        title: event.title,
        date: event.date,
        location: event.location,
        status: event.status,
        passFeeToBuyer: event.passFeeToBuyer,
        tiers: event.ticketTiers
          .filter((t) => t.isActive)
          .map((t) => ({
            id: t.id,
            name: t.name,
            tierColor: t.tierColor,
            price: t.doorPrice ?? t.price,
            fee: ticketFee(t.doorPrice ?? t.price),
            onlinePrice: t.price,
            available: Math.max(t.capacity - t.sold, 0),
          })),
        takings: sales.map((s) => ({
          seller: sellers.find((u) => u.id === s.boxOfficeById)?.name ?? 'Former staff',
          sellerId: s.boxOfficeById,
          mine: s.boxOfficeById === session.userId,
          method: s.paymentMethod,
          orders: s._count._all,
          total: s._sum.totalAmount ?? 0,
        })),
      },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (event.status === 'cancelled') return res.status(409).json({ error: 'This event is cancelled.' });
  if (!rateLimit(res, `box-office:${session.userId}`, 120, 10 * 60_000)) return;

  const b = req.body || {};
  const method = b.method === 'mpesa' ? 'mpesa' : b.method === 'cash' ? 'cash' : null;
  if (!method) return res.status(400).json({ error: 'Choose cash or M-Pesa.' });
  const phone = b.buyerPhone ? normalizeKenyanPhone(b.buyerPhone) : null;
  if (b.buyerPhone && !phone) return res.status(400).json({ error: 'Enter a valid phone number (e.g. 0712345678).' });
  if (method === 'mpesa' && !phone) return res.status(400).json({ error: 'Enter the buyer’s M-Pesa number.' });
  const whatsapp = b.buyerWhatsapp ? normalizeKenyanPhone(b.buyerWhatsapp) : null;
  if (b.buyerWhatsapp && !whatsapp) return res.status(400).json({ error: 'Enter a valid WhatsApp number, or leave it blank.' });
  const email = typeof b.buyerEmail === 'string' ? b.buyerEmail.trim().toLowerCase() : '';
  if (email && !EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Enter a valid email, or leave it blank.' });

  const unavailable = checkAvailability(event, Array.isArray(b.items) ? b.items : [], { atDoor: true });
  if (unavailable) return res.status(unavailable.status).json({ error: unavailable.error });
  const priced = priceOrder(event, event.ticketTiers, b.items, { atDoor: true });
  if (isPricingError(priced)) return res.status(priced.status).json({ error: priced.error });

  const order = {
    buyerName: (typeof b.buyerName === 'string' && b.buyerName.trim().slice(0, 120)) || 'Walk-in',
    buyerEmail: email,
    buyerPhone: phone ?? whatsapp ?? '',
    buyerWhatsapp: whatsapp,
    totalAmount: priced.total,
    subtotal: priced.subtotal,
    platformFee: priced.fees,
    items: priced.lines.map((l) => ({ ticketTierId: l.ticketTierId, quantity: l.quantity, unitPrice: l.unitPrice })),
    tenantId: event.tenantId,
    eventId: event.id,
    boxOfficeById: session.userId,
  };

  try {
    if (method === 'mpesa' && priced.total > 0) {
      const result = await createOrderAndPush({ ...order, paymentMethod: 'mpesa' }, event.title);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(200).json({
        success: true,
        data: { orderId: result.orderId, accessKey: result.accessKey, total: priced.total, method },
      });
    }

    // Cash (or a KES 0 door ticket): the money is in hand — issue now.
    const created = await prisma.pendingOrder.create({
      data: {
        ...order,
        paymentMethod: priced.total > 0 ? 'cash' : 'free',
        status: 'pending',
        accessKey: crypto.randomBytes(24).toString('base64url'),
      },
    });
    await fulfillPaidOrder(created.id, null);
    const done = await prisma.pendingOrder.findUniqueOrThrow({ where: { id: created.id } });
    const tickets = await prisma.ticket.findMany({
      where: { orderId: created.id },
      select: { ticketCode: true, ticketTier: { select: { name: true } } },
    });
    if (tickets.length === 0) {
      return res.status(409).json({ error: done.failureReason || 'Sold out — no tickets were issued. Return the cash.' });
    }
    return res.status(200).json({
      success: true,
      data: {
        orderId: created.id,
        accessKey: created.accessKey,
        total: priced.total,
        method,
        warning: done.failureReason,
        tickets: tickets.map((t) => ({ ticketCode: t.ticketCode, tierName: t.ticketTier.name })),
      },
    });
  } catch (error) {
    console.error('CRITICAL_BOX_OFFICE_SALE_ERROR:', event.id, error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
