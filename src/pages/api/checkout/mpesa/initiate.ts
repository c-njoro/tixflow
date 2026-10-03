// src/pages/api/checkout/mpesa/initiate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { createOrderAndPush } from '@/lib/checkout';
import { installmentsOpen, minimumDeposit } from '@/lib/installments';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { normalizeKenyanPhone } from '@/lib/phone';
import { computeCommission, resolvePromoter } from '@/lib/promoters';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { eventId, buyerName, buyerEmail, buyerWhatsapp, phoneNumber, items, ref } = req.body;

  if (!eventId || !buyerName || !buyerEmail || !phoneNumber) {
    return res.status(400).json({ error: 'eventId, buyerName, buyerEmail, and phoneNumber are required.' });
  }
  if (!EMAIL_REGEX.test(String(buyerEmail).trim())) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  const mpesaPhone = normalizeKenyanPhone(phoneNumber);
  if (!mpesaPhone) {
    return res.status(400).json({ error: 'Enter a valid M-Pesa number (e.g. 0712345678).' });
  }
  const whatsappPhone = buyerWhatsapp ? normalizeKenyanPhone(buyerWhatsapp) : null;
  if (buyerWhatsapp && !whatsappPhone) {
    return res.status(400).json({ error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.' });
  }

  // Every call pops a PIN prompt on someone's phone — don't let this be
  // used to spam a number, or to hammer Daraja from one client.
  if (!rateLimit(res, `stk:ip:${getClientIp(req)}`, 10, 10 * 60_000)) return;
  if (!rateLimit(res, `stk:phone:${mpesaPhone}`, 5, 10 * 60_000)) return;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one ticket must be selected.' });
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, status: 'published' },
    include: { ticketTiers: true },
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: event.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Organizer not found.' });
  if (!tenant.isOnboarded) {
    return res.status(409).json({ error: 'This organizer has not finished payment setup yet.' });
  }

  // Validate every requested item against the event's actual tiers — never
  // trust price/availability sent from the client.
  let totalAmount = 0;
  const orderItems: { ticketTierId: string; quantity: number; unitPrice: number }[] = [];

  for (const item of items) {
    const tier = event.ticketTiers.find((t) => t.id === item.ticketTierId);
    const quantity = Number(item.quantity);

    if (!tier) return res.status(400).json({ error: 'One of the selected ticket tiers is invalid.' });
    const now = new Date();
    if (!tier.isActive || (tier.salesStart && tier.salesStart > now) || (tier.salesEnd && tier.salesEnd < now)) {
      return res.status(409).json({ error: `${tier.name} is not currently on sale.` });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Ticket quantities must be whole numbers of at least 1.' });
    }

    const available = tier.capacity - tier.sold;
    if (quantity > available) {
      return res.status(409).json({
        error: `Only ${available} ${tier.name} ticket${available === 1 ? '' : 's'} left.`,
      });
    }

    totalAmount += tier.price * quantity;
    orderItems.push({ ticketTierId: tier.id, quantity, unitPrice: tier.price });
  }

  if (totalAmount <= 0) {
    return res.status(400).json({ error: 'Order total must be greater than zero.' });
  }

  const ticketCount = orderItems.reduce((n, item) => n + item.quantity, 0);
  const promoter = await resolvePromoter(tenant.id, event.id, ref);
  const fullCommission = promoter ? computeCommission(promoter, { totalAmount, ticketCount }) : null;

  // Lipa Pole Pole: pay a deposit now, the rest by the event's deadline.
  // The deposit reserves the seats; tickets come when it's paid off.
  let chargeNow = totalAmount;
  let installment: { planTotal: number } | null = null;
  if (req.body.installment) {
    if (!installmentsOpen(event)) {
      return res.status(409).json({ error: 'Paying in instalments is not available for this event.' });
    }
    const deposit = Math.round(Number(req.body.installment.deposit));
    const minDeposit = minimumDeposit(event, totalAmount);
    if (!Number.isFinite(deposit) || deposit < minDeposit) {
      return res.status(400).json({ error: `The deposit must be at least KES ${minDeposit.toLocaleString()}.` });
    }
    // Paying it all now is just a normal purchase.
    if (deposit < totalAmount) {
      chargeNow = deposit;
      installment = { planTotal: totalAmount };
    }
  }

  try {
    const result = await createOrderAndPush(
      {
        buyerName: String(buyerName).trim().slice(0, 120),
        // Lowercased so ticket lookup by email always finds it.
        buyerEmail: String(buyerEmail).toLowerCase().trim(),
        buyerWhatsapp: whatsappPhone,
        buyerPhone: mpesaPhone,
        totalAmount: chargeNow,
        items: orderItems,
        tenantId: tenant.id,
        eventId: event.id,
        promoterId: promoter?.id ?? null,
        promoterCommission:
          fullCommission === null ? null : Math.round(((fullCommission * chargeNow) / totalAmount) * 100) / 100,
        ...(installment && {
          kind: 'installment_deposit',
          planTotal: installment.planTotal,
          planCommissionTotal: fullCommission,
        }),
      },
      event.title
    );
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
