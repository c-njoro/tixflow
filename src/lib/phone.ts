// src/lib/phone.ts

// Accepts the ways people actually type Kenyan mobile numbers —
// 0712345678, 712345678, 254712345678, +254 712 345 678 — and returns the
// canonical 07XXXXXXXX / 01XXXXXXXX form, or null if it isn't one.
export function normalizeKenyanPhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const cleaned = String(input).replace(/[\s\-()]/g, '');
  const match = cleaned.match(/^(?:\+?254|0)?([17]\d{8})$/);
  return match ? `0${match[1]}` : null;
}
