// src/pages/api/mpesa/b2c-result.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { parseB2CResult } from '@/lib/mpesaB2C';
import { handlePayoutResult } from '@/lib/payoutResults';

// ResultURL and QueueTimeOutURL for M-Pesa (B2C) payouts.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handlePayoutResult(req, res, parseB2CResult, 'B2C');
}
