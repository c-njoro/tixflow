// pages/dashboard/events/[id]/waitlist.tsx
//
// Who's waiting for sold-out tickets, per ticket type. Seats that come
// back are offered to them automatically (src/lib/waitlist.ts); this page
// shows the line and what happened to each offer.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { buttonClass, cardClass } from '@/lib/ui';
import { formatDateTime } from '@/lib/format';

interface Entry {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  quantity: number;
  ticketTierId: string;
  status: 'waiting' | 'offered' | 'bought' | 'expired';
  offeredAt: string | null;
  offerExpiresAt: string | null;
  createdAt: string;
}

interface Data {
  title: string;
  waitlistEnabled: boolean;
  tiers: { id: string; name: string; capacity: number; sold: number }[];
  entries: Entry[];
}

const STATUS: Record<Entry['status'], { label: string; className: string }> = {
  waiting: { label: 'Waiting', className: 'bg-slate-800 text-slate-300' },
  offered: { label: 'Offer sent', className: 'bg-sky-950/40 text-sky-400' },
  bought: { label: 'Bought', className: 'bg-emerald-950/40 text-emerald-400' },
  expired: { label: 'Offer ran out', className: 'bg-amber-950/40 text-amber-400' },
};

export default function WaitlistPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/events/${id}/waitlist`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load the waitlist.');
    setData(result.data);
  }, [id]);

  useEffect(() => {
    // Fetch-on-mount; the state updates land after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err) => setError(err.message));
  }, [load]);

  const run = async (fn: () => Promise<Response>, done?: (result: { data?: { offered?: number } }) => string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fn();
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      if (done) setNotice(done(result));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = () =>
    run(() =>
      fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlistEnabled: !data?.waitlistEnabled }),
      })
    );
  const offerNow = () =>
    run(
      () => fetch(`/api/events/${id}/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'process' }) }),
      (r) => (r.data?.offered ? `Sent ${r.data.offered} offer${r.data.offered === 1 ? '' : 's'}.` : 'No free seats to offer right now.')
    );
  const remove = (e: Entry) => run(() => fetch(`/api/events/${id}/waitlist?entryId=${e.id}`, { method: 'DELETE' }), () => `${e.name} is off the waitlist.`);

  const entries = data?.entries ?? [];
  const waiting = entries.filter((e) => e.status === 'waiting');
  const bought = entries.filter((e) => e.status === 'bought');

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Waitlist</h1>
          <p className="text-sm text-slate-400 mt-1">{data?.title || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {notice && <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">{notice}</div>}

      {data && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-4`}>
          <div className="max-w-xl">
            <div className="text-sm font-medium text-white">Waitlist on sold-out tickets</div>
            <p className="text-sm text-slate-500 mt-0.5">
              When a ticket type sells out, buyers can join a line. Seats that come back from a refund, an expired Lipa Pole
              Pole plan or more capacity are held for the next people for 2 hours, and they get a link by email and WhatsApp.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && waiting.length > 0 && (
              <button type="button" disabled={busy} onClick={offerNow} className={buttonClass}>
                Offer free seats now
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                role="switch"
                aria-checked={data.waitlistEnabled}
                aria-label="Waitlist on sold-out tickets"
                disabled={busy}
                onClick={toggle}
                className={`relative w-11 h-6 rounded-full transition-colors ${data.waitlistEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[#fff] transition-transform ${data.waitlistEnabled ? 'translate-x-5' : ''}`} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Waiting', value: waiting.reduce((n, e) => n + e.quantity, 0), sub: `${waiting.length} people` },
          { label: 'Offers out', value: entries.filter((e) => e.status === 'offered').length, sub: 'Seats held now' },
          { label: 'Bought', value: bought.reduce((n, e) => n + e.quantity, 0), sub: 'Tickets from the waitlist' },
        ].map((s) => (
          <div key={s.label} className="p-3 bg-panel border border-slate-800/80 rounded-xl">
            <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">{s.label}</div>
            <div className="text-2xl tabular-nums font-bold text-white">{s.value}</div>
            <div className="text-[11px] text-slate-500">{s.sub}</div>
          </div>
        ))}
      </div>

      {!data ? (
        <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading...</p>
      ) : entries.length === 0 ? (
        <div className={`${cardClass} space-y-2`}>
          <h2 className="text-sm font-semibold text-white">Nobody is waiting</h2>
          <p className="text-sm text-slate-400">
            {data.waitlistEnabled
              ? 'When a ticket type sells out, a "Join the waitlist" button appears on your event page.'
              : 'The waitlist is off for this event.'}
          </p>
        </div>
      ) : (
        data.tiers
          .filter((t) => entries.some((e) => e.ticketTierId === t.id))
          .map((tier) => {
            let position = 0;
            return (
              <section key={tier.id}>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-base font-semibold text-white">{tier.name}</h2>
                  <span className="text-sm text-slate-500 tabular-nums">
                    {Math.max(tier.capacity - tier.sold, 0)} of {tier.capacity} free
                  </span>
                </div>
                <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
                  {entries
                    .filter((e) => e.ticketTierId === tier.id)
                    .map((e) => {
                      if (e.status === 'waiting') position++;
                      return (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-panel">
                          <div className="min-w-0">
                            <div className="text-sm text-white">
                              {e.status === 'waiting' && <span className="text-slate-500 tabular-nums mr-2">#{position}</span>}
                              {e.name}
                              <span className="text-slate-400 tabular-nums"> · {e.quantity} ticket{e.quantity === 1 ? '' : 's'}</span>
                            </div>
                            <div className="text-[13px] text-slate-500 truncate">
                              {[e.email, e.whatsapp].filter(Boolean).join(' · ')} · joined {formatDateTime(e.createdAt)}
                              {e.status === 'offered' && e.offerExpiresAt && ` · held until ${formatDateTime(e.offerExpiresAt)}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded font-medium ${STATUS[e.status].className}`}>
                              {STATUS[e.status].label}
                            </span>
                            {isAdmin && (e.status === 'waiting' || e.status === 'offered') && (
                              <button type="button" disabled={busy} onClick={() => remove(e)} className={buttonClass}>
                                Remove
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </section>
            );
          })
      )}
    </div>
  );
}
