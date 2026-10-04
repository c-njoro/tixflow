// src/pages/api/events/[id]/tickets/[ticketId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { normalizeKenyanPhone } from '@/lib/phone';
import { deliverTickets } from '@/lib/orders';
import { rateLimit } from '@/lib/rateLimit';

const RELEASES_CAPACITY_FROM = ['pending', 'active', 'scanned'];
const ALLOWED_STATUSES = ['pending', 'active', 'scanned', 'cancelled', 'refunded'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can update tickets.' });
  }

  const { id, ticketId } = req.query; // event id, ticket id
  if (typeof id !== 'string' || typeof ticketId !== 'string') {
    return res.status(400).json({ error: 'Invalid identifiers.' });
  }

  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, eventId: id, tenantId: session.tenantId },
  });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  // POST { action: 'resend', whatsapp? } — send the ticket again (email,
  // plus WhatsApp if a number is on file or given now).
  if (req.method === 'POST') {
    if (req.body?.action !== 'resend') return res.status(400).json({ error: 'Unknown action.' });
    if (!['active', 'scanned'].includes(ticket.status)) {
      return res.status(409).json({ error: `This ticket is ${ticket.status} — it can't be sent.` });
    }
    if (!rateLimit(res, `ticket-resend:${ticket.id}`, 5, 10 * 60_000)) return;

    const given = req.body?.whatsapp ? normalizeKenyanPhone(req.body.whatsapp) : null;
    if (req.body?.whatsapp && !given) {
      return res.status(400).json({ error: 'Enter a valid WhatsApp number (e.g. 0712345678), or leave it blank.' });
    }

    let order = ticket.orderId ? await prisma.pendingOrder.findUnique({ where: { id: ticket.orderId } }) : null;
    if (!order) {
      // Issued before manual tickets had an order — give it one now, so the
      // WhatsApp number (if any) is remembered for invites and reminders.
      const tier = await prisma.ticketTier.findUnique({ where: { id: ticket.ticketTierId }, select: { id: true } });
      order = await prisma.pendingOrder.create({
        data: {
          kind: 'manual',
          status: 'completed',
          buyerName: ticket.buyerName,
          buyerEmail: ticket.buyerEmail.toLowerCase().trim(),
          buyerPhone: given ?? '',
          buyerWhatsapp: given,
          totalAmount: 0,
          items: tier ? [{ ticketTierId: tier.id, quantity: 1, unitPrice: 0 }] : [],
          tenantId: ticket.tenantId,
          eventId: ticket.eventId,
        },
      });
      await prisma.ticket.update({ where: { id: ticket.id }, data: { orderId: order.id } });
    } else if (given && given !== order.buyerWhatsapp) {
      order = await prisma.pendingOrder.update({ where: { id: order.id }, data: { buyerWhatsapp: given } });
    }

    const tier = await prisma.ticketTier.findUnique({ where: { id: ticket.ticketTierId }, select: { name: true } });
    deliverTickets(order, [{ ticketCode: ticket.ticketCode, tierName: tier?.name ?? 'Ticket' }], { spaceInvite: false }).catch(
      (error) => console.error('CRITICAL_TICKET_RESEND_ERROR:', ticket.id, error)
    );
    return res.status(202).json({
      success: true,
      message: `Sending the ticket to ${ticket.buyerEmail}${order.buyerWhatsapp ? ` and WhatsApp ${order.buyerWhatsapp}` : ''}.`,
      data: { whatsapp: order.buyerWhatsapp },
    });
  }

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { status } = req.body;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'A valid status is required.' });
  }

  const isReleasingCapacity =
    ['cancelled', 'refunded'].includes(status) && RELEASES_CAPACITY_FROM.includes(ticket.status);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: { status },
      });

      // Freeing the tier's capacity so someone else can claim that slot.
      if (isReleasingCapacity) {
        await tx.ticketTier.update({
          where: { id: ticket.ticketTierId },
          data: { sold: { decrement: 1 } },
        });
      }

      return updatedTicket;
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('CRITICAL_TICKET_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}