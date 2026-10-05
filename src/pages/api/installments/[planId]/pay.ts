// src/pages/api/installments/[planId]/pay.ts
//
// Starts an M-Pesa payment towards a Lipa Pole Pole plan — any amount from
// MIN_INSTALLMENT_PAYMENT up to what's left. The buyer's page then polls
// /api/checkout/mpesa/status with the returned order id + key, as checkout does.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { safeEqual } from '@/lib/secrets';
import { createOrderAndPush } from '@/lib/checkout';
import { commissionForPayment, feeForPayment, MIN_INSTALLMENT_PAYMENT, remainingAmount } from '@/lib/installments';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { normalizeKenyanPhone } from '@/lib/phone';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { planId } = req.query;
  const { key, amount, phoneNumber } = req.body || {};
  const plan =
    typeof planId === 'string' && /^[a-f0-9]{24}$/i.test(planId)
      ? await prisma.installmentPlan.findUnique({ where: { id: planId } })
      : null;
  if (!plan || typeof key !== 'string' || !safeEqual(plan.accessKey, key)) {
    return res.status(404).json({ error: 'Plan not found.' });
  }
  if (plan.status !== 'active') return res.status(409).json({ error: `This plan is ${plan.status}.` });
  if (plan.dueAt.getTime() <= Date.now()) return res.status(409).json({ error: 'The deadline for this plan has passed.' });

  // Same STK-spam protection as checkout.
  const phone = phoneNumber ? normalizeKenyanPhone(phoneNumber) : plan.buyerPhone;
  if (!phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number (e.g. 0712345678).' });
  if (!rateLimit(res, `stk:ip:${getClientIp(req)}`, 10, 10 * 60_000)) return;
  if (!rateLimit(res, `stk:phone:${phone}`, 5, 10 * 60_000)) return;

  const remaining = remainingAmount(plan);
  // Whole shillings — STK push can't charge cents. The last top-up rounds up.
  const charge = Math.min(Math.ceil(Number(amount)), Math.ceil(remaining));
  const minimum = Math.min(MIN_INSTALLMENT_PAYMENT, Math.ceil(remaining));
  if (!Number.isFinite(charge) || charge < minimum) {
    return res.status(400).json({ error: `Pay at least KES ${minimum.toLocaleString()}.` });
  }

  // One payment at a time per plan — a second prompt while the first is
  // still waiting for a PIN would only confuse the buyer.
  const inFlight = await prisma.pendingOrder.count({
    where: { installmentPlanId: plan.id, status: 'pending', createdAt: { gte: new Date(Date.now() - 2 * 60_000) } },
  });
  if (inFlight > 0) {
    return res.status(409).json({ error: 'A payment is already waiting for your M-Pesa PIN. Finish or cancel it first.' });
  }

  const event = await prisma.event.findUnique({ where: { id: plan.eventId }, select: { title: true } });
  try {
    const result = await createOrderAndPush(
      {
        kind: 'installment_payment',
        installmentPlanId: plan.id,
        buyerName: plan.buyerName,
        buyerEmail: plan.buyerEmail,
        buyerPhone: phone,
        buyerWhatsapp: plan.buyerWhatsapp,
        totalAmount: charge,
        items: [],
        tenantId: plan.tenantId,
        eventId: plan.eventId,
        promoterId: plan.promoterId,
        promoterCommission: commissionForPayment(plan, charge),
        platformFee: feeForPayment(plan, charge),
      },
      event?.title || 'Tickets'
    );
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(200).json({ success: true, data: { orderId: result.orderId, accessKey: result.accessKey, amount: charge } });
  } catch (error) {
    console.error('CRITICAL_INSTALLMENT_PAY_ERROR:', plan.id, error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
