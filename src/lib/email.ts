// src/lib/email.ts
import { Resend } from 'resend';
import QRCode from 'qrcode';

// Not thrown at module load — routes that don't send email shouldn't crash
// just because RESEND_API_KEY isn't set yet. Sending gracefully no-ops
// (with a console warning) until the key exists.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// The server may run in UTC — always show event times in Kenyan time.
export const formatEventDate = (date: Date | string) =>
  new Date(date).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });

const FROM_ADDRESS = process.env.EMAIL_FROM || 'Tixflow <onboarding@resend.dev>';

// Buyer names, event titles etc. are user-typed — escape them so nobody can
// inject links or markup into emails that go out under the platform's name.
const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface Attachment {
  filename: string;
  content: string; // base64
  contentId: string;
}

async function send(to: string, subject: string, html: string, attachments?: Attachment[]) {
  if (!to) return; // guests and walk-ins may have no email
  if (!resend) {
    console.warn(`[EMAIL] RESEND_API_KEY not set — skipping send to ${to}. Subject: "${subject}"`);
    return;
  }

  const result = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html, attachments });
  if (result.error) {
    console.error('CRITICAL_EMAIL_SEND_ERROR:', result.error);
    throw new Error('Failed to send email.');
  }
}

export async function sendPayoutOtpEmail(
  email: string,
  otp: string,
  details: { amount: number; feeAmount: number; netAmount: number }
) {
  await send(
    email,
    'Your Tixflow payout confirmation code',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Confirm your payout</h2>
        <p>Use this code to confirm the payout request below. It expires in 10 minutes.</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px;text-align:center;background:#f4f4f4;padding:16px;border-radius:8px;">
          ${otp}
        </p>
        <table style="width:100%;font-size:13px;color:#333;margin-top:12px;">
          <tr><td>Requested amount</td><td style="text-align:right;">KES ${details.amount.toLocaleString()}</td></tr>
          <tr><td>Platform fee</td><td style="text-align:right;">- KES ${details.feeAmount.toLocaleString()}</td></tr>
          <tr><td style="font-weight:700;">You'll receive</td><td style="text-align:right;font-weight:700;">KES ${details.netAmount.toLocaleString()}</td></tr>
        </table>
        <p style="color:#666;font-size:12px;margin-top:12px;">
          Confirming this code submits your request for admin review — money only moves once it's approved.
          If you didn't request this, ignore this email and consider checking your account activity.
        </p>
      </div>
    `
  );
}

export async function sendPayoutSettingsOtpEmail(email: string, otp: string, newDestination: string) {
  await send(
    email,
    'Confirm your new Tixflow payout details',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Confirm new payout details</h2>
        <p>Someone asked to change where your Tixflow payouts are sent to:</p>
        <p style="font-weight:600;">${escapeHtml(newDestination)}</p>
        <p>Use this code to confirm. It expires in 10 minutes.</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px;text-align:center;background:#f4f4f4;padding:16px;border-radius:8px;">
          ${otp}
        </p>
        <p style="color:#b00;font-size:12px;margin-top:12px;">
          If you didn't request this, do NOT share this code — change your password right away.
        </p>
      </div>
    `
  );
}

export async function sendPayoutSettingsChangedEmail(email: string, newDestination: string) {
  await send(
    email,
    'Your Tixflow payout details were changed',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Payout details updated</h2>
        <p>Future payouts will be sent to:</p>
        <p style="font-weight:600;">${escapeHtml(newDestination)}</p>
        <p style="color:#b00;font-size:12px;margin-top:12px;">
          If this wasn't you, contact support immediately and change your password.
        </p>
      </div>
    `
  );
}

export async function sendLookupMagicLinkEmail(email: string, magicLink: string) {
  await send(
    email,
    'View your Tixflow tickets',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Find your tickets</h2>
        <p>Click the button below to view your tickets. This link expires in 15 minutes.</p>
        <p>
          <a href="${magicLink}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            View My Tickets
          </a>
        </p>
        <p style="color:#666;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `
  );
}

interface TicketConfirmationDetails {
  buyerName: string;
  buyerEmail: string;
  eventTitle: string;
  eventDate: Date | string;
  eventLocation: string;
  tickets: { ticketCode: string; tierName: string }[];
  // Designed ticket cards (src/lib/ticketImage.tsx). Any ticket without
  // one falls back to a plain QR code, so a rendering problem never means
  // a missing ticket.
  ticketImages?: { ticketCode: string; data: Buffer; extension: string }[];
  // For "download ticket" links (the card at /api/tickets/<code>/image).
  appUrl?: string;
  // Passes from the organiser's guest list rather than a purchase.
  guestList?: boolean;
  // Someone gave this ticket to the buyer (src/lib/transfers.ts).
  fromName?: string;
}

export async function sendTicketConfirmationEmail(details: TicketConfirmationDetails) {
  // Tickets are embedded as inline CID attachments rather than <img src="https://...">
  // pointing back at the app. A remote-URL image depends on the app being
  // reachable *at the moment the email is opened* (and many email clients
  // block remote images by default) — an embedded attachment travels with
  // the email itself, and most mail apps also offer it as a download.
  const attachments: Attachment[] = [];
  const single = details.tickets.length === 1;

  const ticketBlocks = await Promise.all(
    details.tickets.map(async (t, i) => {
      const card = details.ticketImages?.find((img) => img.ticketCode === t.ticketCode);
      if (card) {
        const contentId = `ticket-${t.ticketCode}`;
        attachments.push({ filename: `ticket-${t.ticketCode}.${card.extension}`, content: card.data.toString('base64'), contentId });
        const download = details.appUrl
          ? `<p style="margin:8px 0 0;font-size:13px;"><a href="${details.appUrl}/api/tickets/${encodeURIComponent(t.ticketCode)}/image?download=1" style="color:#111;">Download ticket${single ? '' : ` ${i + 1}`}</a></p>`
          : '';
        return `
          <div style="margin:0 0 24px;text-align:center;">
            <img src="cid:${contentId}" width="340" alt="Ticket ${escapeHtml(t.ticketCode)} — ${escapeHtml(t.tierName)}" style="width:340px;max-width:100%;height:auto;border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,0.15);" />
            ${download}
          </div>`;
      }

      const pngBuffer = await QRCode.toBuffer(t.ticketCode, { type: 'png', width: 480, margin: 1 });
      const contentId = `qr-${t.ticketCode}`;
      attachments.push({ filename: `${t.ticketCode}.png`, content: pngBuffer.toString('base64'), contentId });
      return `
        <div style="border:1px solid #ddd;border-radius:12px;padding:16px;margin-bottom:16px;text-align:center;">
          <img src="cid:${contentId}" width="240" height="240" alt="QR code" />
          <div style="font-weight:600;margin-top:8px;">${escapeHtml(t.tierName)}</div>
          <div style="font-family:monospace;font-size:14px;color:#555;">${t.ticketCode}</div>
        </div>`;
    })
  );

  await send(
    details.buyerEmail,
    details.guestList
      ? `You're on the guest list for ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`
      : details.fromName
        ? `${details.fromName.replace(/[\r\n]+/g, ' ')} sent you a ticket for ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`
        : `Your tickets for ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>${details.guestList ? `You're on the guest list for ${escapeHtml(details.eventTitle)}` : `You're going to ${escapeHtml(details.eventTitle)}!`}</h2>
        <p>${formatEventDate(details.eventDate)} &middot; ${escapeHtml(details.eventLocation)}</p>
        <p>
          ${
            details.guestList
              ? `Hi ${escapeHtml(details.buyerName)}, here ${single ? 'is your pass' : `are your ${details.tickets.length} passes, one for you and one for each guest you're bringing`}.`
              : details.fromName
                ? `Hi ${escapeHtml(details.buyerName)}, ${escapeHtml(details.fromName)} gave you their ticket, so it's now in your name. The code they had no longer works.`
                : `Hi ${escapeHtml(details.buyerName)}, here ${single ? 'is your ticket' : `are your ${details.tickets.length} tickets`}.`
          }
          Show the QR code at the entrance — on your phone, or printed.${single || details.guestList ? '' : ' Each person needs their own ticket.'}
        </p>
        ${ticketBlocks.join('')}
        ${details.guestList ? '' : `<p style="color:#666;font-size:12px;">Can't make it? You can give your ticket to someone else from ${details.appUrl ? `<a href="${details.appUrl}/lookup">Find my tickets</a>` : 'Find my tickets on Tixflow'}.</p>`}
        <p style="color:#666;font-size:12px;">Lost this email? You can always get your tickets again at ${details.appUrl ? `<a href="${details.appUrl}/lookup">${details.appUrl.replace(/^https?:\/\//, '')}/lookup</a>` : 'the Tixflow lookup page'}.</p>
      </div>
    `,
    attachments
  );
}
interface SpaceInviteDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  rooms: { title: string; url: string }[];
}

export async function sendSpaceInviteEmail(details: SpaceInviteDetails) {
  const single = details.rooms.length === 1;
  const buttons = details.rooms
    .map(
      (room) => `
        <p>
          <a href="${room.url}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            ${single ? 'Open the Event Space' : `Open ${escapeHtml(room.title)}`}
          </a>
        </p>`
    )
    .join('');

  await send(
    details.to,
    `Join the live space for ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>${escapeHtml(details.eventTitle)}</h2>
        <p>Hi ${escapeHtml(details.buyerName)}, ${escapeHtml(details.eventTitle)} has a live space for attendees${single ? '' : ' in each room'}.</p>
        <p>Open it on your phone during the event to follow the programme and documents, answer live polls and ask questions.</p>
        ${buttons}
        <p style="color:#666;font-size:12px;">No app or sign-up needed. You can also join by scanning the QR code at the venue.</p>
      </div>
    `
  );
}

interface EventReminderDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  eventDate: Date | string;
  eventLocation: string;
  mapsUrl: string;
  lookupUrl: string;
  when: 'tomorrow' | 'soon';
}

export async function sendEventReminderEmail(details: EventReminderDetails) {
  const heading = details.when === 'tomorrow' ? 'See you tomorrow!' : 'Starting soon!';
  await send(
    details.to,
    `${details.when === 'tomorrow' ? 'Tomorrow' : 'Starting soon'}: ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>${heading}</h2>
        <p>Hi ${escapeHtml(details.buyerName)}, this is a reminder that <strong>${escapeHtml(details.eventTitle)}</strong>
        ${details.when === 'tomorrow' ? 'is tomorrow' : 'starts in about 2 hours'}.</p>
        <p style="font-size:15px;">
          <strong>${formatEventDate(details.eventDate)}</strong><br />
          ${escapeHtml(details.eventLocation)}
        </p>
        <p>
          <a href="${details.mapsUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Get directions
          </a>
        </p>
        <p style="color:#666;font-size:12px;">
          Have your ticket QR code ready at the door. Can't find it? <a href="${details.lookupUrl}">Get your tickets again</a>.
        </p>
      </div>
    `
  );
}

export async function sendPromoterPayoutOtpEmail(
  email: string,
  otp: string,
  details: { promoterName: string; phone: string; commission: number; feeAmount: number; amount: number }
) {
  await send(
    email,
    'Confirm a promoter commission payout',
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Confirm promoter payout</h2>
        <p>Use this code to confirm paying commission to <strong>${escapeHtml(details.promoterName)}</strong>
        (M-Pesa ${escapeHtml(details.phone)}). It expires in 10 minutes.</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px;text-align:center;background:#f4f4f4;padding:16px;border-radius:8px;">
          ${otp}
        </p>
        <table style="width:100%;font-size:13px;color:#333;margin-top:12px;">
          <tr><td>Promoter receives</td><td style="text-align:right;">KES ${details.commission.toLocaleString()}</td></tr>
          <tr><td>Platform fee</td><td style="text-align:right;">KES ${details.feeAmount.toLocaleString()}</td></tr>
          <tr><td style="font-weight:700;">Taken from your balance</td><td style="text-align:right;font-weight:700;">KES ${details.amount.toLocaleString()}</td></tr>
        </table>
        <p style="color:#b00;font-size:12px;margin-top:12px;">
          If you didn't request this, do NOT share this code — someone may be using your account. Change your password.
        </p>
      </div>
    `
  );
}

interface InstallmentEmailDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  paidAmount: number;
  totalAmount: number;
  dueAt: Date | string;
  planUrl: string;
  kind: 'started' | 'payment' | 'reminder' | 'expired';
  organiser?: string;
}

export async function sendInstallmentEmail(d: InstallmentEmailDetails) {
  const remaining = Math.max(Math.round((d.totalAmount - d.paidAmount) * 100) / 100, 0);
  const due = formatEventDate(d.dueAt);
  const subjects = {
    started: `Your seats for ${d.eventTitle} are reserved`,
    payment: `Payment received — KES ${remaining.toLocaleString()} left for ${d.eventTitle}`,
    reminder: `Reminder: KES ${remaining.toLocaleString()} due by ${due}`,
    expired: `Your Lipa Pole Pole plan for ${d.eventTitle} has expired`,
  };
  const intro = {
    started: `Your deposit is in and your seats for <strong>${escapeHtml(d.eventTitle)}</strong> are held for you.`,
    payment: `We received your payment towards <strong>${escapeHtml(d.eventTitle)}</strong>.`,
    reminder: `A reminder to finish paying for <strong>${escapeHtml(d.eventTitle)}</strong>.`,
    expired: `The deadline for <strong>${escapeHtml(d.eventTitle)}</strong> passed before the plan was paid off, so the seats have been released. Contact ${escapeHtml(d.organiser || 'the organiser')} about what you've already paid.`,
  };
  await send(
    d.to,
    subjects[d.kind].replace(/[\r\n]+/g, ' '),
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Lipa Pole Pole</h2>
        <p>Hi ${escapeHtml(d.buyerName)}, ${intro[d.kind]}</p>
        <table style="width:100%;font-size:14px;color:#333;margin:12px 0;">
          <tr><td>Paid so far</td><td style="text-align:right;">KES ${d.paidAmount.toLocaleString()}</td></tr>
          <tr><td>Total</td><td style="text-align:right;">KES ${d.totalAmount.toLocaleString()}</td></tr>
          <tr><td style="font-weight:700;">Left to pay</td><td style="text-align:right;font-weight:700;">KES ${remaining.toLocaleString()}</td></tr>
          ${d.kind === 'expired' ? '' : `<tr><td>Pay by</td><td style="text-align:right;">${due}</td></tr>`}
        </table>
        ${
          d.kind === 'expired'
            ? ''
            : `<p>
          <a href="${d.planUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Pay the next instalment
          </a>
        </p>
        <p style="color:#666;font-size:12px;">Pay any amount, any time before the deadline. Your tickets are sent as soon as it's fully paid.</p>`
        }
      </div>
    `
  );
}

interface AfterEventEmailDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  surveyUrl?: string;
  certificateUrls?: string[];
}

// The thank-you after an event: feedback survey and/or certificates.
export async function sendAfterEventEmail(d: AfterEventEmailDetails) {
  const certs = d.certificateUrls ?? [];
  const button = (url: string, label: string) => `
    <p>
      <a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">${label}</a>
    </p>`;
  await send(
    d.to,
    `Thanks for coming to ${d.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Thank you for coming!</h2>
        <p>Hi ${escapeHtml(d.buyerName)}, thanks for joining us at <strong>${escapeHtml(d.eventTitle)}</strong>.</p>
        ${d.surveyUrl ? `<p>Tell us how it went — it takes about a minute.</p>${button(d.surveyUrl, 'Give feedback')}` : ''}
        ${
          certs.length
            ? `<p>Your certificate of attendance is ready${certs.length > 1 ? ' (one per ticket)' : ''}:</p>` +
              certs.map((url, i) => button(url, certs.length > 1 ? `Certificate ${i + 1}` : 'Download certificate')).join('')
            : ''
        }
      </div>
    `
  );
}

// Heads-up to the Tixflow team (gear rentals, refunds to complete). Set
// PLATFORM_ALERT_EMAIL; without it these are only visible in platform admin.
export async function sendPlatformAlertEmail(subject: string, text: string) {
  const to = process.env.PLATFORM_ALERT_EMAIL;
  if (!to) return;
  await send(
    to,
    `[Tixflow] ${subject}`,
    `<div style="font-family: sans-serif; max-width: 560px;"><p>${escapeHtml(text)}</p></div>`
  );
}

interface CheckoutRetryEmailDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  eventDate: Date | string;
  items: string; // "2 × VIP, 1 × Regular"
  url: string;
}

// Win-back: a buyer whose M-Pesa or card payment failed (src/lib/checkoutRecovery.ts).
export async function sendCheckoutRetryEmail(d: CheckoutRetryEmailDetails) {
  await send(
    d.to,
    `Your tickets for ${d.eventTitle.replace(/[\r\n]+/g, ' ')} aren't booked yet`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your payment didn't go through</h2>
        <p>Hi ${escapeHtml(d.buyerName)}, your payment for <strong>${escapeHtml(d.eventTitle)}</strong> (${formatEventDate(d.eventDate)}) didn't complete, so your tickets aren't reserved yet.</p>
        <p>We saved your order: <strong>${escapeHtml(d.items)}</strong>. Pick up where you left off:</p>
        <p>
          <a href="${d.url}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Finish my order
          </a>
        </p>
        <p style="color:#666;font-size:12px;">Tickets are only held once paid, so they may sell out in the meantime. If you were charged anyway, don't pay again: check Find my tickets on Tixflow, or contact the organiser.</p>
      </div>
    `
  );
}

interface WaitlistOfferEmailDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  eventDate: Date | string;
  what: string; // "2 × VIP"
  until: string;
  url: string;
}

// Seats came back for someone on the waitlist (src/lib/waitlist.ts).
export async function sendWaitlistOfferEmail(d: WaitlistOfferEmailDetails) {
  await send(
    d.to,
    `Tickets are free for ${d.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your turn on the waitlist</h2>
        <p>Hi ${escapeHtml(d.buyerName)}, <strong>${escapeHtml(d.what)}</strong> for <strong>${escapeHtml(d.eventTitle)}</strong> (${formatEventDate(d.eventDate)}) just became available.</p>
        <p>They're held for you until <strong>${escapeHtml(d.until)}</strong>.</p>
        <p>
          <a href="${d.url}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Buy my tickets
          </a>
        </p>
        <p style="color:#666;font-size:12px;">After that they go to the next person on the waitlist.</p>
      </div>
    `
  );
}

interface GroupEmailDetails {
  to: string;
  name: string;
  eventTitle: string;
  url: string;
  // 'started': the starter's link to share; 'complete' / 'expired': how it ended.
  kind: 'started' | 'complete' | 'expired';
  paid: number;
  size: number;
  until?: string;
}

// The person who started a group booking (src/lib/groups.ts).
export async function sendGroupEmail(d: GroupEmailDetails) {
  const title = escapeHtml(d.eventTitle);
  const subjects = {
    started: `Your group for ${d.eventTitle}: share the link`,
    complete: `Your group for ${d.eventTitle} is fully paid`,
    expired: `Your group for ${d.eventTitle} has closed`,
  };
  const body = {
    started: `<p>Your group for <strong>${title}</strong> is set up: ${d.paid} of ${d.size} seats paid. Send this link to your friends so each of them pays for their own ticket by M-Pesa:</p>
      <p><a href="${d.url}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Open the group</a></p>
      <p style="word-break:break-all;font-size:13px;color:#333;">${d.url}</p>
      <p style="color:#666;font-size:12px;">The seats are held for your group until ${escapeHtml(d.until ?? '')}. Any that aren't paid by then go back on sale.</p>`,
    complete: `<p>Everyone in your group for <strong>${title}</strong> has paid: all ${d.size} seats are booked, and each person has their ticket.</p>
      <p><a href="${d.url}" style="color:#111;">See the group</a></p>`,
    expired: `<p>Time's up for your group for <strong>${title}</strong>: ${d.paid} of ${d.size} seats were paid. Everyone who paid has their ticket; the unpaid seats went back on sale.</p>
      <p><a href="${d.url}" style="color:#111;">See the group</a></p>`,
  };
  await send(
    d.to,
    subjects[d.kind].replace(/[\r\n]+/g, ' '),
    `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;"><h2>Group booking</h2><p>Hi ${escapeHtml(d.name)},</p>${body[d.kind]}</div>`
  );
}

interface TicketTransferredEmailDetails {
  to: string;
  fromName: string;
  toName: string;
  toEmail: string;
  eventTitle: string;
  eventDate: Date | string;
  ticketCode: string;
}

// To whoever gave a ticket away (src/lib/transfers.ts), so a transfer
// they didn't make doesn't go unnoticed.
export async function sendTicketTransferredEmail(d: TicketTransferredEmailDetails) {
  await send(
    d.to,
    `You gave your ticket for ${d.eventTitle.replace(/[\r\n]+/g, ' ')} to ${d.toName.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Your ticket is now ${escapeHtml(d.toName)}'s</h2>
        <p>Hi ${escapeHtml(d.fromName)}, your ticket <strong>${escapeHtml(d.ticketCode)}</strong> for <strong>${escapeHtml(d.eventTitle)}</strong> (${formatEventDate(d.eventDate)}) now belongs to ${escapeHtml(d.toName)} (${escapeHtml(d.toEmail)}). We've sent them a new ticket.</p>
        <p>Your old QR code no longer works at the gate.</p>
        <p style="color:#666;font-size:12px;">Didn't do this? Contact the event organiser straight away.</p>
      </div>
    `
  );
}
