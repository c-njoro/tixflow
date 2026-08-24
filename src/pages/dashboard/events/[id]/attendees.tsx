// pages/dashboard/events/[id]/attendees.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface Tier {
  id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  isActive: boolean;
}

interface Ticket {
  id: string;
  ticketCode: string;
  status: 'pending' | 'active' | 'scanned' | 'cancelled' | 'refunded';
  buyerName: string;
  buyerEmail: string;
  scannedAt: string | null;
  createdAt: string;
  ticketTierId: string;
  ticketTier: { name: string; price: number };
}

interface EventSummary {
  id: string;
  title: string;
  ticketTiers: Tier[];
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-800 text-slate-300 border-slate-700',
  active: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  scanned: 'bg-sky-950/40 text-sky-400 border-sky-800/50',
  cancelled: 'bg-rose-950/40 text-rose-400 border-rose-800/50',
  refunded: 'bg-amber-950/40 text-amber-400 border-amber-800/50',
};

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-slate-400';

export default function AttendeesPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');

  const [newTicket, setNewTicket] = useState({ ticketTierId: '', buyerName: '', buyerEmail: '' });
  const [issuing, setIssuing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadEvent = async () => {
    if (typeof id !== 'string') return;
    const res = await fetch(`/api/events/${id}`);
    const result = await res.json();
    if (res.ok) setEvent(result.data);
  };

  const loadTickets = async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (tierFilter) params.set('ticketTierId', tierFilter);

      const res = await fetch(`/api/events/${id}/tickets?${params.toString()}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load attendees.');
      setTickets(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, statusFilter, tierFilter]);

  const handleIssueTicket = async () => {
    if (typeof id !== 'string') return;
    if (!newTicket.ticketTierId || !newTicket.buyerName || !newTicket.buyerEmail) {
      setError('Tier, name, and email are all required to issue a ticket.');
      return;
    }
    setIssuing(true);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTicket),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to issue ticket.');

      setTickets((prev) => [result.data, ...prev]);
      setNewTicket({ ticketTierId: '', buyerName: '', buyerEmail: '' });
      loadEvent(); // refresh tier sold counts
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIssuing(false);
    }
  };

  const handleUpdateStatus = async (ticketId: string, status: string) => {
    if (typeof id !== 'string') return;
    setUpdatingId(ticketId);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update ticket.');

      setTickets((prev) => prev.map((t) => (t.id === ticketId ? result.data : t)));
      loadEvent(); // refresh tier sold counts if capacity was released
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
            Attendees
          </h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {event ? event.title : 'Loading event...'}
          </p>
        </div>
        {typeof id === 'string' && (
          <Link
            href={`/dashboard/events/${id}`}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            Back to Event
          </Link>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}

      {/* Issue a comp/manual ticket — admin only */}
      {isAdmin && (
      <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
          Issue Ticket Manually
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Tier</label>
            <div className="mt-1">
              <select
                value={newTicket.ticketTierId}
                onChange={(e) => setNewTicket({ ...newTicket, ticketTierId: e.target.value })}
                className={inputClass}
              >
                <option value="">Select tier</option>
                {event?.ticketTiers.map((tier) => (
                  <option key={tier.id} value={tier.id} disabled={tier.sold >= tier.capacity}>
                    {tier.name} ({tier.sold}/{tier.capacity})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>Buyer Name</label>
            <div className="mt-1">
              <input
                type="text"
                value={newTicket.buyerName}
                onChange={(e) => setNewTicket({ ...newTicket, buyerName: e.target.value })}
                placeholder="Jane Doe"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Buyer Email</label>
            <div className="mt-1">
              <input
                type="email"
                value={newTicket.buyerEmail}
                onChange={(e) => setNewTicket({ ...newTicket, buyerEmail: e.target.value })}
                placeholder="jane@example.com"
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleIssueTicket}
              disabled={issuing}
              className="w-full px-3 py-2 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
            >
              {issuing ? 'Issuing...' : 'Issue Ticket'}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${inputClass} w-auto`}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="scanned">Scanned</option>
          <option value="cancelled">Cancelled</option>
          <option value="refunded">Refunded</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className={`${inputClass} w-auto`}
        >
          <option value="">All tiers</option>
          {event?.ticketTiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name}
            </option>
          ))}
        </select>
      </div>

      {/* Attendee table */}
      {loading ? (
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Loading attendees...
        </div>
      ) : tickets.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-800 rounded-xl bg-[#0B0F17]/40 flex flex-col items-center justify-center text-center min-h-[160px]">
          <p className="text-xs font-mono text-slate-400 uppercase tracking-widest">
            No attendees yet
          </p>
        </div>
      ) : (
        <div className="border border-slate-800/80 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0E131F] text-left">
              <tr>
                <th className="p-3 text-xs font-mono uppercase tracking-wider text-slate-500">Buyer</th>
                <th className="p-3 text-xs font-mono uppercase tracking-wider text-slate-500">Tier</th>
                <th className="p-3 text-xs font-mono uppercase tracking-wider text-slate-500">Code</th>
                <th className="p-3 text-xs font-mono uppercase tracking-wider text-slate-500">Status</th>
                <th className="p-3 text-xs font-mono uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-t border-slate-800/80">
                  <td className="p-3">
                    <div className="text-white">{ticket.buyerName}</div>
                    <div className="text-xs text-slate-500">{ticket.buyerEmail}</div>
                  </td>
                  <td className="p-3 text-slate-300">{ticket.ticketTier.name}</td>
                  <td className="p-3 font-mono text-xs text-slate-400">
                    {ticket.ticketCode}{' '}
                    <a
                      href={`/api/tickets/qr/${ticket.ticketCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-white underline underline-offset-2 ml-1"
                    >
                      QR
                    </a>
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${STATUS_STYLES[ticket.status]}`}
                    >
                      {ticket.status}
                    </span>
                  </td>
                  <td className="p-3">
                    {isAdmin && ['pending', 'active', 'scanned'].includes(ticket.status) && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdateStatus(ticket.id, 'cancelled')}
                          disabled={updatingId === ticket.id}
                          className="text-[10px] font-mono uppercase text-rose-400 hover:text-rose-300 disabled:opacity-30"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(ticket.id, 'refunded')}
                          disabled={updatingId === ticket.id}
                          className="text-[10px] font-mono uppercase text-amber-400 hover:text-amber-300 disabled:opacity-30"
                        >
                          Refund
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}