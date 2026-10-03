// pages/dashboard/events/[id]/spaces/index.tsx
//
// The event's rooms. Each room is its own Event Space with its own QR code —
// one for a single-hall event, several for parallel tracks.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface Room {
  id: string;
  title: string;
  joinCode: string;
  isOpen: boolean;
  inviteStatus: 'pending' | 'sending' | 'sent';
  activeCount: number;
  pollCount: number;
  questionCount: number;
}

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-slate-400';
const cardClass = 'p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl';
const buttonClass =
  'px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-40';
const primaryButtonClass =
  'px-4 py-2 text-xs font-mono uppercase tracking-wider bg-white text-black rounded-md hover:bg-slate-200 transition disabled:opacity-40';

const REFRESH_MS = 8000;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });

export default function EventRoomsPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [eventTitle, setEventTitle] = useState('');
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [inviteDueAt, setInviteDueAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/events/${id}/spaces`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load rooms.');
      setRooms(result.data.rooms);
      setInviteDueAt(result.data.inviteDueAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rooms.');
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id]);

  // Keeps the "here now" counts current; first load runs even in a
  // background tab.
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

  const create = async () => {
    if (!id) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, welcomeMessage }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create the room.');
      router.push(`/dashboard/events/${id}/spaces/${result.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the room.');
      setCreating(false);
    }
  };

  const hasRooms = !!rooms && rooms.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">Event Space</h1>
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

      {!rooms ? (
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">Loading rooms...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
          <div className="space-y-3 lg:col-span-3">
            {hasRooms ? (
              rooms.map((room) => (
                <Link
                  key={room.id}
                  href={`/dashboard/events/${id}/spaces/${room.id}`}
                  className={`${cardClass} flex items-center gap-4 hover:border-slate-600 transition`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">{room.title}</p>
                      <span
                        className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border shrink-0 ${
                          room.isOpen
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                            : 'bg-slate-800/60 text-slate-400 border-slate-700'
                        }`}
                      >
                        {room.isOpen ? 'Open' : 'Closed'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mt-1">
                      Code {room.joinCode} · {room.pollCount} polls · {room.questionCount} questions · invites {room.inviteStatus}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-bold text-white">{room.activeCount}</p>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">here now</p>
                  </div>
                </Link>
              ))
            ) : (
              <div className={`${cardClass} space-y-2`}>
                <h2 className="text-base font-semibold text-white">Give attendees a live space for this event</h2>
                <p className="text-sm text-slate-400">
                  People scan a QR code in the room and get, on their phones: live polls with results and word clouds,
                  Q&amp;A with upvotes, your programme and slides (following along with the presenter&apos;s page), and
                  announcements.
                </p>
                <p className="text-sm text-slate-400">
                  Running parallel tracks? Create one room per hall — each gets its own QR code and its own polls and Q&amp;A.
                </p>
              </div>
            )}
            {hasRooms && inviteDueAt && (
              <p className="text-xs text-slate-500">
                Ticket holders get one message listing every room — automatically on {formatDate(inviteDueAt)}, or when you
                press &ldquo;Send now&rdquo; inside a room.
              </p>
            )}
          </div>

          {isAdmin && (
            <div className={`${cardClass} space-y-4 lg:col-span-2`}>
              <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
                {hasRooms ? 'Add another room' : 'Create the first room'}
              </h3>
              <div>
                <label className={labelClass}>Room name</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder={hasRooms ? 'e.g. Breakout Room A' : eventTitle || 'e.g. Main Hall'}
                  className={`${inputClass} mt-1`}
                />
              </div>
              <div>
                <label className={labelClass}>Welcome message (optional)</label>
                <textarea
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Wi-Fi: Venue-Guest · Password: ..."
                  className={`${inputClass} mt-1 resize-none`}
                />
              </div>
              <button type="button" disabled={creating} onClick={create} className={primaryButtonClass}>
                {creating ? 'Creating...' : hasRooms ? 'Add room' : 'Create Event Space'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
