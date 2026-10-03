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
}

export async function sendTicketConfirmationEmail(details: TicketConfirmationDetails) {
  // QR codes are embedded as inline CID attachments rather than <img src="https://...">
  // pointing back at the app. A remote-URL image depends on the app being
  // reachable *at the moment the email is opened* (breaks entirely behind a
  // dev tunnel like ngrok, and many email clients block remote images by
  // default anyway) — an embedded attachment has none of that risk since
  // the image data travels with the email itself.
  const attachments: Attachment[] = [];

  const ticketRows = await Promise.all(
    details.tickets.map(async (t) => {
      const pngBuffer = await QRCode.toBuffer(t.ticketCode, { type: 'png', width: 240, margin: 1 });
      const contentId = `qr-${t.ticketCode}`;

      attachments.push({
        filename: `${t.ticketCode}.png`,
        content: pngBuffer.toString('base64'),
        contentId,
      });

      return `
        <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
          <img src="cid:${contentId}" width="80" height="80" alt="QR code" style="border-radius:6px;" />
          <div>
            <div style="font-weight:600;">${escapeHtml(t.tierName)}</div>
            <div style="font-family:monospace;font-size:12px;color:#555;">${t.ticketCode}</div>
          </div>
        </div>
      `;
    })
  );

  const plural = details.tickets.length === 1;

  await send(
    details.buyerEmail,
    `Your tickets for ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You're going to ${escapeHtml(details.eventTitle)}!</h2>
        <p>${formatEventDate(details.eventDate)} &middot; ${escapeHtml(details.eventLocation)}</p>
        <p>
          Hi ${escapeHtml(details.buyerName)}, here ${plural ? 'is your ticket' : 'are your tickets'}.
          Screenshot the QR code${plural ? '' : 's'} below — you'll need ${plural ? 'it' : 'them'} at the door.
        </p>
        ${ticketRows.join('')}
      </div>
    `,
    attachments
  );
}
interface SpaceInviteDetails {
  to: string;
  buyerName: string;
  eventTitle: string;
  spaceTitle: string;
  url: string;
}

export async function sendSpaceInviteEmail(details: SpaceInviteDetails) {
  await send(
    details.to,
    `Join the live space for ${details.eventTitle.replace(/[\r\n]+/g, ' ')}`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>${escapeHtml(details.spaceTitle)}</h2>
        <p>Hi ${escapeHtml(details.buyerName)}, ${escapeHtml(details.eventTitle)} has a live space for attendees.</p>
        <p>Open it on your phone during the event to follow the programme and documents, answer live polls and ask questions.</p>
        <p>
          <a href="${details.url}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Open the Event Space
          </a>
        </p>
        <p style="color:#666;font-size:12px;">No app or sign-up needed. You can also join by scanning the QR code at the venue.</p>
      </div>
    `
  );
}
