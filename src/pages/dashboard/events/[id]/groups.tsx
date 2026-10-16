// pages/dashboard/events/[id]/groups.tsx
//
// Group bookings for an event (src/lib/groups.ts): friends who started a
// group and are each paying for their own ticket.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { buttonClass, cardClass } from '@/lib/ui';
import { formatDateTime } from '@/lib/format';

interface GroupRow {
  id: string;
  code: string;
  starter: string;
  email: string;
  whatsapp: string | null;
  tierName: string;
  price: number;
  size: number;
  paidSeats: number;
  status: 'pending' | 'open' | 'complete' | 'expired';
  expiresAt: string;
  createdAt: string;
}

interface Data {
  title: string;
  groupBookingEnabled: boolean;
  groups: GroupRow[];
}

const STATUS: Record<GroupRow['status'], { label: string; className: string }> = {
  pending: { label: 'Starting', className: 'bg-slate-800 text-slate-300' },
  open: { label: 'Filling up', className: 'bg-sky-950/40 text-sky-400' },
  complete: { label: 'Fully paid', className: 'bg-emerald-950/40 text-emerald-400' },
  expired: { label: 'Closed', className: 'bg-amber-950/40 text-amber-400' },
};

export default function GroupBookingsPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/events/${id}/groups`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load group bookings.');
    setData(result.data);
  }, [id]);

  useEffect(() => {
    // Fetch-on-mount; the state updates land after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err) => setError(err.message));
  }, [load]);

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupBookingEnabled: !data?.groupBookingEnabled }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const groups = data?.groups ?? [];
  const seatsSold = groups.reduce((n, g) => n + g.paidSeats, 0);
  const revenue = groups.reduce((n, g) => n + g.paidSeats * g.price, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Group bookings</h1>
          <p className="text-sm text-slate-400 mt-1">{data?.title || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}

      {data && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-4`}>
          <div className="max-w-xl">
            <div className="text-sm font-medium text-white">Group bookings</div>
            <p className="text-sm text-slate-500 mt-0.5">
              Buyers can start a group on your event page and share the link: each friend pays for their own ticket by
              M-Pesa. Their seats are held for up to 48 hours (ending 3 hours before the event); unpaid ones go back on sale.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              role="switch"
              aria-checked={data.groupBookingEnabled}
              aria-label="Group bookings"
              disabled={busy}
              onClick={toggle}
              className={`relative w-11 h-6 rounded-full transition-colors ${data.groupBookingEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[#fff] transition-transform ${data.groupBookingEnabled ? 'translate-x-5' : ''}`} />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Groups', value: groups.length.toLocaleString(), sub: `${groups.filter((g) => g.status === 'open').length} filling up` },
          { label: 'Seats paid', value: seatsSold.toLocaleString(), sub: `of ${groups.reduce((n, g) => n + g.size, 0)} in groups` },
          { label: 'Ticket sales', value: `KES ${Math.round(revenue).toLocaleString()}`, sub: 'From group shares' },
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
      ) : groups.length === 0 ? (
        <div className={`${cardClass} space-y-2`}>
          <h2 className="text-sm font-semibold text-white">No groups yet</h2>
          <p className="text-sm text-slate-400">
            {data.groupBookingEnabled
              ? 'Buyers see "Buying with friends? Start a group" under the tickets on your event page.'
              : 'Group bookings are off for this event.'}
          </p>
        </div>
      ) : (
        <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
          {groups.map((g) => (
            <li key={g.id} className="px-4 sm:px-5 py-4 bg-panel space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white">
                    {g.starter}&apos;s group
                    <span className="text-slate-400"> · {g.tierName}</span>
                  </div>
                  <div className="text-[13px] text-slate-500 truncate">
                    {[g.email, g.whatsapp].filter(Boolean).join(' · ')} · started {formatDateTime(g.createdAt)}
                  </div>
                </div>
                <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded font-medium ${STATUS[g.status].className}`}>
                  {STATUS[g.status].label}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-emerald-500/80" style={{ width: `${(g.paidSeats / g.size) * 100}%` }} />
                </div>
                <span className="text-sm text-slate-300 tabular-nums shrink-0">
                  {g.paidSeats} / {g.size} paid
                </span>
              </div>
              {(g.status === 'open' || g.status === 'pending') && (
                <p className="text-[13px] text-slate-500">
                  Unpaid seats held until {formatDateTime(g.expiresAt)} ·{' '}
                  <a href={`/g/${g.code}`} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-white underline underline-offset-2">
                    group page
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
