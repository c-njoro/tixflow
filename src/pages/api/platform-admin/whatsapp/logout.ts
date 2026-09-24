// src/pages/api/platform-admin/whatsapp/logout.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { disconnectWhatsapp, getWhatsappStatus } from '@/lib/whatsapp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    await disconnectWhatsapp();
    return res.status(200).json({ success: true, data: getWhatsappStatus() });
  } catch (error) {
    console.error('CRITICAL_WHATSAPP_LOGOUT_ERROR:', error);
    return res.status(500).json({ error: 'Failed to disconnect WhatsApp.' });
  }
}
