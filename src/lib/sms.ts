// src/lib/sms.ts
//
// SMS through Africa's Talking — the fallback for buyers without WhatsApp
// (or when WhatsApp didn't go through), and for box-office buyers who
// only give a phone number. Skipped quietly until AT_USERNAME and
// AT_API_KEY are set. AT_USERNAME=sandbox uses the AT sandbox.
import { getAppUrl } from './mpesaCallbacks';

export const smsConfigured = () => !!(process.env.AT_USERNAME && process.env.AT_API_KEY);

const endpoint = () =>
  process.env.AT_USERNAME === 'sandbox'
    ? 'https://api.sandbox.africastalking.com/version1/messaging/bulk'
    : 'https://api.africastalking.com/version1/messaging/bulk';

// 07XXXXXXXX → +2547XXXXXXXX
const toInternational = (phone: string) => (phone.startsWith('0') ? `+254${phone.slice(1)}` : phone);

export async function sendSms(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  if (!smsConfigured()) return { success: false, error: 'SMS is not set up.' };
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { apiKey: process.env.AT_API_KEY!, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: process.env.AT_USERNAME,
        phoneNumbers: [toInternational(phone)],
        message,
        ...(process.env.AT_SENDER_ID && { senderId: process.env.AT_SENDER_ID }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    const recipient = data?.SMSMessageData?.Recipients?.[0];
    // statusCode 100–102 = accepted for delivery.
    if (!res.ok || !recipient || recipient.statusCode > 102) {
      return { success: false, error: recipient?.status || data?.SMSMessageData?.Message || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'SMS failed.' };
  }
}

export const shortTicketUrl = (ticketCode: string) => `${getAppUrl()}/t/${ticketCode}`;

// One SMS: the event and a link per ticket (the page shows the QR).
export function ticketSmsMessage(eventTitle: string, eventDate: Date, codes: string[]) {
  const when = eventDate.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
  const shown = codes.slice(0, 3);
  const more = codes.length - shown.length;
  return (
    `Your ticket${codes.length === 1 ? '' : 's'} for ${eventTitle.slice(0, 60)} (${when}). Show at the gate:\n` +
    shown.map(shortTicketUrl).join('\n') +
    (more > 0 ? `\n+${more} more in your email` : '')
  );
}
