// src/pages/api/space/[code]/index.ts
//
// What attendee phones and the projector screen poll. Pass ?v=<version>
// from the previous response — if nothing changed the answer is just
// { changed: false }.
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  findSpaceByCode,
  getParticipantId,
  getParticipantState,
  getPublicState,
  touchParticipant,
} from '@/lib/eventSpace';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { code, v } = req.query;
  if (typeof code !== 'string') return res.status(400).json({ error: 'Invalid space code.' });

  const space = await findSpaceByCode(code);
  if (!space || space.event.status === 'cancelled') {
    return res.status(404).json({ error: 'This Event Space does not exist.' });
  }

  const participantId = getParticipantId(req);
  if (participantId) {
    touchParticipant(space.id, participantId).catch((err) => console.error('SPACE_TOUCH_ERROR:', err));
  }

  res.setHeader('Cache-Control', 'no-store');
  const { version, state } = await getPublicState(space);
  if (typeof v === 'string' && Number(v) === version) {
    return res.status(200).json({ changed: false, version });
  }

  const me = await getParticipantState(space.id, participantId, state.poll?.id ?? null);
  return res.status(200).json({ changed: true, version, state, me });
}
