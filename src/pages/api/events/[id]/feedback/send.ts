// src/pages/api/events/[id]/feedback/send.ts — "Send now" instead of waiting.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { sendSurvey } from '@/lib/feedback';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });
  if (session.role !== 'admin') return res.status(403).json({ error: 'Only admins can send surveys.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { id } = req.query;
  const survey =
    typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)
      ? await prisma.feedbackSurvey.findFirst({ where: { eventId: id, tenantId: session.tenantId } })
      : null;
  if (!survey) return res.status(404).json({ error: 'Survey not found.' });
  if (survey.status === 'sent' || survey.status === 'closed') return res.status(409).json({ error: 'This survey was already sent.' });

  // Sending is spaced out — run it in the background.
  sendSurvey(survey.id).catch((error) => console.error('CRITICAL_FEEDBACK_SEND_ERROR:', survey.id, error));
  return res.status(202).json({ success: true, message: 'Sending the survey to attendees.' });
}
