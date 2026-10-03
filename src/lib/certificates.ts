// src/lib/certificates.ts
//
// Certificates of attendance for attendees whose ticket was scanned in.
// Each ticket gets its own signed certificate link (the attendee can set
// the name printed on it); organisers send them from the dashboard, and
// they're included in the post-event feedback message when both are on.
import { prisma } from './prisma';
import { getAppUrl } from './mpesaCallbacks';
import { createLinkToken } from './signedLinks';
import { sendAfterEventEmail } from './email';
import { collectEventRecipients, deliverToAll, type Recipient } from './attendeeMessaging';
import { notSet } from './mongoFilters';

export const DEFAULT_CERTIFICATE_TITLE = 'Certificate of Attendance';

export const certificateUrl = (ticketCode: string) =>
  `${getAppUrl()}/certificate/${encodeURIComponent(ticketCode)}?t=${createLinkToken('certificate', ticketCode)}`;

export const certificateLines = (r: Recipient) =>
  r.ticketCodes.length === 1
    ? `Your certificate of attendance: ${certificateUrl(r.ticketCodes[0])}`
    : `Your certificates of attendance:\n${r.ticketCodes.map((c, i) => `${i + 1}. ${certificateUrl(c)}`).join('\n')}`;

// Claims the event's one-time certificate send. Returns false if they were
// already sent (by an earlier click, or with the feedback survey).
export async function claimCertificateSend(eventId: string) {
  const claim = await prisma.event.updateMany({
    where: { id: eventId, certificatesEnabled: true, ...notSet('certificatesSentAt') },
    data: { certificatesSentAt: new Date() },
  });
  return claim.count > 0;
}

export async function sendCertificates(eventId: string) {
  if (!(await claimCertificateSend(eventId))) return 0;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { title: true } });
  const recipients = await collectEventRecipients(eventId, ['scanned']);
  return deliverToAll(
    recipients,
    (r) => ({
      email: (to) =>
        sendAfterEventEmail({ to, buyerName: r.name, eventTitle: event.title, certificateUrls: r.ticketCodes.map(certificateUrl) }),
      whatsapp: `Hi ${r.name}, thanks for attending *${event.title}*!\n\n${certificateLines(r)}`,
    }),
    'CERTIFICATE'
  );
}
