// src/lib/eventReminders.ts
//
// "See you tomorrow" and "starting in about 2 hours" reminders to ticket
// holders, by email and WhatsApp, with a maps link to the venue. Run from
// /api/cron/scheduled. A reminder whose window was missed (cron down, or
// the event was created after it) is skipped rather than sent late.
import { prisma } from './prisma';
import { formatEventDate, sendEventReminderEmail } from './email';
import { getAppUrl } from './mpesaCallbacks';
import { collectEventRecipients, deliverToAll, mapsLink } from './attendeeMessaging';
import { notSet } from './mongoFilters';

const HOUR = 60 * 60_000;

// Day-before goes out 26h–3h before the start, so a slightly late cron
// still catches it and it never lands right next to the 2-hour one.
const WINDOWS = {
  day: { from: 26 * HOUR, to: 3 * HOUR, field: 'reminderDaySentAt' as const },
  hours: { from: 2 * HOUR, to: 0, field: 'reminderHoursSentAt' as const },
};
type Kind = keyof typeof WINDOWS;

function whatsappText(kind: Kind, name: string, event: { title: string; date: Date; location: string }) {
  const when = kind === 'day' ? 'is *tomorrow*' : 'starts in about *2 hours*';
  return (
    `Hi ${name}, a reminder that *${event.title}* ${when}.\n\n` +
    `🗓 ${formatEventDate(event.date)}\n📍 ${event.location}\n` +
    `Directions: ${mapsLink(event.location)}\n\n` +
    `Have your ticket QR code ready at the door. Lost it? ${getAppUrl()}/lookup`
  );
}

async function sendReminder(kind: Kind, eventId: string) {
  const window = WINDOWS[kind];
  // Claim first: only one cron run (or process) ever sends this reminder.
  const claim = await prisma.event.updateMany({
    where: { id: eventId, ...notSet(window.field) },
    data: { [window.field]: new Date() },
  });
  if (claim.count === 0) return 0;

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const recipients = await collectEventRecipients(eventId, ['active']);
  return deliverToAll(
    recipients,
    (r) => ({
      email: (to) =>
        sendEventReminderEmail({
          to,
          buyerName: r.name,
          eventTitle: event.title,
          eventDate: event.date,
          eventLocation: event.location,
          mapsUrl: mapsLink(event.location),
          lookupUrl: `${getAppUrl()}/lookup`,
          when: kind === 'day' ? 'tomorrow' : 'soon',
        }),
      whatsapp: whatsappText(kind, r.name, event),
    }),
    'EVENT_REMINDER'
  );
}

export async function sendDueEventReminders(now = new Date()) {
  const summary = { day: 0, hours: 0 };
  for (const kind of Object.keys(WINDOWS) as Kind[]) {
    const window = WINDOWS[kind];
    const events = await prisma.event.findMany({
      where: {
        status: 'published',
        // Old events get remindersEnabled backfilled first (backfillDefaults).
        remindersEnabled: true,
        date: { gt: new Date(now.getTime() + window.to), lte: new Date(now.getTime() + window.from) },
        ...notSet(window.field),
      },
      select: { id: true },
    });
    for (const event of events) {
      try {
        await sendReminder(kind, event.id);
        summary[kind]++;
      } catch (error) {
        console.error('CRITICAL_EVENT_REMINDER_ERROR:', kind, event.id, error);
      }
    }
  }
  return summary;
}
