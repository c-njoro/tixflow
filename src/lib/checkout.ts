// src/lib/checkout.ts
//
// Creates a PendingOrder and sends the M-Pesa STK push for it — shared by
// normal checkout and Lipa Pole Pole top-ups. The order is resolved later
// by the Daraja callback / status poll / reconcile job (src/lib/orders.ts).
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import mpesaService from './mpesaService';
import { mpesaCallbackUrl } from './mpesaCallbacks';
import { fulfillPaidOrder } from './orders';

// Daraja hard-limits these — AccountReference max 12 chars, TransactionDesc max 13.
const buildAccountReference = (orderId: string) => `TIX-${orderId.slice(-6)}`.slice(0, 12);

export type StkOrderResult =
  | { ok: true; orderId: string; accessKey: string; customerMessage?: string }
  | { ok: false; status: number; error: string };

export async function createOrderAndPush(
  data: Omit<Prisma.PendingOrderUncheckedCreateInput, 'status' | 'accessKey'>,
  transactionDesc: string
): Promise<StkOrderResult> {
  const order = await prisma.pendingOrder.create({
    data: { ...data, status: 'pending', accessKey: crypto.randomBytes(24).toString('base64url') },
  });

  const stkResult = await mpesaService.initiateSTKPush({
    phoneNumber: order.buyerPhone,
    amount: order.totalAmount,
    accountReference: buildAccountReference(order.id),
    callbackUrl: mpesaCallbackUrl('/api/mpesa/callback'),
    transactionDesc: transactionDesc.slice(0, 13),
  });

  if (!stkResult.success) {
    await prisma.pendingOrder.update({
      where: { id: order.id },
      data: { status: 'failed', failureReason: stkResult.error || 'Failed to initiate payment.' },
    });
    return { ok: false, status: 502, error: stkResult.error || 'Failed to start M-Pesa payment.' };
  }

  await prisma.pendingOrder.update({
    where: { id: order.id },
    data: { checkoutRequestId: stkResult.checkoutRequestId, merchantRequestId: stkResult.merchantRequestId },
  });
  return { ok: true, orderId: order.id, accessKey: order.accessKey!, customerMessage: stkResult.customerMessage };
}

// A KES 0 order (free registration, or a 100% promo code): nothing to pay,
// so it's fulfilled straight away through the same path as a paid order.
export async function createFreeOrder(data: Omit<Prisma.PendingOrderUncheckedCreateInput, 'status' | 'accessKey'>) {
  const order = await prisma.pendingOrder.create({
    data: {
      ...data,
      totalAmount: 0,
      platformFee: 0,
      paymentMethod: 'free',
      status: 'pending',
      accessKey: crypto.randomBytes(24).toString('base64url'),
    },
  });
  await fulfillPaidOrder(order.id, null);
  return { orderId: order.id, accessKey: order.accessKey! };
}
