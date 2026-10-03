// src/lib/whatsappTemplates.ts
//
// Every WhatsApp message the app sends, defined once for both providers:
//  - Baileys (unofficial, QR-linked number) sends `text` as-is.
//  - Meta's Cloud API can only start conversations with pre-approved
//    templates, so it sends `template` + `params` instead.
//
// The templates themselves (whatsappTemplates.json) are also what
// scripts/create-whatsapp-templates.mjs submits to Meta for approval, so
// the wording here and in WhatsApp Manager is identical. Meta rules they respect:
//  - positional variables {{1}}, {{2}}…, never at the very start or end
//    of the body;
//  - no newlines/tabs or 4+ consecutive spaces inside a parameter value.
import { formatEventDate } from './email';
import templateDefinitions from './whatsappTemplates.json';

export type TemplateName = keyof typeof TEMPLATES;

export interface WhatsappMessage {
  template: TemplateName;
  params: string[];
  // Free-form version for Baileys; may use WhatsApp *bold* and newlines.
  text: string;
  // Public image URL for templates with an IMAGE header (Cloud API).
  imageUrl?: string;
}

// The template definitions live in whatsappTemplates.json so that
// scripts/create-whatsapp-templates.mjs (plain Node) can read the exact
// same wording it submits to Meta. Each: category, optional IMAGE header,
// body with {{1}}… placeholders, and an example value per placeholder.
export const TEMPLATES = templateDefinitions;

// Parameter values can't hold newlines, tabs or long runs of spaces.
const clean = (value: string | number) => String(value).replace(/\s+/g, ' ').trim() || '-';
const kes = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 2 });

const placeholderCount = (template: TemplateName) => (TEMPLATES[template].body.match(/\{\{\d+\}\}/g) ?? []).length;

function message(template: TemplateName, params: (string | number)[], text: string, imageUrl?: string): WhatsappMessage {
  // Meta rejects a template send whose parameter count doesn't match the
  // approved template — catch that here, loudly, instead.
  if (params.length !== placeholderCount(template)) {
    throw new Error(`WhatsApp template ${template} expects ${placeholderCount(template)} params, got ${params.length}`);
  }
  return { template, params: params.map(clean), text, ...(imageUrl && { imageUrl }) };
}

export const ticketMessage = (d: {
  name: string;
  tierName: string;
  eventTitle: string;
  eventDate: Date | string;
  eventLocation: string;
  ticketCode: string;
  qrImageUrl: string;
}) =>
  message(
    'tixflow_ticket',
    [d.name, d.tierName, d.eventTitle, formatEventDate(d.eventDate), d.eventLocation, d.ticketCode],
    `${d.tierName}\n${d.ticketCode}`,
    d.qrImageUrl
  );

export const ticketLookupMessage = (link: string) =>
  message('tixflow_ticket_lookup', [link], `Here's your Tixflow tickets link: ${link}\n\nIt expires in 15 minutes.`);

export const eventSpaceMessage = (name: string, eventTitle: string, rooms: { title: string; url: string }[]) =>
  message(
    'tixflow_event_space',
    [name, eventTitle, rooms.map((r) => (rooms.length > 1 ? `${r.title}: ${r.url}` : r.url)).join(' | ')],
    `Hi ${name}, *${eventTitle}* has a live space for attendees.\n\n` +
      `Open it during the event to follow the programme, answer live polls and ask questions:\n` +
      rooms.map((r) => (rooms.length > 1 ? `• ${r.title}: ${r.url}` : r.url)).join('\n')
  );

export const eventReminderMessage = (d: {
  name: string;
  eventTitle: string;
  when: 'tomorrow' | 'in about 2 hours';
  eventDate: Date;
  eventLocation: string;
  mapsUrl: string;
  lookupUrl: string;
}) =>
  message(
    'tixflow_event_reminder',
    [d.name, d.eventTitle, d.when, formatEventDate(d.eventDate), d.eventLocation, d.mapsUrl, d.lookupUrl],
    `Hi ${d.name}, a reminder that *${d.eventTitle}* ${d.when === 'tomorrow' ? 'is *tomorrow*' : 'starts in about *2 hours*'}.\n\n` +
      `🗓 ${formatEventDate(d.eventDate)}\n📍 ${d.eventLocation}\n` +
      `Directions: ${d.mapsUrl}\n\n` +
      `Have your ticket QR code ready at the door. Lost it? ${d.lookupUrl}`
  );

export type InstallmentUpdate = 'started' | 'payment' | 'reminder';

export const installmentUpdateMessage = (d: {
  kind: InstallmentUpdate;
  name: string;
  eventTitle: string;
  paid: number;
  total: number;
  remaining: number;
  dueAt: Date;
  planUrl: string;
}) => {
  const lead = { started: 'your seats are reserved', payment: 'payment received', reminder: 'a payment reminder' }[d.kind];
  const due = formatEventDate(d.dueAt);
  const text = {
    started: `Your seats for *${d.eventTitle}* are reserved! KES ${kes(d.paid)} paid, KES ${kes(d.remaining)} left — pay by ${due}:\n${d.planUrl}`,
    payment: `Payment received for *${d.eventTitle}*. KES ${kes(d.remaining)} left, due by ${due}:\n${d.planUrl}`,
    reminder: `Reminder: KES ${kes(d.remaining)} left for *${d.eventTitle}*, due by ${due}. Pay any amount here:\n${d.planUrl}`,
  }[d.kind];
  return message(
    'tixflow_installment_update',
    [d.name, lead, d.eventTitle, kes(d.paid), kes(d.total), kes(d.remaining), due, d.planUrl],
    `Hi ${d.name}, ${text}`
  );
};

export const installmentExpiredMessage = (d: { name: string; eventTitle: string; organiser: string; paid: number }) =>
  message(
    'tixflow_installment_expired',
    [d.name, d.eventTitle, d.organiser, kes(d.paid)],
    `Hi ${d.name}, your Lipa Pole Pole plan for *${d.eventTitle}* passed its deadline before it was paid off, so the seats were released. ` +
      `Contact ${d.organiser} about the KES ${kes(d.paid)} you paid.`
  );

export const feedbackMessage = (name: string, eventTitle: string, url: string) =>
  message(
    'tixflow_feedback',
    [name, eventTitle, url],
    `Hi ${name}, thanks for coming to *${eventTitle}*! How did it go? 1-minute feedback:\n${url}`
  );

export const certificateMessage = (name: string, eventTitle: string, urls: string[]) =>
  message(
    'tixflow_certificate',
    [name, eventTitle, urls.join(' | ')],
    `Hi ${name}, thanks for attending *${eventTitle}*!\n\n` +
      (urls.length === 1
        ? `Your certificate of attendance: ${urls[0]}`
        : `Your certificates of attendance:\n${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}`)
  );
