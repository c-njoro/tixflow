// src/pages/api/events/[id]/spaces/[spaceId]/questions/[questionId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { bumpSpace, QUESTION_STATUSES } from '@/lib/eventSpace';
import { buildAdminState, loadEventSpace } from '@/lib/spaceAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadEventSpace(req, res);
  if (!loaded) return;
  const { event, space } = loaded;

  const { questionId } = req.query;
  const question =
    typeof questionId === 'string'
      ? await prisma.spaceQuestion.findFirst({ where: { id: questionId, spaceId: space.id } })
      : null;
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  // A question that leaves the public list can't stay on the projector.
  const clearSpotlight = space.spotlightQuestionId === question.id ? { spotlightQuestionId: null } : {};

  try {
    if (req.method === 'DELETE') {
      await prisma.$transaction([
        prisma.spaceQuestionVote.deleteMany({ where: { questionId: question.id } }),
        prisma.spaceQuestion.delete({ where: { id: question.id } }),
      ]);
      const updated = await bumpSpace(space.id, clearSpotlight);
      return res.status(200).json({ success: true, data: await buildAdminState(event, updated) });
    }

    const { status } = req.body || {};
    if (!QUESTION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid question status.' });
    }
    await prisma.spaceQuestion.update({ where: { id: question.id }, data: { status } });
    const updated = await bumpSpace(space.id, ['pending', 'hidden'].includes(status) ? clearSpotlight : {});
    return res.status(200).json({ success: true, data: await buildAdminState(event, updated) });
  } catch (error) {
    console.error('CRITICAL_SPACE_QUESTION_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
