// src/lib/rateLimit.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// In-memory fixed-window limiter. Same single-process assumption as
// src/lib/whatsapp.ts — the app runs as one long-lived `next start`, so one
// Map is the whole picture. If this ever runs on multiple instances, move
// the counters to Redis/Mongo.
interface Bucket {
  count: number;
  resetAt: number;
}

const globalForRl = globalThis as unknown as { __tixflowRateLimit?: Map<string, Bucket> };
const buckets = globalForRl.__tixflowRateLimit ?? new Map<string, Bucket>();
globalForRl.__tixflowRateLimit = buckets;

// Drop expired buckets now and then so the map can't grow without bound.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

// Behind a reverse proxy (nginx, Caddy, Cloudflare) the real client IP is
// the first X-Forwarded-For entry. Make sure the proxy overwrites that
// header rather than appending to a client-supplied one.
export function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'unknown';
}

// Returns true if the request may proceed. On false it has already sent a
// 429 — the caller should just `return`.
export function rateLimit(
  res: NextApiResponse,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    return false;
  }
  return true;
}
