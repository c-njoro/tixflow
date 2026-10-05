// src/pages/api/platform-admin/equipment/index.ts
//
// GET — organisers' requests for gate scanners / scanning staff, open first.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getPlatformAdminSession } from '@/lib/platformAdminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getPlatformAdminSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const requests = await prisma.equipmentRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const [events, tenants] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: [...new Set(requests.map((r) => r.eventId))] } },
      select: { id: true, title: true, date: true, location: true },
    }),
    prisma.tenant.findMany({
      where: { id: { in: [...new Set(requests.map((r) => r.tenantId))] } },
      select: { id: true, businessName: true },
    }),
  ]);
  const open = (s: string) => ['requested', 'quoted', 'confirmed'].includes(s);
  return res.status(200).json({
    success: true,
    data: requests
      .map((r) => ({
        ...r,
        event: events.find((e) => e.id === r.eventId) ?? null,
        businessName: tenants.find((t) => t.id === r.tenantId)?.businessName ?? '—',
      }))
      .sort((a, b) => Number(open(b.status)) - Number(open(a.status))),
  });
}
