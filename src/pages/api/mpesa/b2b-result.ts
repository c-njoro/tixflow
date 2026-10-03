// src/pages/api/mpesa/b2b-result.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { parseB2BResult } from '@/lib/mpesaB2B';
import { handlePayoutResult } from '@/lib/payoutResults';

// ResultURL and QueueTimeOutURL for bank (B2B) payouts.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handlePayoutResult(req, res, parseB2BResult, 'B2B');
}
