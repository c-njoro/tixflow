// src/pages/api/assistant/send-ticket-link.ts
//
// The website assistant's "find my tickets" tool: the same 15-minute link
// the lookup page sends, to the buyer's own email (and WhatsApp, if the
// number matches their checkout). The link itself never comes back here,
// so the chat can't hand someone else's tickets to whoever typed an email.
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAssistant } from '@/lib/assistantAuth';
import { rateLimit } from '@/lib/rateLimit';
import { LOOKUP_GENERIC_MESSAGE, sendTicketLookupLink } from '@/lib/ticketLookup';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  if (!requireAssistant(req, res)) return;

  const { email, whatsapp } = req.body ?? {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Ask the visitor for the email address they used when buying the tickets.' });
  }
  const normalizedEmail = email.toLowerCase().trim();

  // Every chat comes from the assistant's one server, so cap the inbox
  // (shared with the lookup page) and the assistant as a whole instead of
  // per IP.
  if (!rateLimit(res, `lookup:email:${normalizedEmail}`, 3, 15 * 60_000)) return;
  if (!rateLimit(res, 'lookup:assistant', 200, 15 * 60_000)) return;

  await sendTicketLookupLink(normalizedEmail, whatsapp);

  return res.status(200).json({
    success: true,
    message: LOOKUP_GENERIC_MESSAGE,
    tell_the_visitor:
      'If that email has bought tickets on Tixflow, a link to view them has just been sent to it' +
      (whatsapp ? ', and to WhatsApp if that number was used at checkout' : '') +
      '. The link works for 15 minutes. Check spam or promotions if it is not in the inbox.',
    rules_for_the_assistant:
      'Do not say whether this email has tickets — you are not told, on purpose. Never ask for or repeat a ticket link in the chat. If nothing arrives, ask them to check the spelling of the email, or try another email they might have used.',
  });
}
