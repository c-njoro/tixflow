// src/pages/api/platform-admin/whatsapp/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';
import { getWhatsappStatus, isServerlessHost, SERVERLESS_HOST_ERROR } from '@/lib/whatsapp';
import { getWhatsappProvider } from '@/lib/whatsappSender';
import { cloudConfig } from '@/lib/whatsappCloud';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const provider = getWhatsappProvider();
  if (provider === 'cloud') {
    const config = cloudConfig();
    return res.status(200).json({
      success: true,
      data: {
        provider,
        status: config ? 'connected' : 'disconnected',
        qr: null,
        phoneNumber: config ? `Phone number ID ${config.phoneNumberId}` : null,
        lastError: config ? null : 'Set WHATSAPP_CLOUD_TOKEN and WHATSAPP_PHONE_NUMBER_ID to use the Cloud API.',
      },
    });
  }

  const status = getWhatsappStatus();
  return res.status(200).json({
    success: true,
    data: { provider, ...status, lastError: status.lastError ?? (isServerlessHost() ? SERVERLESS_HOST_ERROR : null) },
  });
}
