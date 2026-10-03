// src/pages/api/cron/scheduled.ts
//
// Every time-based job except payment reconciliation: Event Space invites,
// event reminders, and the jobs added alongside them. Run it every few
// minutes next to the reconcile job:
//   */5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/scheduled
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSecret, safeEqual } from '@/lib/secrets';
import { runScheduledJobs } from '@/lib/scheduledJobs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const auth = req.headers.authorization || '';
  if (!safeEqual(auth, `Bearer ${getSecret('CRON_SECRET')}`)) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  // Answer the scheduler straight away and let the jobs finish in the
  // background (single long-running `next start` process, as elsewhere).
  runScheduledJobs()
    .then((summary) => console.log('[SCHEDULED_JOBS]', JSON.stringify(summary)))
    .catch((error) => console.error('CRITICAL_SCHEDULED_JOBS_ERROR:', error));

  return res.status(202).json({ success: true, message: 'Scheduled jobs started.' });
}
