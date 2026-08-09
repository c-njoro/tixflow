// src/pages/api/public/tenants/[slug].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getTenantStorefront } from '@/lib/publicQueries';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { slug } = req.query;
  if (typeof slug !== 'string') return res.status(400).json({ error: 'Invalid tenant slug.' });

  const tenant = await getTenantStorefront(slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  return res.status(200).json({ success: true, data: tenant });
}