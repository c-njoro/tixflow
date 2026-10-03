// src/pages/api/events/[id]/space/invites.ts
//
// "Send now" — lets the organiser send ticket holders the link earlier
// than the automatic send shortly before the event.
import type { NextApiRequest, NextApiResponse } from 'next';
import { loadExistingEventSpace } from '@/lib/spaceAdmin';
import { sendSpaceInvites } from '@/lib/spaceInvites';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loaded = await loadExistingEventSpace(req, res);
  if (!loaded) return;
  const { event, space } = loaded;

  if (space.inviteStatus !== 'pending') {
    return res.status(409).json({ error: 'Invites for this space have already been sent.' });
  }
  if (event.status === 'cancelled') {
    return res.status(400).json({ error: 'This event is cancelled.' });
  }

  sendSpaceInvites(space.id).catch((error) => console.error('CRITICAL_SPACE_INVITES_ERROR:', space.id, error));
  return res.status(202).json({ success: true, message: 'Sending invites to ticket holders.' });
}
