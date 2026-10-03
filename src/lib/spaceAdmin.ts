// src/lib/spaceAdmin.ts
//
// Shared by the organiser-side /api/events/[id]/space/* routes.
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Event, EventSpace } from '@prisma/client';
import { prisma } from './prisma';
import { getSession, type SessionPayload } from './auth';
import { ACTIVE_WINDOW_MS, getPollResults, serializeDocument, spaceUrl } from './eventSpace';
import { inviteDueAt } from './spaceInvites';

interface LoadedEvent {
  session: SessionPayload;
  event: Event;
}

// Sends the error response itself and returns null when the request can't
// proceed. Reading is open to any staff on the tenant (scanner staff
// included); changing anything is admin-only.
export async function loadEventForSpaces(
  req: NextApiRequest,
  res: NextApiResponse,
  { adminOnly }: { adminOnly: boolean }
): Promise<LoadedEvent | null> {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  if (adminOnly && session.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can manage Event Spaces.' });
    return null;
  }

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
    res.status(400).json({ error: 'Invalid event id.' });
    return null;
  }

  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  return { session, event };
}

// One room of the event, from the [spaceId] route segment.
export async function loadEventSpace(
  req: NextApiRequest,
  res: NextApiResponse,
  { adminOnly }: { adminOnly: boolean } = { adminOnly: true }
): Promise<(LoadedEvent & { space: EventSpace }) | null> {
  const loaded = await loadEventForSpaces(req, res, { adminOnly });
  if (!loaded) return null;

  const { spaceId } = req.query;
  const space =
    typeof spaceId === 'string' && /^[a-f0-9]{24}$/i.test(spaceId)
      ? await prisma.eventSpace.findFirst({ where: { id: spaceId, eventId: loaded.event.id } })
      : null;
  if (!space) {
    res.status(404).json({ error: 'Event Space not found.' });
    return null;
  }
  return { ...loaded, space };
}

// Everything the organiser dashboard shows — unlike the public state this
// includes draft polls, hidden answers and questions awaiting approval.
export async function buildAdminState(event: Event, space: EventSpace) {
  const [polls, questions, documents, participantCount, activeCount, ticketHolders] = await Promise.all([
    prisma.spacePoll.findMany({ where: { spaceId: space.id }, orderBy: { createdAt: 'desc' } }),
    prisma.spaceQuestion.findMany({
      where: { spaceId: space.id },
      orderBy: [{ upvotes: 'desc' }, { createdAt: 'asc' }],
      take: 300,
    }),
    prisma.spaceDocument.findMany({ where: { spaceId: space.id }, orderBy: { createdAt: 'asc' } }),
    prisma.spaceParticipant.count({ where: { spaceId: space.id } }),
    prisma.spaceParticipant.count({
      where: { spaceId: space.id, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) } },
    }),
    prisma.ticket.count({ where: { eventId: event.id, status: { in: ['active', 'scanned'] } } }),
  ]);

  const pollsWithResults = await Promise.all(
    polls.map(async (poll) => ({
      ...poll,
      results: poll.status === 'draft' ? null : await getPollResults(poll, true),
    }))
  );

  return {
    ...space,
    joinUrl: spaceUrl(space.joinCode),
    inviteDueAt: inviteDueAt(event),
    ticketHolders,
    participantCount,
    activeCount,
    polls: pollsWithResults,
    questions,
    documents: documents.map(serializeDocument),
  };
}
