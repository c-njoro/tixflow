// pages/dashboard/events/index.tsx
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
            Events {isAdmin ? 'Manager' : ''}
          </h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {isAdmin ? 'Create and manage your event listings' : 'Check attendees in for an event'}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/dashboard/events/new"
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 transition"
          >
            + New Event
          </Link>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Loading events...
        </div>
      ) : events.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-800 rounded-xl bg-[#0B0F17]/40 flex flex-col items-center justify-center text-center min-h-[200px]">
          <p className="text-xs font-mono text-slate-400 uppercase tracking-widest">
            No events yet
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {events.map((event) => {
            const { capacity, sold } = tierTotals(event.ticketTiers);
            return (
              <div
                key={event.id}
                className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">{event.title}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(event.date).toLocaleString()} &middot; {event.location}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border shrink-0 ${STATUS_STYLES[event.status]}`}
                  >
                    {event.status}
                  </span>
                </div>

                <div className="text-xs font-mono text-slate-400">
                  {sold} / {capacity} tickets sold across {event.ticketTiers.length} tier
                  {event.ticketTiers.length === 1 ? '' : 's'}
                </div>

                <div className="flex items-center gap-3 mt-2">
                  {isAdmin ? (
                    <Link
                      href={`/dashboard/events/${event.id}`}
                      className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition"
                    >
                      Manage
                    </Link>
                  ) : (
                    <Link
                      href={`/dashboard/events/${event.id}/checkin`}
                      className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 transition"
                    >
                      Check-In
                    </Link>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => handleDelete(event.id)}
                      disabled={deletingId === event.id || event._count.tickets > 0}
                      title={
                        event._count.tickets > 0
                          ? 'Cannot delete an event with issued tickets — cancel it instead.'
                          : undefined
                      }
                      className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rose-900/50 rounded-md text-rose-400 hover:bg-rose-950/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deletingId === event.id ? 'Deleting...' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}