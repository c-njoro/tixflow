import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { serialize } from 'cookie';

// A fallback secret key for development. In production, this MUST live in your env variables.
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-super-secure-jwt-token-secret-key-12345';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Enforce POST method
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { email, password } = req.body;

  // 2. Input Integrity Checks
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // 3. Query User from MongoDB and include Tenant context
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { tenant: true }, // Pulls the workspace parameters simultaneously
    });

    // Defensive Security: Use a generic error message so attackers don't know if the email exists
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password combination.' });
    }

    // 4. Verify Password Cryptography
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password combination.' });
    }

    // 5. Generate Secure Stateless Session Token
    const sessionToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      },
      JWT_SECRET,
      { expiresIn: '7d' } // Session lives for 7 days
    );

    // 6. Serialize the HTTP-Only Cookie Header
    const cookie = serialize('tixflow_session', sessionToken, {
      httpOnly: true, // Prevents client-side JavaScript access (Stops XSS token stealing)
      secure: process.env.NODE_ENV === 'production', // Enforces HTTPS protocol in production
      sameSite: 'lax', // Protects against Cross-Site Request Forgery (CSRF) attacks
      maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
      path: '/', // Available across the entire site mapping
    });

    // 7. Inject header and return structural clean payload
    res.setHeader('Set-Cookie', cookie);

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        tenant: {
          id: user.tenant.id,
          businessName: user.tenant.businessName,
          slug: user.tenant.slug,
          isOnboarded: user.tenant.isOnboarded,
        },
      },
    });

  } catch (error) {
    console.error('CRITICAL_LOGIN_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred. Please try again.' });
  }
}