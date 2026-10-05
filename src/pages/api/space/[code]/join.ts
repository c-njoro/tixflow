// src/pages/api/space/[code]/join.ts
//
// Anyone with the link or QR code can join — the organiser controls who is
// physically in the room. Joining just gives this device an anonymous id.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { ACTIVE_WINDOW_MS, ensureParticipantId, findSpaceByCode, touchParticipant } from '@/lib/eventSpace';
import { loadEntitlements } from '@/lib/plans';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!rateLimit(res, `space-join:${getClientIp(req)}`, 60, 10 * 60_000)) return;

  const { code } = req.query;
  if (typeof code !== 'string') return res.status(400).json({ error: 'Invalid space code.' });

  const space = await findSpaceByCode(code);
  if (!space || space.event.status === 'cancelled') {
    return res.status(404).json({ error: 'This Event Space does not exist.' });
  }

  const participantId = ensureParticipantId(req, res);

  // Free plans cap how many people can be in a room at once. Someone
  // already in (rejoining, refreshing) is never turned away.
  const limits = await loadEntitlements(space.eventId);
  if (limits?.roomCapacity) {
    const here = await prisma.spaceParticipant.findUnique({
      where: { spaceId_participantId: { spaceId: space.id, participantId } },
    });
    if (!here) {
      const active = await prisma.spaceParticipant.count({
        where: { spaceId: space.id, lastSeenAt: { gte: new Date(Date.now() - ACTIVE_WINDOW_MS) } },
      });
      if (active >= limits.roomCapacity) {
        return res.status(409).json({ error: 'This room is full right now. Try again in a few minutes.' });
      }
    }
  }

  await touchParticipant(space.id, participantId, true);
  return res.status(200).json({ success: true });
}
