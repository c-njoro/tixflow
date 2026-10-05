// pages/dashboard/events/[id]/gate.tsx
//
// Live gate dashboard — how many are in, how fast they're arriving, which
// tiers are still to come. Refreshes itself; works on a screen at the gate.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

interface GateData {
  event: { id: string; title: string; date: string; location: string };
  totals: { scanned: number; expected: number; notArrived: number; perMinute: number };
  gate: { insideNow: number; reentryLimit: number; exits: number; reentries: number; rejected: number };
  tiers: { id: string; name: string; color: string; scanned: number; expected: number }[];
  arrivals: { bucketMinutes: number; buckets: { start: string; count: number }[] };
  staff: { name: string; count: number }[];
  recent: { name: string; tier: string; at: string; by: string | null }[];
  generatedAt: string;
}

const REFRESH_MS = 5000;
// Validated (dataviz validator) against the dashboard surface #0E131F.
const BAR_COLOR = '#0284c7';
const CHART_HEIGHT = 160;

const cardClass = 'p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl';
const labelClass = 'text-xs font-mono uppercase tracking-widest text-slate-500';
const buttonClass =
  'px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' });

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export default function GatePage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [data, setData] = useState<GateData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/events/${id}/gate`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load gate numbers.');
      setData(result.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gate numbers.');
    }
  }, [id]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let first = true;
    const loop = async () => {
      if (first || !document.hidden) await load();
      first = false;
      if (!stopped) timer = setTimeout(loop, REFRESH_MS);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">Gate</h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {data ? data.event.title : 'Loading event...'}
            {data && <> · updated {time(data.generatedAt)}</>}
          </p>
        </div>
        {id && (
          <div className="flex gap-2">
            <Link href={`/dashboard/events/${id}/checkin`} className={buttonClass}>
              Open scanner
            </Link>
            <Link href={`/dashboard/events/${id}`} className={buttonClass}>
              Back to Event
            </Link>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`${cardClass} col-span-2`}>
              <p className={labelClass}>Checked in</p>
              <p className="mt-2 text-white">
                <span className="text-5xl font-semibold">{data.totals.scanned.toLocaleString()}</span>
                <span className="text-xl text-slate-500"> / {data.totals.expected.toLocaleString()}</span>
              </p>
              <p className="text-sm text-slate-400 mt-1">{percent(data.totals.scanned, data.totals.expected)}% of ticket holders</p>
            </div>
            <div className={cardClass}>
              <p className={labelClass}>Arriving now</p>
              <p className="text-3xl font-semibold text-white mt-2">{data.totals.perMinute}</p>
              <p className="text-sm text-slate-400 mt-1">per minute (last 5 min)</p>
            </div>
            <div className={cardClass}>
              <p className={labelClass}>Not arrived yet</p>
              <p className="text-3xl font-semibold text-white mt-2">{data.totals.notArrived.toLocaleString()}</p>
              <p className="text-sm text-slate-400 mt-1">valid tickets not scanned</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={cardClass}>
              <p className={labelClass}>Inside now</p>
              <p className="text-3xl font-semibold text-white mt-2">{data.gate.insideNow.toLocaleString()}</p>
              <p className="text-sm text-slate-400 mt-1">
                {data.gate.reentryLimit > 0 ? 'checked in and not scanned out' : 'checked in'}
              </p>
            </div>
            {data.gate.reentryLimit > 0 && (
              <>
                <div className={cardClass}>
                  <p className={labelClass}>Exits</p>
                  <p className="text-3xl font-semibold text-white mt-2">{data.gate.exits.toLocaleString()}</p>
                </div>
                <div className={cardClass}>
                  <p className={labelClass}>Re-entries</p>
                  <p className="text-3xl font-semibold text-white mt-2">{data.gate.reentries.toLocaleString()}</p>
                  <p className="text-sm text-slate-400 mt-1">up to {data.gate.reentryLimit} per ticket</p>
                </div>
              </>
            )}
            <div className={cardClass}>
              <p className={labelClass}>Rejected scans</p>
              <p className="text-3xl font-semibold text-rose-400 mt-2">{data.gate.rejected.toLocaleString()}</p>
              <p className="text-sm text-slate-400 mt-1">copies, wrong event, used</p>
            </div>
          </div>

          <ArrivalsChart arrivals={data.arrivals} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className={`${cardClass} space-y-4 lg:col-span-2`}>
              <h3 className={labelClass}>By ticket type</h3>
              {data.tiers.length === 0 ? (
                <p className="text-sm text-slate-500">No ticket tiers.</p>
              ) : (
                data.tiers.map((tier) => {
                  const pct = percent(tier.scanned, tier.expected);
                  return (
                    <div key={tier.id}>
                      <div className="flex items-center justify-between gap-3 text-sm mb-1.5">
                        <span className="flex items-center gap-2 text-slate-200 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-slate-600" style={{ background: tier.color }} />
                          <span className="truncate">{tier.name}</span>
                        </span>
                        <span className="font-mono text-slate-400 shrink-0">
                          {tier.scanned} / {tier.expected} · {pct}%
                        </span>
                      </div>
                      {/* Meter: fill in the accent, track a lighter step of the same hue. */}
                      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#0c2a40' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: BAR_COLOR }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className={`${cardClass} space-y-3`}>
              <h3 className={labelClass}>Scans by staff</h3>
              {data.staff.length === 0 ? (
                <p className="text-sm text-slate-500">No scans yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {data.staff.map((s) => (
                      <tr key={s.name} className="border-t border-slate-800/80 first:border-0">
                        <td className="py-2 text-slate-300">{s.name}</td>
                        <td className="py-2 text-right font-mono text-slate-400">{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className={`${cardClass} space-y-3`}>
            <h3 className={labelClass}>Latest check-ins</h3>
            {data.recent.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody has been scanned in yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-normal">Time</th>
                    <th className="pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-normal">Name</th>
                    <th className="pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-normal">Ticket</th>
                    <th className="pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-normal hidden sm:table-cell">Scanned by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={`${r.at}-${i}`} className="border-t border-slate-800/80">
                      <td className="py-2 font-mono text-slate-400">{time(r.at)}</td>
                      <td className="py-2 text-white">{r.name}</td>
                      <td className="py-2 text-slate-300">{r.tier}</td>
                      <td className="py-2 text-slate-400 hidden sm:table-cell">{r.by ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Columns: arrivals per bucket over the last few hours. One series, so no
// legend — the heading names it. Hover a column for its exact count.
function ArrivalsChart({ arrivals }: { arrivals: GateData['arrivals'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...arrivals.buckets.map((b) => b.count), 0);
  // Clean y-axis top: 4, 10, 20, 50, 100...
  const niceMax = max <= 4 ? 4 : [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((n) => n >= max) ?? Math.ceil(max / 1000) * 1000;
  const ticks = [0, niceMax / 2, niceMax];
  const total = arrivals.buckets.reduce((sum, b) => sum + b.count, 0);
  const hovered = hover !== null ? arrivals.buckets[hover] : null;

  return (
    <div className={`${cardClass} space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={labelClass}>Arrivals per {arrivals.bucketMinutes} minutes · last 3 hours</h3>
        <p className="text-xs text-slate-400 h-4">
          {hovered
            ? `${time(hovered.start)}: ${hovered.count} ${hovered.count === 1 ? 'arrival' : 'arrivals'}`
            : `${total} in this window`}
        </p>
      </div>
      <div className="flex gap-2">
        {/* y-axis */}
        <div className="relative w-8 shrink-0 text-[10px] font-mono text-slate-500" style={{ height: CHART_HEIGHT }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: CHART_HEIGHT - (t / niceMax) * CHART_HEIGHT }}>
              {t}
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute left-0 right-0 border-t border-slate-800"
                style={{ top: CHART_HEIGHT - (t / niceMax) * CHART_HEIGHT }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {arrivals.buckets.map((bucket, i) => (
                // Whole column slot is the hover target, wider than the bar.
                <div
                  key={bucket.start}
                  className="flex-1 h-full flex items-end justify-center cursor-default"
                  onMouseEnter={() => setHover(i)}
                >
                  <div
                    className="w-full max-w-[24px] rounded-t-[4px] transition-all duration-500"
                    style={{
                      height: bucket.count === 0 ? 0 : Math.max((bucket.count / niceMax) * CHART_HEIGHT, 2),
                      background: BAR_COLOR,
                      opacity: hover === null || hover === i ? 1 : 0.55,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1.5">
            <span>{time(arrivals.buckets[0]?.start ?? new Date().toISOString())}</span>
            <span>{time(arrivals.buckets[Math.floor(arrivals.buckets.length / 2)]?.start ?? new Date().toISOString())}</span>
            <span>now</span>
          </div>
        </div>
      </div>
    </div>
  );
}
