// src/pages/api/events/[id]/space/polls/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { MAX_POLL_OPTIONS } from '@/lib/eventSpace';
import { buildAdminState, loadExistingEventSpace } from '@/lib/spaceAdmin';

const MAX_QUESTION_LENGTH = 200;
const MAX_OPTION_LENGTH = 100;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadExistingEventSpace(req, res);
  if (!loaded) return;
  const { event, space } = loaded;

  const { question, kind, options, showResults } = req.body || {};
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'A question is required.' });
  }
  if (kind !== 'choice' && kind !== 'text') {
    return res.status(400).json({ error: 'kind must be "choice" or "text".' });
  }

  let cleanOptions: string[] = [];
  if (kind === 'choice') {
    cleanOptions = (Array.isArray(options) ? options : [])
      .filter((o): o is string => typeof o === 'string')
      .map((o) => o.trim().slice(0, MAX_OPTION_LENGTH))
      .filter(Boolean);
    if (cleanOptions.length < 2 || cleanOptions.length > MAX_POLL_OPTIONS) {
      return res.status(400).json({ error: `Multiple choice polls need 2–${MAX_POLL_OPTIONS} options.` });
    }
  }

  try {
    // Drafts aren't visible to attendees, so no version bump needed.
    await prisma.spacePoll.create({
      data: {
        spaceId: space.id,
        question: question.trim().slice(0, MAX_QUESTION_LENGTH),
        kind,
        options: cleanOptions,
        showResults: showResults !== false,
      },
    });
    return res.status(201).json({ success: true, data: await buildAdminState(event, space) });
  } catch (error) {
    console.error('CRITICAL_SPACE_POLL_CREATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
