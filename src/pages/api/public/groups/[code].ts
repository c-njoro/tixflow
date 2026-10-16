// src/pages/api/public/groups/[code].ts
//
// GET — a group booking's public state: who's paid (first names), seats
// left, the deadline. Polled by the group page.
import type { NextApiRequest, NextApiResponse } from 'next';
import { publicGroup } from '@/lib/groups';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const code = typeof req.query.code === 'string' ? req.query.code.toUpperCase() : '';
  const group = await publicGroup(code);
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  return res.status(200).json({ success: true, data: group });
}
