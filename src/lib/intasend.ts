// src/lib/intasend.ts
//
// Card payments (Visa/Mastercard, Apple Pay, Google Pay) through IntaSend's
// hosted checkout — for diaspora buyers, corporates, and organisers buying
// an event plan. The buyer is sent to IntaSend's page and comes back to
// ours; the order is resolved by the webhook (src/pages/api/intasend/webhook.ts)
// or, if that's late, by asking IntaSend (reconcileCardOrder).
//
// Nothing a webhook says is trusted on its own: we always re-read the
// invoice from IntaSend with the secret key before fulfilling.
import type { PendingOrder } from '@prisma/client';
import { prisma } from './prisma';
import { getAppUrl } from './mpesaCallbacks';

const isLive = () => process.env.INTASEND_ENVIRONMENT === 'live' || process.env.INTASEND_ENVIRONMENT === 'production';
const baseUrl = () => (isLive() ? 'https://payment.intasend.com' : 'https://sandbox.intasend.com');

export const cardPaymentsEnabled = () => !!(process.env.INTASEND_PUBLISHABLE_KEY && process.env.INTASEND_SECRET_KEY);

const TIMEOUT_MS = 20_000;

async function call(path: string, body: unknown, auth: 'public' | 'secret' | 'none') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth === 'public') headers['X-IntaSend-Public-API-Key'] = process.env.INTASEND_PUBLISHABLE_KEY || '';
  if (auth === 'secret') headers.Authorization = `Bearer ${process.env.INTASEND_SECRET_KEY || ''}`;
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as Record<string, any> };
}

export type CardCheckoutResult = { ok: true; url: string } | { ok: false; status: number; error: string };

// Opens an IntaSend checkout for this (already created, pending) order and
// returns the URL to send the buyer to. They come back to /pay/<order>/<key>
// (IntaSend refuses redirect URLs with a query string), which forwards them
// to the page that shows the result.
export async function startCardCheckout(order: PendingOrder): Promise<CardCheckoutResult> {
  if (!cardPaymentsEnabled()) return { ok: false, status: 503, error: 'Card payments are not available right now.' };
  const [firstName, ...rest] = order.buyerName.trim().split(/\s+/);
  const back = `${getAppUrl()}/pay/${order.id}/${order.accessKey}`;

  try {
    const { ok, data } = await call(
      '/api/v1/checkout/',
      {
        public_key: process.env.INTASEND_PUBLISHABLE_KEY,
        amount: order.totalAmount,
        currency: 'KES',
        email: order.buyerEmail,
        first_name: firstName || undefined,
        last_name: rest.join(' ') || undefined,
        api_ref: order.id,
        redirect_url: back,
      },
      'public'
    );
    if (!ok || !data.url || !data.id) {
      console.error('CRITICAL_INTASEND_CHECKOUT_ERROR:', order.id, JSON.stringify(data).slice(0, 500));
      await prisma.pendingOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'failed', failureReason: 'Could not start card payment.' },
      });
      return { ok: false, status: 502, error: 'Could not start card payment. Please try again or pay with M-Pesa.' };
    }
    await prisma.pendingOrder.update({
      where: { id: order.id },
      data: { intasendCheckoutId: String(data.id), intasendSignature: String(data.signature || '') },
    });
    return { ok: true, url: String(data.url) };
  } catch (error) {
    console.error('CRITICAL_INTASEND_CHECKOUT_ERROR:', order.id, error);
    await prisma.pendingOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'failed', failureReason: 'Could not reach the card processor.' },
    });
    return { ok: false, status: 502, error: 'Could not reach the card processor. Please try again.' };
  }
}

export type InvoiceState = { state: 'paid' | 'failed' | 'pending'; invoiceId: string; value: number; apiRef: string | null; reason?: string };

// The invoice as IntaSend has it (secret-key call) — the only thing we act on.
export async function fetchInvoice(invoiceId: string): Promise<InvoiceState | null> {
  const { ok, data } = await call('/api/v1/payment/status/', { invoice_id: invoiceId }, 'secret');
  const invoice = data.invoice ?? data;
  if (!ok || !invoice?.state) return null;
  const state = String(invoice.state).toUpperCase();
  return {
    state: state === 'COMPLETE' ? 'paid' : state === 'FAILED' || state === 'CANCELED' || state === 'CANCELLED' ? 'failed' : 'pending',
    invoiceId: String(invoice.invoice_id ?? invoiceId),
    value: Number(invoice.value),
    apiRef: invoice.api_ref ?? null,
    reason: invoice.failed_reason || undefined,
  };
}

// Has the buyer paid this order's checkout? Uses the checkout's signature,
// which IntaSend only honours for about an hour — after that, we rely on
// the webhook. Returns the invoice id when there is one.
async function checkoutInvoiceId(order: PendingOrder): Promise<string | null> {
  if (order.intasendInvoiceId) return order.intasendInvoiceId;
  if (!order.intasendCheckoutId || !order.intasendSignature) return null;
  const { ok, data } = await call(
    '/api/v1/checkout/details/',
    { checkout_id: order.intasendCheckoutId, signature: order.intasendSignature },
    'none'
  );
  if (!ok) return null;
  const invoice = data.invoice;
  const id = typeof invoice === 'string' ? invoice : invoice?.invoice_id ?? invoice?.id;
  return id ? String(id) : null;
}

const PAYMENT_TOLERANCE = 0.5;

// Verdict on a card order from IntaSend's own record of the invoice.
// fulfil/fail are passed in to keep this file free of the order logic.
export async function resolveCardOrder(
  order: PendingOrder,
  invoiceId: string,
  fulfil: (orderId: string, receipt: string | null) => Promise<unknown>,
  fail: (orderId: string, reason: string) => Promise<unknown>
): Promise<PendingOrder['status']> {
  const invoice = await fetchInvoice(invoiceId);
  if (!invoice) return order.status;
  if (invoice.apiRef && invoice.apiRef !== order.id) {
    console.error('CRITICAL_INTASEND_REF_MISMATCH:', order.id, invoice.apiRef);
    return order.status;
  }
  if (order.intasendInvoiceId !== invoice.invoiceId) {
    await prisma.pendingOrder.update({ where: { id: order.id }, data: { intasendInvoiceId: invoice.invoiceId } });
  }
  if (invoice.state === 'paid') {
    if (!(invoice.value >= order.totalAmount - PAYMENT_TOLERANCE)) {
      console.error('CRITICAL_INTASEND_UNDERPAID:', order.id, invoice.value, order.totalAmount);
      await fail(order.id, `Card payment of KES ${invoice.value} doesn't cover KES ${order.totalAmount} — contact support.`);
      return 'failed';
    }
    await fulfil(order.id, invoice.invoiceId);
    return 'completed';
  }
  if (invoice.state === 'failed') {
    await fail(order.id, invoice.reason ? `Card payment failed: ${invoice.reason}` : 'Card payment failed.');
    return 'failed';
  }
  return 'pending';
}

// For the status poll / reconcile cron: look the order up with IntaSend.
export async function reconcileCardOrder(
  order: PendingOrder,
  fulfil: (orderId: string, receipt: string | null) => Promise<unknown>,
  fail: (orderId: string, reason: string) => Promise<unknown>
): Promise<PendingOrder['status']> {
  const invoiceId = await checkoutInvoiceId(order).catch(() => null);
  if (!invoiceId) return 'pending';
  return resolveCardOrder(order, invoiceId, fulfil, fail);
}
