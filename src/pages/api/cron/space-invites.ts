// src/pages/api/cron/space-invites.ts
//
// Kept so an existing crontab line keeps working — it now runs every
// scheduled job. Point new schedulers at /api/cron/scheduled.
export { default } from './scheduled';
