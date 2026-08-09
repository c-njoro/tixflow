// src/pages/api/public/tenants/[slug]/events/[eventSlug].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPublicEvent } from '@/lib/publicQueries';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { slug, eventSlug } = req.query;
  if (typeof slug !== 'string' || typeof eventSlug !== 'string') {
    return res.status(400).json({ error: 'Invalid parameters.' });
  }

  const result = await getPublicEvent(slug, eventSlug);
  if (!result) return res.status(404).json({ error: 'Event not found.' });

  return res.status(200).json({ success: true, data: result });
}