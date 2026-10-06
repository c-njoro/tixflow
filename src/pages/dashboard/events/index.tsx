// pages/dashboard/events/index.tsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { dangerButtonClass, primaryButtonClass } from '@/lib/ui';

interface TicketTier {
  id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
}

interface EventRow {
  id: string;
  title: string;
  slug: string;
  date: string;
  location: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  coverImageUrl: string | null;
  ticketTiers: TicketTier[];
  _count: { tickets: number };
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  published: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  cancelled: 'bg-rose-950/40 text-rose-400 border-rose-800/50',
  completed: 'bg-slate-800/60 text-slate-400 border-slate-700',
};

export default function EventsListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadEvents = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/events');
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load events.');
      setEvents(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this event permanently? This cannot be undone.')) return;
    setDeletingId(id);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete event.');
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const tierTotals = (tiers: TicketTier[]) => {
    const capacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
    const sold = tiers.reduce((sum, t) => sum + t.sold, 0);
    return { capacity, sold };
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-white">Events</h1>
          <p className="text-sm text-slate-400 mt-1">
            {isAdmin ? 'Create, publish and run your events.' : 'Pick an event to check attendees in.'}
          </p>
        </div>
        {isAdmin && (
          <Link href="/dashboard/events/new" className={primaryButtonClass}>
            New event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-sm border rounded-lg bg-rose-950/30 text-rose-300 border-rose-800/50">{error}</div>}

      {loading ? (
        <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
          {[0, 1, 2].map((k) => (
            <li key={k} className="flex items-center gap-4 px-5 py-4 bg-[#0E131F]">
              <div className="w-20 h-12 rounded-lg bg-slate-800 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-48 rounded bg-slate-800 animate-pulse" />
                <div className="h-3 w-32 rounded bg-slate-800/70 animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center">
          <p className="text-slate-200">No events yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            {isAdmin ? 'Create your first event — it stays a draft until you publish it.' : 'Your organiser has not created any events yet.'}
          </p>
          {isAdmin && (
            <Link href="/dashboard/events/new" className={`${primaryButtonClass} mt-5`}>
              Create an event
            </Link>
          )}
        </div>
      ) : (
        <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
          {events.map((event) => {
            const { capacity, sold } = tierTotals(event.ticketTiers);
            const pct = capacity > 0 ? Math.min((sold / capacity) * 100, 100) : 0;
            const href = isAdmin ? `/dashboard/events/${event.id}` : `/dashboard/events/${event.id}/checkin`;
            return (
              <li key={event.id} className="bg-[#0E131F] hover:bg-[#121827] transition-colors">
                <div className="flex items-center gap-4 px-4 sm:px-5 py-4">
                  <Link href={href} className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="hidden sm:block w-20 h-12 rounded-lg overflow-hidden bg-[#131924] border border-slate-800/70 shrink-0">
                      {event.coverImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white truncate">{event.title}</span>
                        <span className={`text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded border font-medium shrink-0 ${STATUS_STYLES[event.status]}`}>
                          {event.status}
                        </span>
                      </div>
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
                  </Link>
                  <div className="hidden md:block w-44 shrink-0">
                    <div className="text-sm text-right text-slate-300 tabular-nums">
                      {sold.toLocaleString()}
                      <span className="text-slate-500"> / {capacity.toLocaleString()} sold</span>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isAdmin && (
                      <Link href={href} className={primaryButtonClass}>
                        Check in
                      </Link>
                    )}
                    {isAdmin && event._count.tickets === 0 && (
                      <button
                        onClick={() => handleDelete(event.id)}
                        disabled={deletingId === event.id}
                        className={dangerButtonClass}
                      >
                        {deletingId === event.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}