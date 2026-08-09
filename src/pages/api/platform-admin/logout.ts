// src/pages/api/platform-admin/logout.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { PLATFORM_ADMIN_COOKIE_NAME } from '@/lib/platformAdminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  res.setHeader(
    'Set-Cookie',
    serialize(PLATFORM_ADMIN_COOKIE_NAME, '', { httpOnly: true, maxAge: -1, path: '/' })
  );

  return res.status(200).json({ success: true });
}