// src/lib/payoutResults.ts
//
// Shared handler for Daraja's B2C and B2B result callbacks — both post the
// same Result shape, to both the ResultURL and the QueueTimeOutURL, so one
// handler covers success, failure and timeout for either payout method.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './prisma';
import { hasValidCallbackSecret } from './mpesaCallbacks';
import { syncRefundFromPayout } from './refunds';

const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ParsedResult {
  resultCode: number;
  resultDesc: string;
  originatorConversationId?: string;
  transactionReceipt?: string;
}

export async function handlePayoutResult(
  req: NextApiRequest,
  res: NextApiResponse,
  parse: (body: unknown) => ParsedResult,
  label: 'B2C' | 'B2B'
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Otherwise anyone could mark a payout "failed" (releasing the balance to
  // be withdrawn again) or "completed".
  if (!hasValidCallbackSecret(req)) {
    console.error(`CRITICAL_${label}_RESULT_BAD_SECRET`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  let parsed: ParsedResult;
  try {
    parsed = parse(req.body);
  } catch (err) {
    console.error(`CRITICAL_${label}_RESULT_PARSE_ERROR:`, err, JSON.stringify(req.body));
    return res.status(200).json(ACK);
  }
  if (!parsed.originatorConversationId) {
    console.error(`CRITICAL_${label}_RESULT_NO_CONVERSATION_ID:`, JSON.stringify(req.body));
    return res.status(200).json(ACK);
  }

  // The result can race the approve handler saving originatorConversationId
  // right after Daraja accepted the request — give it a moment.
  let payout = null;
  for (let attempt = 0; attempt < 4 && !payout; attempt++) {
    if (attempt > 0) await sleep(1000);
    payout = await prisma.payout.findFirst({
      where: { originatorConversationId: parsed.originatorConversationId },
    });
  }

  if (!payout) {
    console.error(`CRITICAL_${label}_RESULT_PAYOUT_NOT_FOUND:`, parsed.originatorConversationId, JSON.stringify(req.body));
    return res.status(200).json(ACK);
  }

  try {
    // Conditional on 'processing' — idempotent under redelivery, and never
    // overrides a payout an admin already resolved manually.
    await prisma.payout.updateMany({
      where: { id: payout.id, status: 'processing' },
      data:
        parsed.resultCode === 0
          ? { status: 'completed', reference: parsed.transactionReceipt, failureReason: null }
          : { status: 'failed', failureReason: parsed.resultDesc },
    });
    if (payout.refundRequestId) {
      const updated = await prisma.payout.findUnique({ where: { id: payout.id } });
      if (updated) await syncRefundFromPayout(updated);
    }
    return res.status(200).json(ACK);
  } catch (error) {
    console.error(`CRITICAL_${label}_RESULT_HANDLER_ERROR:`, error);
    return res.status(500).json({ error: 'Failed to process result.' });
  }
}
