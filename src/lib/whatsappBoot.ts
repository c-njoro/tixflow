// src/lib/whatsappBoot.ts — server-start hook (see src/instrumentation.ts).
import { getWhatsappProvider } from './whatsappSender';
import { isServerlessHost, resumeWhatsappIfStored } from './whatsapp';
import { backfillDefaults } from './backfillDefaults';
// Imported for its side effect: registers the flush-on-connect listener.
import './whatsappOutbox';

export function startWhatsappOnBoot() {
  // Older documents get new fields' defaults before anything filters on
  // them (e.g. the balance only counts orders with a paymentMethod).
  backfillDefaults().catch((error) => console.error('CRITICAL_BACKFILL_DEFAULTS_ERROR:', error));
  if (getWhatsappProvider() !== 'baileys' || isServerlessHost()) return;
  // Not awaited — the server shouldn't wait on WhatsApp to start serving.
  resumeWhatsappIfStored();
}
