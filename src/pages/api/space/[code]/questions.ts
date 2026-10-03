// src/pages/api/space/[code]/questions.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { bumpSpace, findSpaceByCode, getParticipantId, MAX_QUESTION_LENGTH } from '@/lib/eventSpace';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const participantId = getParticipantId(req);
  if (!participantId) return res.status(401).json({ error: 'Join the space first.' });
  if (!rateLimit(res, `space-question:${participantId}`, 5, 5 * 60_000)) return;

  const { code } = req.query;
  const space = typeof code === 'string' ? await findSpaceByCode(code) : null;
  if (!space || !space.isOpen) return res.status(404).json({ error: 'This Event Space is not open.' });

  const { text, authorName } = req.body || {};
  const cleanText = typeof text === 'string' ? text.trim().slice(0, MAX_QUESTION_LENGTH) : '';
  if (cleanText.length < 3) return res.status(400).json({ error: 'Type your question first.' });
  const cleanName = typeof authorName === 'string' ? authorName.trim().slice(0, 40) : '';

  const status = space.moderateQuestions ? 'pending' : 'visible';
  await prisma.spaceQuestion.create({
    data: { spaceId: space.id, participantId, text: cleanText, authorName: cleanName || null, status },
  });
  // A question waiting for approval isn't public — only the asker's own
  // view changes, and their page refetches after asking anyway.
  if (status === 'visible') await bumpSpace(space.id);

  return res.status(201).json({ success: true, data: { status } });
}
