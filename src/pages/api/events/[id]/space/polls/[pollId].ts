// src/pages/api/events/[id]/space/polls/[pollId].ts
//
// PATCH { action } where action is one of:
//   'go_live'      — show this poll to attendees and accept answers (only one poll is live at a time)
//   'close'        — stop accepting answers; it stays on attendees' screens
//   'take_down'    — remove it from attendees' screens
// plus optional { showResults } and { hideAnswer } / { unhideAnswer } for text polls.
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { bumpSpace, normalizeAnswer } from '@/lib/eventSpace';
import { buildAdminState, loadExistingEventSpace } from '@/lib/spaceAdmin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadExistingEventSpace(req, res);
  if (!loaded) return;
  const { event, space } = loaded;

  const { pollId } = req.query;
  const poll =
    typeof pollId === 'string' ? await prisma.spacePoll.findFirst({ where: { id: pollId, spaceId: space.id } }) : null;
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });

  try {
    if (req.method === 'DELETE') {
      await prisma.$transaction([
        prisma.spacePollResponse.deleteMany({ where: { pollId: poll.id } }),
        prisma.spacePoll.delete({ where: { id: poll.id } }),
      ]);
      const updated = await bumpSpace(space.id, space.livePollId === poll.id ? { livePollId: null } : {});
      return res.status(200).json({ success: true, data: await buildAdminState(event, updated) });
    }

    const { action, showResults, hideAnswer, unhideAnswer } = req.body || {};
    const pollData: Prisma.SpacePollUpdateInput = {};
    const spaceData: Prisma.EventSpaceUpdateInput = {};

    if (action === 'go_live') {
      // Whatever was live before stops taking answers.
      if (space.livePollId && space.livePollId !== poll.id) {
        await prisma.spacePoll.updateMany({
          where: { id: space.livePollId, status: 'live' },
          data: { status: 'closed' },
        });
      }
      pollData.status = 'live';
      spaceData.livePollId = poll.id;
    } else if (action === 'close') {
      pollData.status = 'closed';
    } else if (action === 'take_down') {
      if (poll.status === 'live') pollData.status = 'closed';
      if (space.livePollId === poll.id) spaceData.livePollId = null;
    } else if (action !== undefined) {
      return res.status(400).json({ error: 'Unknown action.' });
    }

    if (typeof showResults === 'boolean') pollData.showResults = showResults;

    if (typeof hideAnswer === 'string' && hideAnswer.trim()) {
      const key = normalizeAnswer(hideAnswer);
      if (!poll.hiddenAnswers.includes(key)) pollData.hiddenAnswers = { set: [...poll.hiddenAnswers, key] };
    }
    if (typeof unhideAnswer === 'string') {
      const key = normalizeAnswer(unhideAnswer);
      pollData.hiddenAnswers = { set: poll.hiddenAnswers.filter((a) => a !== key) };
    }

    if (Object.keys(pollData).length > 0) {
      await prisma.spacePoll.update({ where: { id: poll.id }, data: pollData });
    }
    const updated = await bumpSpace(space.id, spaceData);
    return res.status(200).json({ success: true, data: await buildAdminState(event, updated) });
  } catch (error) {
    console.error('CRITICAL_SPACE_POLL_UPDATE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}
