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

  const statCards = stats
    ? [
        { label: 'Total Events', value: stats.totals.totalEvents },
        { label: 'Published', value: stats.totals.publishedEvents },
        { label: 'Tickets Issued', value: stats.totals.ticketsIssued },
        { label: 'Tickets Scanned', value: stats.totals.ticketsScanned },
        { label: 'Revenue', value: `KES ${stats.totals.revenue.toLocaleString()}` },
      ]
    : [];

  // Scanner staff have no financial data to see here — a simple pointer to
  // where their actual job (check-in) happens is more useful than a
  // "not authorized" wall.
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
            Dashboard
          </h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {user ? `Welcome back, ${user.name}` : 'Overview'}
          </p>
        </div>
        <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-[#0B0F17]/40 text-center">
          <p className="text-sm text-slate-300 mb-4">
            Head to Events to check attendees in for a specific event.
          </p>
          <Link
            href="/dashboard/events"
            className="inline-block px-4 py-2 text-xs font-mono uppercase tracking-wider bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 transition"
          >
            Go to Events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
          Dashboard
        </h1>
        <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
          {user ? `Welcome back, ${user.name}` : 'Overview'}
        </p>
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Loading dashboard...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="p-4 bg-[#0E131F] border border-slate-800/80 rounded-xl"
              >
                <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                  {card.label}
                </div>
                <div className="text-2xl font-mono font-bold text-white mt-1">
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
                Upcoming Events
              </h3>
              <Link
                href="/dashboard/events"
                className="text-xs font-mono uppercase tracking-wider text-slate-400 hover:text-white transition"
              >
                View All →
              </Link>
            </div>

            {stats && stats.upcomingEvents.length === 0 ? (
              <p className="text-xs font-mono text-slate-600 uppercase tracking-widest">
                No published events coming up
              </p>
            ) : (
              <div className="space-y-2">
                {stats?.upcomingEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/dashboard/events/${event.id}`}
                    className="block p-3 border border-slate-800 rounded-lg hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-white">{event.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {new Date(event.date).toLocaleString()} &middot; {event.location}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-slate-400 shrink-0">
                        {event.sold} / {event.capacity}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}