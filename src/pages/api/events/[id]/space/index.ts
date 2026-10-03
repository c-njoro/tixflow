// src/pages/api/events/[id]/space/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addAnnouncement, bumpSpace, deleteSpace, generateUniqueJoinCode, SCREEN_MODES } from '@/lib/eventSpace';
import { buildAdminState, loadEventSpace } from '@/lib/spaceAdmin';
import { sendSpaceInvitesIfDue } from '@/lib/spaceInvites';

const MAX_TITLE_LENGTH = 120;
const MAX_WELCOME_LENGTH = 1000;
const MAX_ANNOUNCEMENT_LENGTH = 500;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadEventSpace(req, res, { adminOnly: req.method !== 'GET' });
  if (!loaded) return;
  const { event, space } = loaded;

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, data: space ? await buildAdminState(event, space) : null });
  }

  if (req.method === 'POST') {
    if (space) return res.status(409).json({ error: 'This event already has an Event Space.' });
    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'Cancelled events cannot have an Event Space.' });
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
      sendSpaceInvitesIfDue(created.id, event);
      return res.status(201).json({ success: true, data: await buildAdminState(event, created) });
    } catch (error) {
      console.error('CRITICAL_EVENT_SPACE_CREATE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  if (!space) return res.status(404).json({ error: 'This event has no Event Space yet.' });

  if (req.method === 'DELETE') {
    try {
      await deleteSpace(space.id);
      return res.status(200).json({ success: true, data: null });
    } catch (error) {
      console.error('CRITICAL_EVENT_SPACE_DELETE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
  }

  // PATCH — settings and live controls. Every field is optional.
  const body = req.body || {};
  const data: Prisma.EventSpaceUpdateInput = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return res.status(400).json({ error: 'Title cannot be empty.' });
    }
    data.title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
  }
  if (body.welcomeMessage !== undefined) {
    data.welcomeMessage =
      typeof body.welcomeMessage === 'string' && body.welcomeMessage.trim()
        ? body.welcomeMessage.trim().slice(0, MAX_WELCOME_LENGTH)
        : null;
  }
  if (typeof body.isOpen === 'boolean') data.isOpen = body.isOpen;
  if (typeof body.moderateQuestions === 'boolean') data.moderateQuestions = body.moderateQuestions;

  if (body.screenMode !== undefined) {
    if (!SCREEN_MODES.includes(body.screenMode)) return res.status(400).json({ error: 'Invalid screen mode.' });
    data.screenMode = body.screenMode;
  }

  // Presenting: liveDocumentId null stops; a page number moves everyone.
  if (body.liveDocumentId !== undefined) {
    if (body.liveDocumentId === null) {
      data.liveDocumentId = null;
    } else {
      const doc = await prisma.spaceDocument.findFirst({
        where: { id: String(body.liveDocumentId), spaceId: space.id },
      });
      if (!doc) return res.status(404).json({ error: 'Document not found.' });
      data.liveDocumentId = doc.id;
      if (body.liveDocumentPage === undefined) data.liveDocumentPage = 1;
    }
  }
  if (body.liveDocumentPage !== undefined) {
    const page = Number(body.liveDocumentPage);
    const documentId = body.liveDocumentId ?? space.liveDocumentId;
    const doc = documentId
      ? await prisma.spaceDocument.findFirst({ where: { id: String(documentId), spaceId: space.id } })
      : null;
    if (!doc) return res.status(400).json({ error: 'No document is being presented.' });
    if (!Number.isInteger(page) || page < 1 || page > doc.pageCount) {
      return res.status(400).json({ error: `Page must be between 1 and ${doc.pageCount}.` });
    }
    data.liveDocumentPage = page;
  }

  if (body.spotlightQuestionId !== undefined) {
    if (body.spotlightQuestionId === null) {
      data.spotlightQuestionId = null;
    } else {
      const question = await prisma.spaceQuestion.findFirst({
        where: { id: String(body.spotlightQuestionId), spaceId: space.id },
      });
      if (!question) return res.status(404).json({ error: 'Question not found.' });
      data.spotlightQuestionId = question.id;
    }
  }

  if (body.announcement !== undefined) {
    if (typeof body.announcement !== 'string' || !body.announcement.trim()) {
      return res.status(400).json({ error: 'Announcement cannot be empty.' });
    }
    data.announcements = { set: addAnnouncement(space, body.announcement.trim().slice(0, MAX_ANNOUNCEMENT_LENGTH)) };
  }
  if (body.clearAnnouncements === true) data.announcements = { set: [] };

  try {
    const updated = await bumpSpace(space.id, data);
    return res.status(200).json({ success: true, data: await buildAdminState(event, updated) });
  } catch (error) {
    console.error('CRITICAL_EVENT_SPACE_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
