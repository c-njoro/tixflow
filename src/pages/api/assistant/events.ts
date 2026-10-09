// src/pages/api/assistant/events.ts
//
// The website assistant's "what's on" tool: upcoming events, optionally
// matching a word in the title, category or location, with the cheapest
// ticket still on sale and the link to buy.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAssistant } from '@/lib/assistantAuth';
import { listUpcomingEvents } from '@/lib/publicQueries';
import { getAppUrl } from '@/lib/mpesaCallbacks';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!requireAssistant(req, res)) return;

  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : undefined;
  const events = await listUpcomingEvents({ query, limit: 10 });

  return res.status(200).json({
    count: events.length,
    events: events.map((e) => ({
      title: e.title,
      organiser: e.tenant.businessName,
      starts: e.date.toISOString(),
      startsInNairobi: e.date.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'full', timeStyle: 'short' }),
      location: e.location,
      category: e.category,
      price: e.soldOut ? 'Sold out' : e.fromPrice === null ? null : e.fromPrice === 0 ? 'Free' : `From KES ${e.fromPrice.toLocaleString('en-KE')}`,
      url: `${getAppUrl()}/${e.tenant.slug}/${e.slug}`,
    })),
    ...(events.length === 0 && {
      note: query ? `No upcoming events match "${query}". Try a shorter word, or no search to list what's coming up.` : 'No upcoming events are listed right now.',
    }),
  });
}
