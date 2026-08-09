// src/pages/api/events/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const slugify = (text: string) =>
  text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');

const isValidUrl = (url: string) => {
  try { new URL(url); return true; } catch { return false; }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method === 'GET') {
    const events = await prisma.event.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { date: 'asc' },
      include: {
        ticketTiers: true,
        _count: { select: { tickets: true } },
      },
    });
    return res.status(200).json({ success: true, data: events });
  }

  if (req.method === 'POST') {
    if (session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create events.' });
    }

    const {
      title, description, category, date, endDate, location,
      coverImageUrl, galleryImageUrls, ticketTiers,
    } = req.body;

    if (!title || !date || !location) {
      return res.status(400).json({ error: 'Title, date, and location are required.' });
    }

    if (!Array.isArray(ticketTiers) || ticketTiers.length === 0) {
      return res.status(400).json({ error: 'At least one ticket tier is required.' });
    }

    for (const tier of ticketTiers) {
      if (!tier.name || tier.price == null || tier.capacity == null) {
        return res.status(400).json({ error: 'Each ticket tier requires a name, price, and capacity.' });
      }
      if (tier.price < 0 || tier.capacity < 1) {
        return res.status(400).json({ error: 'Tier price cannot be negative and capacity must be at least 1.' });
      }
    }

    if (coverImageUrl && !isValidUrl(coverImageUrl)) {
      return res.status(400).json({ error: 'coverImageUrl must be a valid URL.' });
    }
    if (galleryImageUrls && (!Array.isArray(galleryImageUrls) || galleryImageUrls.some((u: string) => !isValidUrl(u)))) {
      return res.status(400).json({ error: 'galleryImageUrls must be an array of valid URLs.' });
    }

    let eventSlug = slugify(title);
    const existing = await prisma.event.findUnique({
      where: { tenantId_slug: { tenantId: session.tenantId, slug: eventSlug } },
    });
    if (existing) {
      eventSlug = `${eventSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    try {
      const event = await prisma.event.create({
        data: {
          title: title.trim(),
          slug: eventSlug,
          description: description?.trim(),
          category: category?.trim(),
          date: new Date(date),
          endDate: endDate ? new Date(endDate) : undefined,
          location: location.trim(),
          coverImageUrl,
          galleryImageUrls: galleryImageUrls ?? [],
          status: 'draft',
          tenantId: session.tenantId,
          ticketTiers: {
            create: ticketTiers.map((t: any) => ({
              name: t.name.trim(),
              price: Number(t.price),
              capacity: Number(t.capacity),
              tierColor: t.tierColor ?? '#000000',
              description: t.description?.trim(),
            })),
          },
        },
        include: { ticketTiers: true },
      });

      return res.status(201).json({ success: true, data: event });
    } catch (error) {
      console.error('CRITICAL_EVENT_CREATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}