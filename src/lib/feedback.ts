// src/lib/feedback.ts
//
// Post-event feedback surveys. Each attendee gets a personal signed link
// (one response per person); responses are anonymous to the organiser.
// Sent automatically sendAfterHours after the event ends, or on demand.
import crypto from 'crypto';
import type { FeedbackSurvey, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getAppUrl } from './mpesaCallbacks';
import { createLinkToken } from './signedLinks';
import { sendAfterEventEmail } from './email';
import { collectEventRecipients, deliverToAll } from './attendeeMessaging';
import { eventEndsAt } from './spaceInvites';
import { certificateLines, certificateUrl, claimCertificateSend } from './certificates';

export const QUESTION_KINDS = ['rating', 'choice', 'text'] as const;
export const MAX_QUESTIONS = 12;

export const newQuestionId = () => crypto.randomBytes(6).toString('hex');

export const defaultQuestions = (): Prisma.SurveyQuestionCreateInput[] => [
  { id: newQuestionId(), kind: 'rating', prompt: 'Overall, how would you rate the event?', options: [], required: true },
  { id: newQuestionId(), kind: 'rating', prompt: 'How likely are you to come again?', options: [], required: false },
  { id: newQuestionId(), kind: 'text', prompt: 'What did you enjoy most?', options: [], required: false },
  { id: newQuestionId(), kind: 'text', prompt: 'What should we improve?', options: [], required: false },
];

export const surveyUrl = (surveyId: string, email: string) =>
  `${getAppUrl()}/feedback/${surveyId}?t=${createLinkToken(`feedback:${surveyId}`, email.toLowerCase())}`;

export const surveySendsAt = (survey: Pick<FeedbackSurvey, 'sendAfterHours'>, event: { date: Date; endDate: Date | null }) =>
  new Date(eventEndsAt(event).getTime() + survey.sendAfterHours * 60 * 60_000);

// Sends the survey once (claim: draft/scheduled → sent). If certificates
// are on and haven't gone out yet, they ride along in the same message.
export async function sendSurvey(surveyId: string) {
  const claim = await prisma.feedbackSurvey.updateMany({
    where: { id: surveyId, status: { in: ['draft', 'scheduled'] } },
    data: { status: 'sent', sentAt: new Date() },
  });
  if (claim.count === 0) return 0;

  const survey = await prisma.feedbackSurvey.findUniqueOrThrow({ where: { id: surveyId } });
  const event = await prisma.event.findUniqueOrThrow({ where: { id: survey.eventId }, select: { id: true, title: true } });

  // 'attended' falls back to every ticket holder when nobody was scanned
  // in (an event that didn't use the scanner).
  let recipients = await collectEventRecipients(event.id, survey.audience === 'attended' ? ['scanned'] : ['active', 'scanned']);
  if (recipients.length === 0 && survey.audience === 'attended') {
    recipients = await collectEventRecipients(event.id, ['active', 'scanned']);
  }
  const withCertificates = await claimCertificateSend(event.id);
  // Certificates are only for scanned-in tickets.
  const attended = withCertificates
    ? new Set((await collectEventRecipients(event.id, ['scanned'])).map((r) => r.email))
    : new Set<string | null>();

  const sent = await deliverToAll(
    recipients,
    (r) => {
      const url = surveyUrl(survey.id, r.email!);
      const certs = withCertificates && attended.has(r.email) ? r : null;
      return {
        email: (to) =>
          sendAfterEventEmail({
            to,
            buyerName: r.name,
            eventTitle: event.title,
            surveyUrl: url,
            certificateUrls: certs ? certs.ticketCodes.map(certificateUrl) : undefined,
          }),
        whatsapp:
          `Hi ${r.name}, thanks for coming to *${event.title}*! How did it go? 1-minute feedback:\n${url}` +
          (certs ? `\n\n${certificateLines(certs)}` : ''),
      };
    },
    'FEEDBACK'
  );
  await prisma.feedbackSurvey.update({ where: { id: survey.id }, data: { sentCount: sent } });
  return sent;
}

export async function sendDueSurveys(now = new Date()) {
  const surveys = await prisma.feedbackSurvey.findMany({ where: { status: 'scheduled' } });
  let sent = 0;
  for (const survey of surveys) {
    const event = await prisma.event.findUnique({ where: { id: survey.eventId }, select: { date: true, endDate: true, status: true } });
    if (!event || event.status === 'cancelled' || surveySendsAt(survey, event) > now) continue;
    try {
      await sendSurvey(survey.id);
      sent++;
    } catch (error) {
      console.error('CRITICAL_FEEDBACK_SEND_ERROR:', survey.id, error);
    }
  }
  return { sent };
}

export type QuestionResult =
  | { id: string; kind: 'rating'; prompt: string; count: number; average: number | null; distribution: number[] }
  | { id: string; kind: 'choice'; prompt: string; count: number; options: string[]; counts: number[] }
  | { id: string; kind: 'text'; prompt: string; count: number; answers: { text: string; at: Date }[] };

export async function getSurveyResults(survey: FeedbackSurvey) {
  const responses = await prisma.feedbackResponse.findMany({
    where: { surveyId: survey.id },
    orderBy: { createdAt: 'desc' },
    select: { answers: true, createdAt: true },
  });
  const questions: QuestionResult[] = survey.questions.map((q) => {
    const values = responses
      .map((r) => ({ value: (r.answers as Record<string, unknown>)?.[q.id], at: r.createdAt }))
      .filter((v) => v.value !== undefined && v.value !== null && v.value !== '');
    if (q.kind === 'rating') {
      const nums = values.map((v) => Number(v.value)).filter((n) => n >= 1 && n <= 5);
      const distribution = [1, 2, 3, 4, 5].map((star) => nums.filter((n) => n === star).length);
      const average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
      return { id: q.id, kind: 'rating', prompt: q.prompt, count: nums.length, average, distribution };
    }
    if (q.kind === 'choice') {
      const counts = q.options.map((o) => values.filter((v) => v.value === o).length);
      return { id: q.id, kind: 'choice', prompt: q.prompt, count: values.length, options: q.options, counts };
    }
    return {
      id: q.id,
      kind: 'text',
      prompt: q.prompt,
      count: values.length,
      answers: values.slice(0, 300).map((v) => ({ text: String(v.value), at: v.at })),
    };
  });
  return { responseCount: responses.length, questions };
}

// Validates an organiser's question list (keeps ids so existing answers
// stay attached to their question after an edit).
export function parseQuestions(input: unknown): { questions: Prisma.SurveyQuestionCreateInput[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Add at least one question.' };
  if (input.length > MAX_QUESTIONS) return { error: `A survey can have up to ${MAX_QUESTIONS} questions.` };
  const questions: Prisma.SurveyQuestionCreateInput[] = [];
  for (const raw of input) {
    const q = raw as Record<string, unknown>;
    const kind = q.kind as (typeof QUESTION_KINDS)[number];
    if (!QUESTION_KINDS.includes(kind)) return { error: 'Unknown question type.' };
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim().slice(0, 200) : '';
    if (!prompt) return { error: 'Every question needs some text.' };
    const options =
      kind === 'choice'
        ? (Array.isArray(q.options) ? q.options : [])
            .filter((o): o is string => typeof o === 'string')
            .map((o) => o.trim().slice(0, 100))
            .filter(Boolean)
            .slice(0, 8)
        : [];
    if (kind === 'choice' && options.length < 2) return { error: `"${prompt}" needs at least 2 options.` };
    const id = typeof q.id === 'string' && /^[a-f0-9]{12}$/.test(q.id) ? q.id : newQuestionId();
    questions.push({ id, kind, prompt, options, required: q.required === true });
  }
  return { questions };
}
