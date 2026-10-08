// src/pages/api/events/[id]/tickets/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { normalizeKenyanPhone } from '@/lib/phone';
import { deliverTickets } from '@/lib/orders';
import { freeRegistrationsUsed } from '@/lib/checkoutQuote';
import { eventEntitlements, upgradeHint } from '@/lib/plans';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateTicketCode = () =>
  `TIX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  const { id } = req.query; // event id
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid event id.' });

  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (req.method === 'GET') {
    const { status, ticketTierId } = req.query;

    const tickets = await prisma.ticket.findMany({
      where: {
        eventId: id,
        tenantId: session.tenantId,
        ...(typeof status === 'string' && { status: status as any }),
        ...(typeof ticketTierId === 'string' && { ticketTierId }),
      },
      include: { ticketTier: { select: { name: true, price: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // The WhatsApp number each ticket was delivered to, if any.
    const orderIds = [...new Set(tickets.map((t) => t.orderId).filter((oid): oid is string => !!oid))];
    const orders = orderIds.length
      ? await prisma.pendingOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, buyerWhatsapp: true } })
      : [];
    const whatsappByOrder = new Map(orders.map((o) => [o.id, o.buyerWhatsapp]));

    return res.status(200).json({
      success: true,
      data: tickets.map((t) => ({ ...t, whatsapp: (t.orderId && whatsappByOrder.get(t.orderId)) || null })),
    });
  }

  if (req.method === 'POST') {
    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can issue tickets.' });
    }

    const { ticketTierId, buyerName, buyerEmail, buyerWhatsapp } = req.body;
    if (!ticketTierId || !buyerName || !buyerEmail) {
      return res.status(400).json({ error: 'ticketTierId, buyerName, and buyerEmail are required.' });
    }
    const email = String(buyerEmail).toLowerCase().trim();
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const whatsapp = buyerWhatsapp ? normalizeKenyanPhone(buyerWhatsapp) : null;
    if (buyerWhatsapp && !whatsapp) {
      return res.status(400).json({ error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.' });
    }

    const tier = await prisma.ticketTier.findFirst({
      where: { id: ticketTierId, eventId: id },
    });
    if (!tier) return res.status(404).json({ error: 'Ticket tier not found.' });
    if (!tier.isActive) {
      return res.status(409).json({ error: 'This tier is not currently active for sale.' });
    }

    // Comps are free tickets: they count towards the event's plan limit.
    const withTiers = await prisma.event.findUniqueOrThrow({ where: { id }, include: { ticketTiers: true } });
    const limits = eventEntitlements(withTiers, withTiers.ticketTiers);
    if (limits.registrations !== null && (await freeRegistrationsUsed(withTiers)) >= limits.registrations) {
      return res.status(402).json({
        error: upgradeHint(`This event's plan includes ${limits.registrations.toLocaleString()} free tickets, and they're all used.`),
        upgrade: true,
      });
    }

    try {
      const ticket = await prisma.$transaction(async (tx) => {
        // Atomic compare-and-swap: only increments `sold` if it hasn't already
        // hit capacity at the moment of the write. This is what prevents two
        // concurrent requests from both grabbing the "last" spot in a tier.
        const claim = await tx.ticketTier.updateMany({
          where: { id: ticketTierId, sold: { lt: tier.capacity } },
          data: { sold: { increment: 1 } },
        });

        if (claim.count === 0) {
          throw new Error('SOLD_OUT');
        }

        // A KES 0 'comp' order alongside the ticket, like a sale has: it
        // records the WhatsApp number, so this holder also gets Event Space
        // links, reminders and surveys. totalAmount 0 → revenue unaffected.
        const order = await tx.pendingOrder.create({
          data: {
            kind: 'comp',
            status: 'completed',
            paymentMethod: 'none',
            buyerName: String(buyerName).trim().slice(0, 120),
            buyerEmail: email,
            buyerPhone: whatsapp ?? '',
            buyerWhatsapp: whatsapp,
            totalAmount: 0,
            items: [{ ticketTierId, quantity: 1, unitPrice: 0 }],
            tenantId: session.tenantId,
            eventId: id,
          },
        });

        const created = await tx.ticket.create({
          data: {
            ticketCode: generateTicketCode(),
            status: 'active',
            buyerName: String(buyerName).trim().slice(0, 120),
            buyerEmail: email,
            orderId: order.id,
            tenantId: session.tenantId,
            eventId: id,
            ticketTierId,
          },
          include: { ticketTier: { select: { name: true, price: true } } },
        });
        return { ticket: created, order };
      });

      // Send it — email always, WhatsApp if a number was given. Not awaited:
      // rendering the ticket image and the WhatsApp send take a few seconds.
      deliverTickets(ticket.order, [{ ticketCode: ticket.ticket.ticketCode, tierName: ticket.ticket.ticketTier.name }]).catch(
        (error) => console.error('CRITICAL_MANUAL_TICKET_DELIVERY_ERROR:', ticket.ticket.id, error)
      );

      return res.status(201).json({
        success: true,
        data: { ...ticket.ticket, whatsapp: whatsapp },
        message: `Ticket issued and sent to ${email}${whatsapp ? ` and WhatsApp ${whatsapp}` : ''}.`,
      });
    } catch (error: any) {
      if (error.message === 'SOLD_OUT') {
        return res.status(409).json({ error: 'This ticket tier is sold out.' });
      }
      // Extremely unlikely ticketCode collision — ask the client to retry.
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Ticket code collision, please try again.' });
      }
      console.error('CRITICAL_TICKET_CREATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}