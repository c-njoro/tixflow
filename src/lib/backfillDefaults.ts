// src/lib/backfillDefaults.ts
//
// Writes the schema's @default values onto documents created before those
// fields existed, so `where` filters on them work. (Prisma can't filter a
// required field for "missing" — `isSet` is only allowed on optional ones.)
// Idempotent: each update only touches documents still missing the field.
// Runs once per server process, before the scheduled jobs.
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const DEFAULTS: Record<string, Record<string, Prisma.InputJsonValue>> = {
  Event: {
    remindersEnabled: true,
    installmentsEnabled: false,
    installmentMinDepositPercent: 25,
    installmentDueDaysBefore: 3,
    certificatesEnabled: false,
    reentryLimit: 0,
    passFeeToBuyer: false,
  },
  PendingOrder: { kind: 'purchase', paymentMethod: 'mpesa' },
  Ticket: { isInside: false, reentryCount: 0 },
};

const globalForBackfill = globalThis as unknown as { __tixflowDefaultsBackfilled?: boolean };

export async function backfillDefaults() {
  if (globalForBackfill.__tixflowDefaultsBackfilled) return { skipped: true };
  const updated: Record<string, number> = {};
  for (const [collection, fields] of Object.entries(DEFAULTS)) {
    const result = (await prisma.$runCommandRaw({
      update: collection,
      updates: Object.entries(fields).map(([field, value]) => ({
        q: { [field]: { $exists: false } },
        u: { $set: { [field]: value } },
        multi: true,
      })),
    })) as { nModified?: number };
    updated[collection] = result.nModified ?? 0;
  }
  globalForBackfill.__tixflowDefaultsBackfilled = true;
  return updated;
}
