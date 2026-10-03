// src/pages/api/events/[id]/feedback/index.ts
//
// GET   — the event's feedback survey (or null) with results so far.
// POST  — create it with a sensible default set of questions.
// PATCH — edit questions/intro/audience/timing, or change status:
//         'scheduled' (send automatically after the event), 'draft', 'closed'.
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { defaultQuestions, getSurveyResults, parseQuestions, surveySendsAt } from '@/lib/feedback';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage feedback.' });

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const event = await prisma.event.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  let survey = await prisma.feedbackSurvey.findUnique({ where: { eventId: event.id } });

  if (req.method === 'POST') {
    if (survey) return res.status(409).json({ error: 'This event already has a survey.' });
    survey = await prisma.feedbackSurvey.create({
      data: { eventId: event.id, tenantId: event.tenantId, questions: defaultQuestions(), status: 'draft' },
    });
  } else if (req.method === 'PATCH') {
    if (!survey) return res.status(404).json({ error: 'Create the survey first.' });
    const body = req.body || {};
    const data: Prisma.FeedbackSurveyUpdateInput = {};

    // Question ids are kept on edit, so answers stay attached to their
    // question; a removed question just stops showing its answers.
    if (body.questions !== undefined) {
      const parsed = parseQuestions(body.questions);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      data.questions = { set: parsed.questions };
    }
    if (body.intro !== undefined) data.intro = typeof body.intro === 'string' && body.intro.trim() ? body.intro.trim().slice(0, 500) : null;
    if (body.audience !== undefined) {
      if (body.audience !== 'attended' && body.audience !== 'all') return res.status(400).json({ error: 'Invalid audience.' });
      data.audience = body.audience;
    }
    if (body.sendAfterHours !== undefined) {
      const h = Number(body.sendAfterHours);
      if (!Number.isInteger(h) || h < 0 || h > 72) return res.status(400).json({ error: 'Send 0–72 hours after the event.' });
      data.sendAfterHours = h;
    }
    if (body.status !== undefined) {
      const allowed = survey.status === 'sent' || survey.status === 'closed' ? ['sent', 'closed'] : ['draft', 'scheduled'];
      if (!allowed.includes(body.status)) return res.status(400).json({ error: `Can't change a ${survey.status} survey to ${body.status}.` });
      // 'sent' ↔ 'closed' toggles accepting responses after sending.
      data.status = body.status;
    }
    survey = await prisma.feedbackSurvey.update({ where: { id: survey.id }, data });
  } else if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!survey) return res.status(200).json({ success: true, data: null });
  return res.status(200).json({
    success: true,
    data: {
      ...survey,
      sendsAt: surveySendsAt(survey, event),
      results: await getSurveyResults(survey),
    },
  });
}
