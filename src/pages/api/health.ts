// src/pages/api/health.ts — liveness check for the host (Render health checks).
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
