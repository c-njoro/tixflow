// src/pages/api/checkout/mpesa/initiate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import mpesaService from '@/lib/mpesaService';

// Daraja hard-limits these — AccountReference max 12 chars, TransactionDesc max 13.
const buildAccountReference = (orderId: string) => `TIX-${orderId.slice(-6)}`.slice(0, 12);

// Accepts 07XXXXXXXX and 01XXXXXXXX — Safaricom's original and newer ranges.
// Same shape WhatsApp numbers take in Kenya, so we reuse it for the
// optional WhatsApp field rather than a separate looser check.
const KENYA_PHONE_REGEX = /^0[17]\d{8}$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { eventId, buyerName, buyerEmail, buyerWhatsapp, phoneNumber, items } = req.body;

  if (!eventId || !buyerName || !buyerEmail || !phoneNumber) {
    return res.status(400).json({ error: 'eventId, buyerName, buyerEmail, and phoneNumber are required.' });
  }
  if (buyerWhatsapp && !KENYA_PHONE_REGEX.test(String(buyerWhatsapp).trim())) {
    return res.status(400).json({ error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.' });
  }
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
    if (!tier.isActive) return res.status(409).json({ error: `${tier.name} is not currently on sale.` });
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const order = await prisma.pendingOrder.create({
      data: {
        status: 'pending',
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.trim(),
        buyerWhatsapp: buyerWhatsapp ? String(buyerWhatsapp).trim() : null,
        buyerPhone: phoneNumber.trim(),
        totalAmount,
        items: orderItems,
        tenantId: tenant.id,
        eventId: event.id,
      },
    });

    const stkResult = await mpesaService.initiateSTKPush({
      phoneNumber: phoneNumber.trim(),
      amount: totalAmount,
      accountReference: buildAccountReference(order.id),
      callbackUrl: `${appUrl}/api/mpesa/callback`,
      transactionDesc: event.title.slice(0, 13),
    });

    if (!stkResult.success) {
      await prisma.pendingOrder.update({
        where: { id: order.id },
        data: { status: 'failed', failureReason: stkResult.error || 'Failed to initiate payment.' },
      });
      return res.status(502).json({ error: stkResult.error || 'Failed to start M-Pesa payment.' });
    }

    await prisma.pendingOrder.update({
      where: { id: order.id },
      data: {
        checkoutRequestId: stkResult.checkoutRequestId,
        merchantRequestId: stkResult.merchantRequestId,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        checkoutRequestId: stkResult.checkoutRequestId,
        customerMessage: stkResult.customerMessage,
      },
    });
  } catch (error) {
    console.error('CRITICAL_MPESA_INITIATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}