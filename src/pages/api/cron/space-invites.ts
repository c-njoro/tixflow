// src/pages/api/cron/space-invites.ts
//
// Sends Event Space links to ticket holders once their event is about to
// start (see src/lib/spaceInvites.ts). Run it every few minutes alongside
// the reconcile job:
//   */5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/space-invites
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSecret, safeEqual } from '@/lib/secrets';
import { sendDueSpaceInvites } from '@/lib/spaceInvites';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const auth = req.headers.authorization || '';
  if (!safeEqual(auth, `Bearer ${getSecret('CRON_SECRET')}`)) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  // Sending is spaced out and can take a while for a big event — answer
  // the scheduler straight away and let it finish in the background
  // (single long-running `next start` process, as elsewhere).
  sendDueSpaceInvites()
    .then((summary) => console.log('[SPACE_INVITES]', summary))
    .catch((error) => console.error('CRITICAL_SPACE_INVITES_CRON_ERROR:', error));

  return res.status(202).json({ success: true, message: 'Checking for due Event Space invites.' });
}
