// src/instrumentation.ts
//
// Runs once when the Next.js server starts (before it serves requests).
// Reconnects the QR-linked WhatsApp number straight away after a restart or
// deploy, instead of waiting for the next message or scheduled run — and
// anything queued meanwhile is flushed when it opens.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startWhatsappOnBoot } = await import('./lib/whatsappBoot');
  startWhatsappOnBoot();
}
