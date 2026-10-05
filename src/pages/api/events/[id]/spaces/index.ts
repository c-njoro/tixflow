// src/pages/api/events/[id]/spaces/index.ts
//
// GET  — the event's rooms (Event Spaces), for the rooms list page.
// POST — create a room.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { ACTIVE_WINDOW_MS, generateUniqueJoinCode } from '@/lib/eventSpace';
import { loadEventForSpaces } from '@/lib/spaceAdmin';
import { inviteDueAt, sendSpaceInvitesIfDue } from '@/lib/spaceInvites';
import { loadEntitlements, upgradeHint } from '@/lib/plans';

const MAX_TITLE_LENGTH = 120;
const MAX_WELCOME_LENGTH = 1000;
const MAX_ROOMS_PER_EVENT = 20;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadEventForSpaces(req, res, { adminOnly: req.method === 'POST' });
  if (!loaded) return;
  const { event } = loaded;

  if (req.method === 'GET') {
    const spaces = await prisma.eventSpace.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'asc' } });
    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const rooms = await Promise.all(
      spaces.map(async (space) => ({
        id: space.id,
        title: space.title,
        joinCode: space.joinCode,
        isOpen: space.isOpen,
        inviteStatus: space.inviteStatus,
        activeCount: await prisma.spaceParticipant.count({ where: { spaceId: space.id, lastSeenAt: { gte: activeSince } } }),
        pollCount: await prisma.spacePoll.count({ where: { spaceId: space.id } }),
        questionCount: await prisma.spaceQuestion.count({ where: { spaceId: space.id } }),
      }))
    );
    return res.status(200).json({ success: true, data: { rooms, inviteDueAt: inviteDueAt(event) } });
  }

  if (event.status === 'cancelled') {
    return res.status(400).json({ error: 'Cancelled events cannot have an Event Space.' });
  }
  const rooms = await prisma.eventSpace.count({ where: { eventId: event.id } });
  if (rooms >= MAX_ROOMS_PER_EVENT) {
    return res.status(400).json({ error: `An event can have up to ${MAX_ROOMS_PER_EVENT} rooms.` });
  }
  const limits = await loadEntitlements(event.id);
  if (limits && rooms >= limits.rooms) {
    return res.status(402).json({
      error: upgradeHint(`This event's plan (${limits.planLabel}) includes ${limits.rooms} room${limits.rooms === 1 ? '' : 's'}.`),
      upgrade: true,
    });
  }

  const { title, welcomeMessage } = req.body || {};
  try {
    const created = await prisma.eventSpace.create({
      data: {
        joinCode: await generateUniqueJoinCode(),
        title: (typeof title === 'string' && title.trim().slice(0, MAX_TITLE_LENGTH)) || event.title,
        welcomeMessage:
          typeof welcomeMessage === 'string' && welcomeMessage.trim()
            ? welcomeMessage.trim().slice(0, MAX_WELCOME_LENGTH)
            : null,
        eventId: event.id,
        tenantId: event.tenantId,
      },
    });
    // Created with less than an hour to go (or mid-event) — no reason to
    // make ticket holders wait for the next cron run.
    sendSpaceInvitesIfDue(event.id, event);
    return res.status(201).json({ success: true, data: { id: created.id } });
  } catch (error) {
    console.error('CRITICAL_EVENT_SPACE_CREATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
