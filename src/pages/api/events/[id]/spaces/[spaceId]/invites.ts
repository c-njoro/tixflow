// src/pages/api/events/[id]/spaces/[spaceId]/invites.ts
//
// "Send now" — lets the organiser send ticket holders the links earlier
// than the automatic send shortly before the event.
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@/lib/prisma';
import { buildAdminState, loadEventSpace } from '@/lib/spaceAdmin';
import { claimSpaceInvites, deliverClaimedInvites } from '@/lib/spaceInvites';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadEventSpace(req, res);
  if (!loaded) return;
  const { event, space } = loaded;

  if (space.inviteStatus !== 'pending') {
    return res.status(409).json({ error: 'Invites for this space have already been sent.' });
  }
  if (event.status === 'cancelled') {
    return res.status(400).json({ error: 'This event is cancelled.' });
  }

  // Claim and count recipients here, so the organiser gets a real answer
  // (or a real error); only the slow, spaced-out sending runs afterwards.
  // Sends every room of this event that's still waiting, in one message.
  let claimed;
  try {
    claimed = await claimSpaceInvites(event.id);
  } catch (error) {
    console.error('CRITICAL_SPACE_INVITES_ERROR:', event.id, error);
    return res.status(500).json({ error: 'Could not start sending invites. Try again.' });
  }
  if (!claimed) return res.status(409).json({ error: 'These invites are already being sent.' });

  deliverClaimedInvites(claimed).catch((error) => console.error('CRITICAL_SPACE_INVITES_ERROR:', event.id, error));
  const updated = await prisma.eventSpace.findUniqueOrThrow({ where: { id: space.id } });
  return res.status(202).json({
    success: true,
    message: `Sending the Event Space link to ${claimed.recipients.length} ${claimed.recipients.length === 1 ? 'person' : 'people'}.`,
    data: await buildAdminState(event, updated),
  });
}
