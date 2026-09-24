// src/pages/api/platform-admin/whatsapp/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { getWhatsappStatus } from '@/lib/whatsapp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  return res.status(200).json({ success: true, data: getWhatsappStatus() });
}
