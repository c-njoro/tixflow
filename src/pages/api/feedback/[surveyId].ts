// src/pages/api/feedback/[surveyId].ts
//
// GET  ?t=<token> — the survey for one attendee (and whether they answered).
// POST { t, answers } — submit, once per person.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { pseudonym, verifyLinkToken } from '@/lib/signedLinks';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

const MAX_TEXT_ANSWER = 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `feedback:${getClientIp(req)}`, 60, 10 * 60_000)) return;

  const { surveyId } = req.query;
  const survey =
    typeof surveyId === 'string' && /^[a-f0-9]{24}$/i.test(surveyId)
      ? await prisma.feedbackSurvey.findUnique({ where: { id: surveyId } })
      : null;
  const token = req.method === 'GET' ? req.query.t : req.body?.t;
  const email = survey ? verifyLinkToken(`feedback:${survey.id}`, token) : null;
  if (!survey || !email) return res.status(404).json({ error: 'This feedback link is not valid.' });

  const respondentKey = pseudonym(`feedback:${survey.id}`, email);

  if (req.method === 'GET') {
    const [event, existing] = await Promise.all([
      prisma.event.findUnique({
        where: { id: survey.eventId },
        select: { title: true, date: true, tenant: { select: { businessName: true } } },
      }),
      prisma.feedbackResponse.findUnique({ where: { surveyId_respondentKey: { surveyId: survey.id, respondentKey } } }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        event: event && { title: event.title, date: event.date, organiser: event.tenant.businessName },
        intro: survey.intro,
        questions: survey.questions,
        open: survey.status === 'sent' || survey.status === 'scheduled' || survey.status === 'draft',
        alreadyAnswered: !!existing,
      },
    });
  }

  if (survey.status === 'closed') return res.status(409).json({ error: 'This survey is closed.' });

  const raw = (req.body?.answers ?? {}) as Record<string, unknown>;
  const answers: Record<string, number | string> = {};
  for (const q of survey.questions) {
    const value = raw[q.id];
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (q.required) return res.status(400).json({ error: `Please answer: "${q.prompt}"` });
      continue;
    }
    if (q.kind === 'rating') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) return res.status(400).json({ error: 'Ratings are 1 to 5.' });
      answers[q.id] = n;
    } else if (q.kind === 'choice') {
      if (typeof value !== 'string' || !q.options.includes(value)) return res.status(400).json({ error: 'Pick one of the options.' });
      answers[q.id] = value;
    } else {
      answers[q.id] = String(value).trim().slice(0, MAX_TEXT_ANSWER);
    }
  }

  try {
    await prisma.feedbackResponse.create({ data: { surveyId: survey.id, respondentKey, answers } });
    return res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'You have already sent your feedback — thank you!' });
    }
    console.error('CRITICAL_FEEDBACK_SUBMIT_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
