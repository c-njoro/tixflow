// src/pages/api/mpesa/b2b-result.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { parseB2BResult } from '@/lib/mpesaB2B';

const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

// Used as both the ResultURL and the QueueTimeOutURL for B2B bank payouts —
// Safaricom posts the same Result shape to both, so one handler covers
// success, failure, and timeout.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  let parsed;
  try {
    parsed = parseB2BResult(req.body);
  } catch (err) {
    console.error('CRITICAL_B2B_RESULT_PARSE_ERROR:', err, JSON.stringify(req.body));
    return res.status(200).json(ACK);
  }

  const payout = await prisma.payout.findFirst({
    where: { originatorConversationId: parsed.originatorConversationId },
  });

  if (!payout) {
    console.error('CRITICAL_B2B_RESULT_PAYOUT_NOT_FOUND:', parsed.originatorConversationId);
    return res.status(200).json(ACK);
  }

  // Idempotency — Safaricom can redeliver this callback.
  if (payout.status !== 'processing') {
    return res.status(200).json(ACK);
  }

  try {
    if (parsed.resultCode === 0) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'completed', reference: parsed.transactionReceipt },
      });
    } else {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { status: 'failed', failureReason: parsed.resultDesc },
      });
    }
    return res.status(200).json(ACK);
  } catch (error) {
    console.error('CRITICAL_B2B_RESULT_HANDLER_ERROR:', error);
    return res.status(500).json({ error: 'Failed to process result.' });
  }
}
