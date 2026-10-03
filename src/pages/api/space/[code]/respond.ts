// src/pages/api/space/[code]/respond.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { bumpSpace, findSpaceByCode, getParticipantId, MAX_ANSWER_LENGTH, normalizeAnswer } from '@/lib/eventSpace';
import { rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const participantId = getParticipantId(req);
  if (!participantId) return res.status(401).json({ error: 'Join the space first.' });
  if (!rateLimit(res, `space-respond:${participantId}`, 30, 60_000)) return;

  const { code } = req.query;
  const space = typeof code === 'string' ? await findSpaceByCode(code) : null;
  if (!space || !space.isOpen) return res.status(404).json({ error: 'This Event Space is not open.' });

  const { pollId, optionIndex, text } = req.body || {};
  if (!pollId || pollId !== space.livePollId) {
    return res.status(409).json({ error: 'This poll is no longer live.' });
  }
  const poll = await prisma.spacePoll.findFirst({ where: { id: pollId, spaceId: space.id } });
  if (!poll || poll.status !== 'live') return res.status(409).json({ error: 'This poll is closed.' });

  let data: { optionIndex?: number; text?: string; normalized?: string };
  if (poll.kind === 'choice') {
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
      return res.status(400).json({ error: 'Pick one of the options.' });
    }
    data = { optionIndex };
  } else {
    const trimmed = typeof text === 'string' ? text.trim().slice(0, MAX_ANSWER_LENGTH) : '';
    const normalized = normalizeAnswer(trimmed);
    if (!normalized) return res.status(400).json({ error: 'Type an answer first.' });
    data = { text: trimmed, normalized };
  }

  try {
    await prisma.spacePollResponse.create({ data: { pollId: poll.id, spaceId: space.id, participantId, ...data } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'You already answered this poll.' });
    }
    console.error('CRITICAL_SPACE_RESPONSE_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }

  await prisma.spacePoll.update({ where: { id: poll.id }, data: { responseCount: { increment: 1 } } });
  await bumpSpace(space.id);
  return res.status(201).json({ success: true });
}
