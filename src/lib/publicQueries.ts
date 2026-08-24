// src/lib/publicQueries.ts
import { prisma } from '@/lib/prisma';

export async function getTenantStorefront(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      businessName: true,
      slug: true,
      logoUrl: true,
      events: {
        where: { status: 'published', date: { gte: new Date() } },
        orderBy: { date: 'asc' },
        select: {
          slug: true,
          title: true,
          date: true,
          location: true,
          coverImageUrl: true,
          category: true,
        },
      },
    },
  });

  return tenant;
}

export async function getPublicEvent(tenantSlug: string, eventSlug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, businessName: true, slug: true, logoUrl: true },
  });
  if (!tenant) return null;

  const event = await prisma.event.findFirst({
    where: { tenantId: tenant.id, slug: eventSlug, status: 'published' },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      date: true,
      endDate: true,
      location: true,
      coverImageUrl: true,
      galleryImages: true,
      ticketTiers: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          price: true,
          capacity: true,
          sold: true,
          description: true,
          tierColor: true,
        },
      },
    },
  });
  if (!event) return null;

  // Don't leak exact sold/capacity numbers publicly — just how many are left.
  // A tenant may not want competitors or attendees seeing their total capacity.
  const tiers = event.ticketTiers.map((t) => ({
    id: t.id,
    name: t.name,
    price: t.price,
    description: t.description,
    tierColor: t.tierColor,
    available: Math.max(t.capacity - t.sold, 0),
  }));

  return {
    tenant,
    event: { ...event, ticketTiers: tiers, galleryImages: event.galleryImages.map((img) => img.url) },
  };
}

export async function searchPublicEvents(query: string, limit = 20) {
  const q = query.trim();
  if (!q) return [];

  const events = await prisma.event.findMany({
    where: {
      status: 'published',
      date: { gte: new Date() },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { date: 'asc' },
    take: limit,
    select: {
      slug: true,
      title: true,
      date: true,
      location: true,
      category: true,
      coverImageUrl: true,
      tenant: { select: { slug: true, businessName: true } },
    },
  });

  return events;
}