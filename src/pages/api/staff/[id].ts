// src/pages/api/staff/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const ALLOWED_ROLES = ['admin', 'scanner_staff'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can manage staff accounts.' });
  }

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid staff id.' });

  const staffMember = await prisma.user.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!staffMember) return res.status(404).json({ error: 'Staff member not found.' });

  if (req.method === 'PATCH') {
    const { name, role, password } = req.body;

    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    // Guard against locking the tenant out of admin access entirely.
    if (role === 'scanner_staff' && staffMember.role === 'admin') {
      const adminCount = await prisma.user.count({
        where: { tenantId: session.tenantId, role: 'admin' },
      });
      if (adminCount <= 1) {
        return res.status(409).json({ error: 'Cannot demote the only remaining admin.' });
      }
    }

    try {
      const updateData: Record<string, unknown> = {
        ...(name && { name: name.trim() }),
        ...(role && { role }),
      };

      if (password) {
        const salt = await bcrypt.genSalt(12);
        updateData.password = await bcrypt.hash(password, salt);
      }

      const updated = await prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error('CRITICAL_STAFF_UPDATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  if (req.method === 'DELETE') {
    if (id === session.userId) {
      return res.status(400).json({ error: 'You cannot remove your own account.' });
    }

    if (staffMember.role === 'admin') {
      const adminCount = await prisma.user.count({
        where: { tenantId: session.tenantId, role: 'admin' },
      });
      if (adminCount <= 1) {
        return res.status(409).json({ error: 'Cannot remove the only remaining admin.' });
      }
    }

    try {
      await prisma.user.delete({ where: { id } });
      return res.status(200).json({ success: true, message: 'Staff member removed.' });
    } catch (error) {
      console.error('CRITICAL_STAFF_DELETE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['PATCH', 'DELETE']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}