// src/pages/api/checkout/intasend/initiate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { initiateMpesaCollection } from '@/lib/intasend';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { eventId, firstName, lastName, buyerEmail, phoneNumber, items } = req.body;

  if (!eventId || !firstName || !lastName || !buyerEmail || !phoneNumber) {
    return res.status(400).json({
      error: 'eventId, firstName, lastName, buyerEmail, and phoneNumber are required.',
    });
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

  try {
    const order = await prisma.pendingOrder.create({
      data: {
        status: 'pending',
        buyerName: `${firstName.trim()} ${lastName.trim()}`,
        buyerEmail: buyerEmail.trim(),
        buyerPhone: phoneNumber.trim(),
        totalAmount,
        items: orderItems,
        tenantId: tenant.id,
        eventId: event.id,
      },
    });

    // api_ref is set to our own order id — this is exactly what the
    // collection webhook echoes back, so we can find this order again
    // without needing IntaSend's invoice_id up front.
    const result = await initiateMpesaCollection({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: buyerEmail.trim(),
      phoneNumber: phoneNumber.trim(),
      amount: totalAmount,
      apiRef: order.id,
    });

    if (!result.success) {
      await prisma.pendingOrder.update({
        where: { id: order.id },
        data: { status: 'failed', failureReason: result.error },
      });
      return res.status(502).json({ error: result.error || 'Failed to start payment.' });
    }

    return res.status(200).json({ success: true, data: { orderId: order.id } });
  } catch (error) {
    console.error('CRITICAL_INTASEND_CHECKOUT_INITIATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}