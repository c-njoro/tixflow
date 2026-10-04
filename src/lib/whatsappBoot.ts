// src/lib/whatsappBoot.ts — server-start hook for WhatsApp (see src/instrumentation.ts).
import { getWhatsappProvider } from './whatsappSender';
import { isServerlessHost, resumeWhatsappIfStored } from './whatsapp';
// Imported for its side effect: registers the flush-on-connect listener.
import './whatsappOutbox';

export function startWhatsappOnBoot() {
  if (getWhatsappProvider() !== 'baileys' || isServerlessHost()) return;
  // Not awaited — the server shouldn't wait on WhatsApp to start serving.
  resumeWhatsappIfStored();
}
