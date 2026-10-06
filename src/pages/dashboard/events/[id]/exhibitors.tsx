// pages/dashboard/events/[id]/exhibitors.tsx
//
// Sponsors and exhibitors who scan attendees' badges at their stand. Each
// gets a private portal link; switch one off or issue a new link any time.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

interface ExhibitorRow {
  id: string;
  name: string;
  contactEmail: string | null;
  isActive: boolean;
  portalUrl: string;
  leadCount: number;
}


export default function ExhibitorsPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [rows, setRows] = useState<ExhibitorRow[] | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const request = useCallback(
    async (path: string, method: string, body?: unknown) => {
      const res = await fetch(`/api/events/${id}/exhibitors${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      return result.data as ExhibitorRow[];
    },
    [id]
  );

  useEffect(() => {
    if (!id) return;
    request('', 'GET')
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'));
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id, request]);

  const run = async (fn: () => Promise<ExhibitorRow[]>) => {
    setBusy(true);
    setError('');
    try {
      setRows(await fn());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => request('', 'POST', { name, contactEmail: email }))) {
      setName('');
      setEmail('');
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {}
  };

  const totalLeads = (rows || []).reduce((n, r) => n + r.leadCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Exhibitors</h1>
          <p className="text-sm text-slate-400 mt-1">
            {eventTitle || 'Loading event...'} · {totalLeads} leads collected
          </p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="space-y-3 lg:col-span-2">
          {!rows ? (
            <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading...</p>
          ) : rows.length === 0 ? (
            <div className={`${cardClass} space-y-2`}>
              <h2 className="text-sm font-semibold text-white">Lead scanning for sponsors</h2>
              <p className="text-sm text-slate-400">
                Add each exhibitor and send them their portal link. At their stand they scan attendees&apos; ticket QR codes
                on any phone to collect name and email, add notes and a hot/warm/cold rating, and export everything to a
                spreadsheet. A feature sponsors pay for.
              </p>
            </div>
          ) : (
            rows.map((x) => (
              <div key={x.id} className={`${cardClass} space-y-3 ${x.isActive ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {x.name}
                      {!x.isActive && <span className="ml-2 text-[11px] uppercase text-slate-500 font-medium">Off</span>}
                    </p>
                    <p className="text-xs text-slate-500">{x.contactEmail || 'No contact email'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold text-white">{x.leadCount}</p>
                    <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">leads</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-xs text-slate-400 truncate flex-1 min-w-0">{x.portalUrl}</code>
                  <button type="button" onClick={() => copy(x.portalUrl, x.id)} className={buttonClass}>
                    {copied === x.id ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => run(() => request(`/${x.id}`, 'PATCH', { isActive: !x.isActive }))} className={buttonClass}>
                    {x.isActive ? 'Switch off' : 'Switch on'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Give ${x.name} a new link? The old one stops working immediately.`)) {
                        run(() => request(`/${x.id}`, 'POST', { action: 'new_link' }));
                      }
                    }}
                    className={buttonClass}
                  >
                    New link
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove ${x.name} and delete the ${x.leadCount} leads they collected?`)) {
                        run(() => request(`/${x.id}`, 'DELETE'));
                      }
                    }}
                    className="px-2 text-[13px] text-rose-400 hover:text-rose-300 font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={create} className={`${cardClass} space-y-4`}>
          <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Add an exhibitor</h3>
          <div>
            <label className={labelClass}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Safaricom Developer Hub" className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>Contact email (optional)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} mt-1`} />
          </div>
          <button type="submit" disabled={busy || !name.trim()} className={primaryButtonClass}>
            Add exhibitor
          </button>
          <p className="text-[11px] text-slate-500">
            Exhibitors get attendees&apos; name and email only, never phone numbers.
          </p>
        </form>
      </div>
    </div>
  );
}
