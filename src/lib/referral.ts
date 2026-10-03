// src/lib/referral.ts — browser only.
//
// Remembers a promoter's ?ref= code per organiser for REF_TTL_MS, so a
// buyer who lands on a promoter's link, browses, and buys later (same
// device) still credits that promoter. Last click wins.
const REF_TTL_MS = 30 * 24 * 60 * 60_000;
const key = (tenantSlug: string) => `tixflow_ref:${tenantSlug}`;

export function captureRef(tenantSlug: string) {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^[a-z0-9-]{1,30}$/i.test(ref)) {
      localStorage.setItem(key(tenantSlug), JSON.stringify({ code: ref.toLowerCase(), at: Date.now() }));
    }
  } catch {
    // Storage blocked (private mode etc.) — attribution is best-effort.
  }
}

export function getRef(tenantSlug: string): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key(tenantSlug)) || 'null');
    if (saved && typeof saved.code === 'string' && Date.now() - saved.at < REF_TTL_MS) return saved.code;
  } catch {}
  return undefined;
}
