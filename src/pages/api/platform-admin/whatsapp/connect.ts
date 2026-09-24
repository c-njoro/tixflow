// src/pages/api/platform-admin/whatsapp/connect.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { connectWhatsapp, getWhatsappStatus } from '@/lib/whatsapp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // Fire and don't await the full connection lifecycle — the QR code
    // arrives asynchronously via the connection.update event. The client
    // polls /status right after calling this to pick it up.
    connectWhatsapp().catch((err) => {
      console.error('CRITICAL_WHATSAPP_CONNECT_ERROR:', err);
    });
    return res.status(200).json({ success: true, data: getWhatsappStatus() });
  } catch (error) {
    console.error('CRITICAL_WHATSAPP_CONNECT_ERROR:', error);
    return res.status(500).json({ error: 'Failed to start WhatsApp connection.' });
  }
}
