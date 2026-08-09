// src/pages/api/platform-admin/login.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import { serialize } from 'cookie';
import { PLATFORM_ADMIN_COOKIE_NAME, PLATFORM_ADMIN_JWT_SECRET } from '@/lib/platformAdminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { username, password } = req.body;

  const expectedUsername = process.env.PLATFORM_ADMIN_USERNAME;
  const expectedPassword = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    console.error('CRITICAL_PLATFORM_ADMIN_ENV_MISSING: PLATFORM_ADMIN_USERNAME/PASSWORD not set.');
    return res.status(500).json({ error: 'Platform admin login is not configured.' });
  }

  if (username !== expectedUsername || password !== expectedPassword) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = jwt.sign({ username }, PLATFORM_ADMIN_JWT_SECRET, { expiresIn: '12h' });

  res.setHeader(
    'Set-Cookie',
    serialize(PLATFORM_ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 12,
      path: '/',
    })
  );

  return res.status(200).json({ success: true });
}