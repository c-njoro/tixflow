// src/pages/api/space/[code]/vote.ts
//
// Toggles this attendee's upvote on a question.
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { bumpSpace, findSpaceByCode, getParticipantId } from '@/lib/eventSpace';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const participantId = getParticipantId(req);
  if (!participantId) return res.status(401).json({ error: 'Join the space first.' });
  if (!rateLimit(res, `space-vote:${participantId}`, 60, 60_000)) return;

  const { code } = req.query;
  const space = typeof code === 'string' ? await findSpaceByCode(code) : null;
  if (!space || !space.isOpen) return res.status(404).json({ error: 'This Event Space is not open.' });

  const { questionId } = req.body || {};
  const question =
    typeof questionId === 'string'
      ? await prisma.spaceQuestion.findFirst({
          where: { id: questionId, spaceId: space.id, status: { in: ['visible', 'answered'] } },
        })
      : null;
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  let voted: boolean;
  try {
    await prisma.spaceQuestionVote.create({ data: { questionId: question.id, spaceId: space.id, participantId } });
    await prisma.spaceQuestion.update({ where: { id: question.id }, data: { upvotes: { increment: 1 } } });
    voted = true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      console.error('CRITICAL_SPACE_VOTE_ERROR:', error);
      return res.status(500).json({ error: 'An internal server error occurred.' });
    }
    // Already upvoted — this tap takes it back. deleteMany so two quick
    // taps can't decrement twice.
    const removed = await prisma.spaceQuestionVote.deleteMany({ where: { questionId: question.id, participantId } });
    if (removed.count > 0) {
      await prisma.spaceQuestion.update({ where: { id: question.id }, data: { upvotes: { decrement: 1 } } });
    }
    voted = false;
  }

  await bumpSpace(space.id);
  return res.status(200).json({ success: true, data: { voted } });
}
