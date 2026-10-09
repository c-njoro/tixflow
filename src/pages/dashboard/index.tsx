// pages/dashboard/index.tsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface UpcomingEvent {
  id: string;
  title: string;
  date: string;
  location: string;
  sold: number;
  capacity: number;
}

interface Stats {
  totals: {
    totalEvents: number;
    publishedEvents: number;
    ticketsIssued: number;
    ticketsScanned: number;
    revenue: number;
  };
  upcomingEvents: UpcomingEvent[];
}

export default function DashboardHome() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const loadStats = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/dashboard/stats');
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to load dashboard stats.');
        setStats(result.data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, [isAdmin]);

  // Scanner staff have no financial data to see here — a simple pointer to
  // where their actual job (check-in) happens is more useful than a
  // "not authorized" wall.
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">
            Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {user ? `Welcome back, ${user.name}` : 'Overview'}
          </p>
        </div>
        <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-ink/40 text-center">
          <p className="text-sm text-slate-300 mb-4">
            Head to Events to check attendees in for a specific event.
          </p>
          <Link
            href="/dashboard/events"
            className="inline-block px-4 py-2 text-[13px] bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 transition font-medium"
          >
            Go to Events
          </Link>
        </div>
      </div>
    );
  }

  const t = stats?.totals;
  const scannedPct = t && t.ticketsIssued > 0 ? Math.round((t.ticketsScanned / t.ticketsIssued) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-white">{user ? `Hi, ${user.name.split(' ')[0]}` : 'Dashboard'}</h1>
          <p className="text-sm text-slate-400 mt-1">Here&apos;s how your events are doing.</p>
        </div>
        <Link
          href="/dashboard/events/new"
          className="inline-flex items-center h-10 px-4 rounded-lg text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors"
        >
          New event
        </Link>
      </div>

      {error && (
        <div className="p-3 text-sm border rounded-lg bg-rose-950/30 text-rose-300 border-rose-800/50">{error}</div>
      )}

      {loading || !t ? (
        <div className="grid gap-px rounded-2xl overflow-hidden border border-slate-800/70 bg-slate-800/70 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="bg-panel p-6 h-[116px]">
              <div className="h-3 w-20 rounded bg-slate-800 animate-pulse" />
              <div className="mt-4 h-7 w-28 rounded bg-slate-800 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-px rounded-2xl overflow-hidden border border-slate-800/70 bg-slate-800/70 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="bg-panel p-6">
              <div className="text-sm text-slate-400">Revenue</div>
              <div className="mt-2 font-display text-4xl font-semibold tabular-nums text-white">
                <span className="text-xl text-slate-500 font-medium mr-1.5">KES</span>
                {t.revenue.toLocaleString()}
              </div>
            </div>
            <div className="bg-panel p-6">
              <div className="text-sm text-slate-400">Tickets issued</div>
              <div className="mt-2 text-3xl font-semibold tabular-nums text-white">{t.ticketsIssued.toLocaleString()}</div>
            </div>
            <div className="bg-panel p-6">
              <div className="text-sm text-slate-400">Checked in</div>
              <div className="mt-2 text-3xl font-semibold tabular-nums text-white">
                {t.ticketsScanned.toLocaleString()}
                <span className="ml-2 text-sm font-normal text-slate-500">{scannedPct}%</span>
              </div>
            </div>
            <div className="bg-panel p-6">
              <div className="text-sm text-slate-400">Events live</div>
              <div className="mt-2 text-3xl font-semibold tabular-nums text-white">
                {t.publishedEvents}
                <span className="ml-2 text-sm font-normal text-slate-500">of {t.totalEvents}</span>
              </div>
            </div>
          </div>

          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold text-white">Coming up</h2>
              <Link href="/dashboard/events" className="text-sm text-slate-400 hover:text-white transition-colors">
                All events
              </Link>
            </div>

            {stats.upcomingEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center">
                <p className="text-slate-300">No published events coming up.</p>
                <p className="mt-1 text-sm text-slate-500">Create an event and publish it to start selling.</p>
              </div>
            ) : (
              <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
                {stats.upcomingEvents.map((event) => {
                  const pct = event.capacity > 0 ? Math.min((event.sold / event.capacity) * 100, 100) : 0;
                  return (
                    <li key={event.id}>
                      <Link
                        href={`/dashboard/events/${event.id}`}
                        className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_200px] items-center gap-6 px-5 py-4 bg-panel hover:bg-raised transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-white truncate">{event.title}</div>
                          <div className="text-sm text-slate-500 truncate">
                            {new Date(event.date).toLocaleString('en-KE', {
                              timeZone: 'Africa/Nairobi',
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            · {event.location}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-right text-slate-300 tabular-nums">
                            {event.sold.toLocaleString()}
                            <span className="text-slate-500"> / {event.capacity.toLocaleString()} sold</span>
                          </div>
                          <div className="hidden sm:block mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
                            <div className="h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
