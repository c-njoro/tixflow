// src/pages/api/checkout/mpesa/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;
  if (typeof orderId !== 'string') {
    return res.status(400).json({ error: 'orderId is required.' });
  }

  const order = await prisma.pendingOrder.findUnique({ where: { id: orderId } });
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  let tickets: { id: string; ticketCode: string; ticketTierId: string }[] = [];
  if (order.status === 'completed') {
    tickets = await prisma.ticket.findMany({
      where: { orderId: order.id },
      select: { id: true, ticketCode: true, ticketTierId: true },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      status: order.status,
      failureReason: order.failureReason,
      tickets,
    },
  });
}