// src/lib/scheduledJobs.ts
//
// The time-based jobs run by /api/cron/scheduled.
import { sendDueSpaceInvites } from './spaceInvites';
import { sendDueEventReminders } from './eventReminders';
import { expireOverduePlans, sendDueInstallmentReminders } from './installments';
import { sendDueSurveys } from './feedback';
import { backfillDefaults } from './backfillDefaults';

// Each job is independent — one failing never stops the others.
const JOBS: Record<string, () => Promise<unknown>> = {
  // First, so the jobs below can filter on fields old documents lacked.
  backfillDefaults,
  spaceInvites: sendDueSpaceInvites,
  eventReminders: () => sendDueEventReminders(),
  installmentReminders: () => sendDueInstallmentReminders(),
  installmentExpiry: () => expireOverduePlans(),
  feedbackSurveys: () => sendDueSurveys(),
};

// A run can take a while (sends are spaced out). If the scheduler fires
// again before it finishes, don't start a second overlapping run.
const globalForCron = globalThis as unknown as { __tixflowScheduledRunning?: boolean };

export async function runScheduledJobs() {
  if (globalForCron.__tixflowScheduledRunning) return { skipped: 'previous run still in progress' };
  globalForCron.__tixflowScheduledRunning = true;
  const results: Record<string, unknown> = {};
  try {
    for (const [name, job] of Object.entries(JOBS)) {
      try {
        results[name] = await job();
      } catch (error) {
        console.error(`CRITICAL_SCHEDULED_JOB_ERROR:${name}`, error);
        results[name] = { error: true };
      }
    }
  } finally {
    globalForCron.__tixflowScheduledRunning = false;
  }
  return results;
}
