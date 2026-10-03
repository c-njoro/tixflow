// pages/dashboard/events/[id]/installments.tsx
//
// Lipa Pole Pole for one event: switch it on, set the terms, and follow
// every buyer's plan (extend a deadline, cancel, resend their link).
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

interface PlanRow {
  id: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  totalAmount: number;
  paidAmount: number;
  remaining: number;
  dueAt: string;
  createdAt: string;
  items: string;
  planUrl: string;
}

interface Data {
  settings: { installmentsEnabled: boolean; minDepositPercent: number; dueDaysBefore: number; dueAt: string; openForNewPlans: boolean };
  totals: { active: number; completed: number; collected: number; outstanding: number; seatsHeld: number };
  plans: PlanRow[];
}

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-slate-400';
const cardClass = 'p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl';
const buttonClass =
  'px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-40';
const primaryButtonClass =
  'px-4 py-2 text-xs font-mono uppercase tracking-wider bg-white text-black rounded-md hover:bg-slate-200 transition disabled:opacity-40';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-sky-950/40 text-sky-400 border-sky-800/50',
  completed: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  expired: 'bg-amber-950/40 text-amber-400 border-amber-800/50',
  cancelled: 'bg-slate-800/60 text-slate-400 border-slate-700',
};

const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function InstallmentsPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [data, setData] = useState<Data | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [minDeposit, setMinDeposit] = useState('');
  const [dueDays, setDueDays] = useState('');
  const [extending, setExtending] = useState<{ id: string; dueAt: string } | null>(null);
  const [copied, setCopied] = useState('');

  const applyData = (d: Data) => {
    setData(d);
    setMinDeposit(String(d.settings.minDepositPercent));
    setDueDays(String(d.settings.dueDaysBefore));
  };

  const request = useCallback(
    async (method: string, body?: unknown, path = '') => {
      const res = await fetch(`/api/events/${id}/installments${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      return result.data;
    },
    [id]
  );

  useEffect(() => {
    if (!id) return;
    request('GET')
      .then(applyData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'));
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id, request]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = (changes: Record<string, unknown>) => run(async () => applyData(await request('PATCH', changes)));

  const planAction = (planId: string, body: Record<string, unknown>) =>
    run(async () => {
      await request('POST', body, `/${planId}`);
      applyData(await request('GET'));
      setExtending(null);
    });

  const copy = async (url: string, planId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(planId);
      setTimeout(() => setCopied(''), 2000);
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">Lipa Pole Pole</h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">{eventTitle || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>
      )}

      {data && (
        <>
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-xl">
                <h2 className="text-sm font-semibold text-white">Let buyers pay in instalments</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Buyers pay a deposit by M-Pesa to reserve their seats, then top up in any amounts. Tickets are sent when
                  it&apos;s fully paid. Unpaid plans expire at the deadline and their seats go back on sale; money already
                  paid stays in your balance for you to settle with the buyer.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveSettings({ installmentsEnabled: !data.settings.installmentsEnabled })}
                className={`px-4 py-2 text-xs font-mono uppercase tracking-wider rounded-md border transition ${
                  data.settings.installmentsEnabled
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                    : 'border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                {data.settings.installmentsEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className={labelClass}>Minimum deposit (%)</label>
                <input type="number" min={5} max={90} value={minDeposit} onChange={(e) => setMinDeposit(e.target.value)} className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label className={labelClass}>Fully paid by (days before event)</label>
                <input type="number" min={0} max={60} value={dueDays} onChange={(e) => setDueDays(e.target.value)} className={`${inputClass} mt-1`} />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveSettings({ minDepositPercent: Number(minDeposit), dueDaysBefore: Number(dueDays) })}
                className={primaryButtonClass}
              >
                Save terms
              </button>
            </div>
            <p className="text-xs text-slate-500">
              New plans are due {when(data.settings.dueAt)}.{' '}
              {data.settings.installmentsEnabled && !data.settings.openForNewPlans &&
                'That is less than a day away, so buyers can no longer start new plans.'}
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label="Active plans" value={String(data.totals.active)} sub={`${data.totals.seatsHeld} seats held`} />
            <Tile label="Paid off" value={String(data.totals.completed)} />
            <Tile label="Collected" value={kes(data.totals.collected)} />
            <Tile label="Still to come in" value={kes(data.totals.outstanding)} />
          </div>

          {data.plans.length === 0 ? (
            <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs font-mono uppercase tracking-widest text-slate-500">
              No plans yet
            </div>
          ) : (
            <div className="space-y-2">
              {data.plans.map((p) => (
                <div key={p.id} className={`${cardClass} space-y-3`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{p.buyerName}</p>
                      <p className="text-xs text-slate-500">
                        {p.buyerEmail} · {p.buyerPhone} · {p.items}
                      </p>
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${STATUS_STYLES[p.status]}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                    <span className="text-white">
                      {kes(p.paidAmount)} <span className="text-slate-500">of {kes(p.totalAmount)}</span>
                    </span>
                    {p.status === 'active' && <span className="text-slate-400">{kes(p.remaining)} left · due {when(p.dueAt)}</span>}
                  </div>
                  {p.status !== 'completed' && (
                    <div className="flex flex-wrap gap-2 items-center">
                      {extending?.id === p.id ? (
                        <>
                          <input
                            type="datetime-local"
                            value={extending.dueAt}
                            onChange={(e) => setExtending({ id: p.id, dueAt: e.target.value })}
                            className={`${inputClass} w-auto`}
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => planAction(p.id, { action: 'extend', dueAt: new Date(extending.dueAt).toISOString() })}
                            className={primaryButtonClass}
                          >
                            {p.status === 'active' ? 'Save deadline' : 'Reopen plan'}
                          </button>
                          <button type="button" onClick={() => setExtending(null)} className={buttonClass}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setExtending({ id: p.id, dueAt: toLocalInput(p.dueAt) })}
                            className={buttonClass}
                          >
                            {p.status === 'active' ? 'Extend deadline' : 'Reopen with new deadline'}
                          </button>
                          {p.status === 'active' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`Cancel ${p.buyerName}'s plan and release their seats? Settle the ${kes(p.paidAmount)} they paid with them directly.`)) {
                                  planAction(p.id, { action: 'cancel' });
                                }
                              }}
                              className="px-2 text-xs font-mono uppercase text-rose-400 hover:text-rose-300"
                            >
                              Cancel plan
                            </button>
                          )}
                          <button type="button" onClick={() => copy(p.planUrl, p.id)} className={buttonClass}>
                            {copied === p.id ? 'Copied' : 'Copy buyer link'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={cardClass}>
      <p className={labelClass}>{label}</p>
      <p className="text-2xl font-semibold text-white mt-2">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
