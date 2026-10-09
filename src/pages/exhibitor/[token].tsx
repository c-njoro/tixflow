// pages/exhibitor/[token].tsx
//
// Exhibitor lead scanning, on a phone at the stand: scan an attendee's
// ticket QR, jot a note and a hot/warm/cold rating, export to CSV.
// Reached by the secret link the organiser gives each exhibitor.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { inputClass } from '@/lib/ui';

// Camera code only runs in the browser.
const QrCameraScanner = dynamic(() => import('@/components/QrCameraScanner'), { ssr: false });

interface Lead {
  id: string;
  name: string;
  email: string;
  notes: string | null;
  rating: number | null;
  createdAt: string;
}

interface Portal {
  exhibitor: { name: string };
  event: { title: string; date: string; location: string; organiser: string } | null;
  leads: Lead[];
}

const RATINGS = [
  { value: 3, label: 'Hot', className: 'border-rose-500 text-rose-300 bg-rose-950/40' },
  { value: 2, label: 'Warm', className: 'border-amber-500 text-amber-300 bg-amber-950/40' },
  { value: 1, label: 'Cold', className: 'border-sky-500 text-sky-300 bg-sky-950/40' },
];


export default function ExhibitorPortal() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : undefined;
  const [portal, setPortal] = useState<Portal | null>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [flash, setFlash] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [current, setCurrent] = useState<Lead | null>(null);

  const base = token ? `/api/exhibitor/${encodeURIComponent(token)}` : '';

  useEffect(() => {
    if (!base) return;
    fetch(base)
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'This link is not valid.');
        setPortal(result.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'This link is not valid.'));
  }, [base]);

  const scan = useCallback(
    async (code: string) => {
      if (!base) return;
      setFlash(null);
      try {
        const res = await fetch(`${base}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketCode: code }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Scan failed.');
        const lead = result.data;
        setFlash(lead.duplicate ? { tone: 'warn', text: `${lead.name} is already in your leads.` } : { tone: 'ok', text: `Added ${lead.name}` });
        const existing = portal?.leads.find((l) => l.id === lead.id);
        const row: Lead = existing ?? {
          id: lead.id,
          name: lead.name,
          email: lead.email,
          notes: null,
          rating: null,
          createdAt: new Date().toISOString(),
        };
        setPortal((p) => (!p || p.leads.some((l) => l.id === row.id) ? p : { ...p, leads: [row, ...p.leads] }));
        setCurrent(row);
        setScanning(false);
      } catch (err) {
        setFlash({ tone: 'error', text: err instanceof Error ? err.message : 'Scan failed.' });
      }
    },
    [base, portal]
  );

  const saveLead = async (lead: Lead, changes: Partial<Pick<Lead, 'notes' | 'rating'>>) => {
    const res = await fetch(`${base}/leads/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!res.ok) return;
    const result = await res.json();
    setPortal((p) => p && { ...p, leads: p.leads.map((l) => (l.id === lead.id ? { ...l, ...result.data } : l)) });
    setCurrent((c) => (c && c.id === lead.id ? { ...c, ...result.data } : c));
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) scan(manualCode.trim());
    setManualCode('');
  };

  const counts = portal
    ? { hot: portal.leads.filter((l) => l.rating === 3).length, total: portal.leads.length }
    : { hot: 0, total: 0 };

  return (
    <div className="min-h-screen bg-ink text-slate-100">
      <Head>
        <title>{portal ? `${portal.exhibitor.name} · Leads` : 'Lead scanning · Tixflow'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {error ? (
          <p className="text-center text-sm text-slate-400 pt-20">{error}</p>
        ) : !portal ? (
          <p className="text-center text-xs uppercase tracking-[0.08em] text-slate-500 pt-20 font-medium">Loading...</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500 truncate font-medium">{portal.event?.title}</p>
                <h1 className="text-xl font-bold">{portal.exhibitor.name}</h1>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-semibold">{counts.total}</p>
                <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">leads · {counts.hot} hot</p>
              </div>
            </div>

            {scanning ? (
              <div className="space-y-2">
                <QrCameraScanner onScan={scan} />
                <button
                  type="button"
                  onClick={() => setScanning(false)}
                  className="w-full py-2.5 rounded-lg border border-slate-700 text-sm text-slate-300"
                >
                  Close camera
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFlash(null);
                  setScanning(true);
                }}
                className="w-full py-4 rounded-xl bg-white text-black font-semibold text-base"
              >
                Scan a badge
              </button>
            )}

            <form onSubmit={submitManual} className="flex gap-2">
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="or type the ticket code (TIX-…)"
                className={inputClass}
              />
              <button type="submit" className="px-4 rounded-lg border border-slate-700 text-sm shrink-0">
                Add
              </button>
            </form>

            {flash && (
              <p
                className={`p-3 rounded-lg text-sm border ${
                  flash.tone === 'ok'
                    ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
                    : flash.tone === 'warn'
                      ? 'border-amber-800/50 bg-amber-950/30 text-amber-300'
                      : 'border-rose-800/50 bg-rose-950/30 text-rose-300'
                }`}
              >
                {flash.text}
              </p>
            )}

            {current && <LeadEditor key={current.id} lead={current} onSave={saveLead} onClose={() => setCurrent(null)} />}

            <div className="flex items-center justify-between pt-2">
              <h2 className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">Your leads</h2>
              {portal.leads.length > 0 && (
                <a href={`${base}/export`} className="text-[13px] text-sky-400 font-medium">
                  Export CSV
                </a>
              )}
            </div>
            {portal.leads.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500 border border-dashed border-slate-800 rounded-xl">
                Scan attendees&apos; ticket QR codes to collect their contact details.
              </p>
            ) : (
              <div className="space-y-2">
                {portal.leads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setCurrent(l)}
                    className="w-full text-left p-3 rounded-xl border border-slate-800 bg-panel flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{l.name}</p>
                      <p className="text-xs text-slate-500 truncate">{l.notes || l.email}</p>
                    </div>
                    {l.rating && (
                      <span className={`text-[11px] uppercase px-2 py-0.5 rounded border ${RATINGS.find((r) => r.value === l.rating)?.className} font-medium`}>
                        {RATINGS.find((r) => r.value === l.rating)?.label}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-600 text-center">
              Leads are people who chose to have their badge scanned. Use their details only to follow up about your stand.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function LeadEditor({
  lead,
  onSave,
  onClose,
}: {
  lead: Lead;
  onSave: (lead: Lead, changes: Partial<Pick<Lead, 'notes' | 'rating'>>) => Promise<void>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes ?? '');
  const [saved, setSaved] = useState(false);

  return (
    <div className="p-4 rounded-xl border border-slate-700 bg-panel space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-white">{lead.name}</p>
          <p className="text-xs text-slate-400 break-all">{lead.email}</p>
        </div>
        <button type="button" onClick={onClose} className="text-slate-500 text-sm">
          Done
        </button>
      </div>
      <div className="flex gap-2">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onSave(lead, { rating: lead.rating === r.value ? null : r.value })}
            className={`flex-1 py-2 rounded-lg border text-[13px] ${
              lead.rating === r.value ? r.className : 'border-slate-700 text-slate-400'
            } font-medium`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaved(false);
        }}
        onBlur={async () => {
          if (notes !== (lead.notes ?? '')) {
            await onSave(lead, { notes });
            setSaved(true);
          }
        }}
        rows={3}
        maxLength={1000}
        placeholder="Notes — what they're interested in, follow-up…"
        className={`${inputClass} resize-none`}
      />
      {saved && <p className="text-[11px] text-emerald-400">Saved</p>}
    </div>
  );
}
