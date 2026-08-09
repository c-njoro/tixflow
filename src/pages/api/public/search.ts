// src/pages/api/public/search.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { searchPublicEvents } from '@/lib/publicQueries';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { q } = req.query;
  if (typeof q !== 'string' || q.trim().length === 0) {
    return res.status(200).json({ success: true, data: [] });
  }

  const results = await searchPublicEvents(q);
  return res.status(200).json({ success: true, data: results });
}