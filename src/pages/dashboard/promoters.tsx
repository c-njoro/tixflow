// pages/dashboard/promoters.tsx
//
// Promoters sell through a tracked link and earn commission on each sale.
// Paying them goes through the same safeguards as the tenant's own payouts:
// an emailed code, then platform-admin approval, then M-Pesa.
import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

interface PromoterRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  code: string;
  commissionType: 'percent' | 'fixed';
  commissionValue: number;
  eventId: string | null;
  isActive: boolean;
  eventTitle: string | null;
  link: string;
  statsUrl: string;
  stats: { tickets: number; sales: number; earned: number; paid: number; owed: number };
}

interface EventOption {
  id: string;
  title: string;
}


const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

const EMPTY_FORM = { name: '', phone: '', email: '', code: '', commissionType: 'percent', commissionValue: '10', eventId: '' };

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || 'Something went wrong.');
  return result.data;
}

export default function PromotersPage() {
  const { user } = useAuth();
  const [promoters, setPromoters] = useState<PromoterRow[] | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState<PromoterRow | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api('/api/tenant/promoters', 'GET')
      .then(setPromoters)
      .catch((err) => setError(errorMessage(err)));
    fetch('/api/events')
      .then((res) => res.json())
      .then((result) => {
        const list = (result.data || []) as (EventOption & { status: string })[];
        setEvents(list.filter((e) => e.status === 'published'));
      })
      .catch(() => {});
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      setPromoters(
        await api('/api/tenant/promoters', 'POST', {
          ...form,
          commissionValue: Number(form.commissionValue),
          eventId: form.eventId || null,
        })
      );
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const update = async (promoter: PromoterRow, changes: Record<string, unknown>) => {
    setError('');
    try {
      setPromoters(await api(`/api/tenant/promoters/${promoter.id}`, 'PATCH', changes));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (promoter: PromoterRow) => {
    if (!confirm(`Remove ${promoter.name}?`)) return;
    setError('');
    try {
      setPromoters(await api(`/api/tenant/promoters/${promoter.id}`, 'DELETE'));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {}
  };

  if (user && user.role !== 'admin') {
    return <p className="text-sm text-slate-400">Only admins can manage promoters.</p>;
  }

  const totals = (promoters || []).reduce(
    (acc, p) => ({ tickets: acc.tickets + p.stats.tickets, sales: acc.sales + p.stats.sales, owed: acc.owed + p.stats.owed }),
    { tickets: 0, sales: 0, owed: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Promoters</h1>
        <p className="text-sm text-slate-400 mt-1">
          Tracked links · commission paid to M-Pesa
        </p>
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cardClass}>
          <p className={labelClass}>Tickets via promoters</p>
          <p className="text-2xl font-semibold text-white mt-2">{totals.tickets.toLocaleString()}</p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Sales via promoters</p>
          <p className="text-2xl font-semibold text-white mt-2">{kes(totals.sales)}</p>
        </div>
        <div className={cardClass}>
          <p className={labelClass}>Commission owed</p>
          <p className="text-2xl font-semibold text-white mt-2">{kes(totals.owed)}</p>
          <p className="text-xs text-slate-500 mt-1">Held back from your own withdrawals until paid.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="space-y-3 xl:col-span-2">
          {!promoters ? (
            <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading promoters...</p>
          ) : promoters.length === 0 ? (
            <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center">
              <p className="text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">No promoters yet</p>
              <p className="text-sm text-slate-400 mt-2">
                Add the people who sell your tickets. Each gets a link; every sale through it is credited to them.
              </p>
            </div>
          ) : (
            promoters.map((p) => {
              const link = p.link;
              return (
                <div key={p.id} className={`${cardClass} space-y-4 ${p.isActive ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {p.name}
                        {!p.isActive && <span className="ml-2 text-[11px] uppercase text-slate-500 font-medium">Inactive</span>}
                      </p>
                      <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 mt-1 font-medium">
                        {p.commissionType === 'percent' ? `${p.commissionValue}% of sales` : `${kes(p.commissionValue)} per ticket`} ·{' '}
                        {p.eventTitle ?? 'All events'} · {p.phone}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={p.stats.owed <= 0}
                        onClick={() => setPaying(p)}
                        className={primaryButtonClass}
                      >
                        Pay {p.stats.owed > 0 ? kes(p.stats.owed) : ''}
                      </button>
                      <button type="button" onClick={() => update(p, { isActive: !p.isActive })} className={buttonClass}>
                        {p.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      {p.stats.tickets === 0 && p.stats.paid === 0 && (
                        <button
                          type="button"
                          onClick={() => remove(p)}
                          className="px-2 text-[13px] text-rose-400 hover:text-rose-300 font-medium"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <Stat label="Tickets" value={p.stats.tickets.toLocaleString()} />
                    <Stat label="Sales" value={kes(p.stats.sales)} />
                    <Stat label="Earned" value={kes(p.stats.earned)} />
                    <Stat label="Paid" value={kes(p.stats.paid)} />
                  </div>

                  <div className="space-y-2">
                    <CopyRow label="Selling link" value={link} copied={copied === `link-${p.id}`} onCopy={() => copy(link, `link-${p.id}`)} />
                    <CopyRow
                      label="Their stats page"
                      value={p.statsUrl}
                      copied={copied === `stats-${p.id}`}
                      onCopy={() => copy(p.statsUrl, `stats-${p.id}`)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={create} className={`${cardClass} space-y-4`}>
          <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Add a promoter</h3>
          <div>
            <label className={labelClass}>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputClass} mt-1`} placeholder="Wanjiku Kamau" />
          </div>
          <div>
            <label className={labelClass}>M-Pesa number (commission is paid here)</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`${inputClass} mt-1`} placeholder="0712345678" />
          </div>
          <div>
            <label className={labelClass}>Email (optional)</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>Link code</label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              maxLength={30}
              className={`${inputClass} mt-1`}
              placeholder="wanjiku"
            />
            <p className="text-[11px] text-slate-500 mt-1">Their links end in ?ref={form.code || 'wanjiku'}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Commission</label>
              <select
                value={form.commissionType}
                onChange={(e) => setForm({ ...form, commissionType: e.target.value })}
                className={`${inputClass} mt-1`}
              >
                <option value="percent">% of sale</option>
                <option value="fixed">KES per ticket</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{form.commissionType === 'percent' ? 'Percent' : 'KES'}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.commissionValue}
                onChange={(e) => setForm({ ...form, commissionValue: e.target.value })}
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Sells for</label>
            <select value={form.eventId} onChange={(e) => setForm({ ...form, eventId: e.target.value })} className={`${inputClass} mt-1`}>
              <option value="">All my events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={saving || !form.name || !form.phone || !form.code} className={primaryButtonClass}>
            {saving ? 'Adding...' : 'Add promoter'}
          </button>
        </form>
      </div>

      {paying && (
        <PayDialog
          promoter={paying}
          onClose={() => setPaying(null)}
          onDone={(rows) => {
            setPromoters(rows);
            setPaying(null);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">{label}</p>
      <p className="text-white mt-0.5">{value}</p>
    </div>
  );
}

function CopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] uppercase tracking-[0.06em] text-slate-500 w-28 shrink-0 font-medium">{label}</span>
      <code className="text-xs text-slate-400 truncate flex-1 min-w-0">{value || '…'}</code>
      <button type="button" onClick={onCopy} disabled={!value} className={buttonClass}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function PayDialog({
  promoter,
  onClose,
  onDone,
}: {
  promoter: PromoterRow;
  onClose: () => void;
  onDone: (rows: PromoterRow[]) => void;
}) {
  const [amount, setAmount] = useState(String(promoter.stats.owed));
  const [challenge, setChallenge] = useState<{ challengeId: string; maskedEmail: string; feeAmount: number; amount: number } | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const requestCode = async () => {
    setBusy(true);
    setError('');
    try {
      setChallenge(await api(`/api/tenant/promoters/${promoter.id}/payout-otp`, 'POST', { amount: Number(amount) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    if (!challenge) return;
    setBusy(true);
    setError('');
    try {
      const rows = await api(`/api/tenant/promoters/${promoter.id}/payout-confirm`, 'POST', {
        challengeId: challenge.challengeId,
        otp,
      });
      setDone(true);
      setTimeout(() => onDone(rows), 1800);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#000]/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`${cardClass} w-full max-w-md space-y-4`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white">Pay {promoter.name}</h3>
        {done ? (
          <p className="text-sm text-emerald-400">
            Request filed. Once the platform admin approves it, {kes(Number(amount))} is sent to {promoter.phone}.
          </p>
        ) : !challenge ? (
          <>
            <p className="text-sm text-slate-400">
              Owed: {kes(promoter.stats.owed)}. Sent to M-Pesa {promoter.phone} after platform approval.
            </p>
            <div>
              <label className={labelClass}>Amount (KES)</label>
              <input type="number" min="1" step="0.01" max={promoter.stats.owed} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} mt-1`} />
            </div>
            {error && <p className="text-xs text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={buttonClass}>
                Cancel
              </button>
              <button type="button" disabled={busy || !(Number(amount) > 0)} onClick={requestCode} className={primaryButtonClass}>
                {busy ? 'Sending code...' : 'Email me a code'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400">
              We emailed a code to {challenge.maskedEmail}. {promoter.name} receives {kes(Number(amount))}; with the{' '}
              {kes(challenge.feeAmount)} platform fee, {kes(challenge.amount)} comes out of your balance.
            </p>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="6-digit code"
              className={`${inputClass} text-center tracking-[0.4em] text-lg`}
            />
            {error && <p className="text-xs text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={buttonClass}>
                Cancel
              </button>
              <button type="button" disabled={busy || otp.length !== 6} onClick={confirmCode} className={primaryButtonClass}>
                {busy ? 'Confirming...' : 'Confirm payout'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
