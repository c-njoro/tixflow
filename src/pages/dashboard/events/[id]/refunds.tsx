// pages/dashboard/events/[id]/refunds.tsx
//
// Buyers' refund requests. Approve → their tickets are cancelled (seats go
// back on sale) and Tixflow sends the money to their M-Pesa from your
// balance. Reject → they see your note.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

interface RefundRow {
  id: string;
  buyerName: string;
  buyerEmail: string;
  refundPhone: string;
  amount: number;
  reason: string;
  status: string;
  organiserNote: string | null;
  createdAt: string;
  completedAt: string | null;
  tickets: { id: string; ticketCode: string; status: string; tierName: string }[];
}

const cardClass = 'p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl';
const buttonClass =
  'px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-40';
const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 transition';

const STATUS: Record<string, { label: string; style: string }> = {
  requested: { label: 'Needs your decision', style: 'bg-amber-950/40 text-amber-400 border-amber-800/50' },
  approved: { label: 'Approved — Tixflow is sending it', style: 'bg-sky-950/40 text-sky-400 border-sky-800/50' },
  processing: { label: 'Sending to buyer', style: 'bg-sky-950/40 text-sky-400 border-sky-800/50' },
  completed: { label: 'Refunded', style: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50' },
  rejected: { label: 'Rejected', style: 'bg-slate-800 text-slate-400 border-slate-700' },
  failed: { label: 'Payment failed', style: 'bg-rose-950/40 text-rose-400 border-rose-800/50' },
};

export default function RefundsPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<RefundRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/events/${id}/refunds`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load.');
    setTitle(result.data.title);
    setRows(result.data.refunds);
  }, [id]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const act = async (refundId: string, action: 'approve' | 'reject' | 'retry') => {
    setBusy(refundId);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/events/${id}/refunds/${refundId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: notes[refundId] }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      setMessage(result.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const pending = (rows || []).filter((r) => r.status === 'requested').length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">Refunds</h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {title || 'Loading event...'} · {pending} waiting
          </p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {message && <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">{message}</div>}

      {!rows ? (
        <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">Loading...</p>
      ) : rows.length === 0 ? (
        <div className={`${cardClass} text-sm text-slate-400`}>
          No refund requests. Buyers can ask for one from their ticket page (Find my tickets) before the event starts.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const s = STATUS[r.status] || { label: r.status, style: STATUS.rejected.style };
            return (
              <div key={r.id} className={`${cardClass} space-y-3`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {r.buyerName} · KES {r.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.buyerEmail} · refund to M-Pesa {r.refundPhone} · {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${s.style}`}>{s.label}</span>
                </div>
                <p className="text-sm text-slate-300">&ldquo;{r.reason}&rdquo;</p>
                <div className="text-xs text-slate-400">
                  {r.tickets.map((t) => (
                    <span key={t.id} className="inline-block mr-3">
                      {t.tierName} <span className="font-mono">{t.ticketCode}</span> ({t.status})
                    </span>
                  ))}
                </div>
                {r.organiserNote && <p className="text-xs text-slate-500">Note: {r.organiserNote}</p>}

                {(r.status === 'requested' || r.status === 'failed') && (
                  <div className="space-y-2">
                    {r.status === 'requested' && (
                      <input
                        value={notes[r.id] || ''}
                        onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                        placeholder="Note to the buyer (required to reject)"
                        className={inputClass}
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {r.status === 'requested' ? (
                        <>
                          <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'approve')} className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-white text-black rounded-md hover:bg-slate-200 transition disabled:opacity-40">
                            Approve &amp; cancel tickets
                          </button>
                          <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'reject')} className={`${buttonClass} text-rose-400`}>
                            Reject
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={busy === r.id} onClick={() => act(r.id, 'retry')} className={buttonClass}>
                          Retry payment
                        </button>
                      )}
                    </div>
                    {r.status === 'requested' && (
                      <p className="text-[11px] text-slate-500">
                        Approving cancels the tickets now and takes KES {r.amount.toLocaleString()} from your balance for the refund.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
