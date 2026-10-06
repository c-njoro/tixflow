// components/platform/GearRequests.tsx
//
// Platform admin: organisers' requests to rent gate scanners and staff.
import { useCallback, useEffect, useState } from 'react';
import { inputClass } from '@/lib/ui';
import { formatDateTime } from '@/lib/format';

interface GearRequest {
  id: string;
  businessName: string;
  event: { title: string; date: string; location: string } | null;
  devices: number;
  staff: number;
  days: number;
  contactName: string;
  contactPhone: string;
  notes: string | null;
  estimate: number;
  status: string;
  adminNote: string | null;
  createdAt: string;
}

const NEXT: Record<string, string[]> = {
  requested: ['quoted', 'confirmed', 'declined'],
  quoted: ['confirmed', 'declined'],
  confirmed: ['done', 'declined'],
  declined: [],
  done: [],
};


export default function GearRequests() {
  const [rows, setRows] = useState<GearRequest[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/platform-admin/equipment');
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load.');
    setRows(result.data);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  const update = async (id: string, status: string) => {
    setError('');
    try {
      const res = await fetch(`/api/platform-admin/equipment/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNote: notes[id], estimate: quotes[id] }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Update failed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  if (!rows) return <div className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">{error || 'Loading...'}</div>;

  return (
    <div className="space-y-3">
      {error && <div className="p-3 text-xs border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {rows.length === 0 && (
        <div className="p-6 border border-dashed border-slate-800 rounded-xl text-center text-sm text-slate-500">No gear requests yet.</div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="border border-slate-800/80 rounded-xl p-4 space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">
                {r.businessName} · {r.event?.title ?? 'Event'}
              </div>
              <div className="text-xs text-slate-500">
                {r.event && `${formatDateTime(r.event.date)} · ${r.event.location}`}
              </div>
              <div className="text-xs text-slate-300 mt-1">
                {r.devices} scanner(s) · {r.staff} staff · {r.days} day(s) · contact {r.contactName}, {r.contactPhone}
              </div>
              {r.notes && <div className="text-xs text-slate-400 mt-1">{r.notes}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg tabular-nums font-bold">KES {r.estimate.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">{r.status}</div>
            </div>
          </div>
          {r.adminNote && <div className="text-xs text-slate-500">Note: {r.adminNote}</div>}
          {NEXT[r.status]?.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  placeholder="Note for the organiser"
                  className={`${inputClass} col-span-2`}
                />
                <input
                  type="number"
                  value={quotes[r.id] ?? ''}
                  onChange={(e) => setQuotes({ ...quotes, [r.id]: e.target.value })}
                  placeholder="Final quote"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {NEXT[r.status].map((s) => (
                  <button
                    key={s}
                    onClick={() => update(r.id, s)}
                    className="px-3 py-1.5 text-[13px] border border-slate-700 rounded-md hover:bg-slate-800 transition font-medium"
                  >
                    Mark {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
