// pages/dashboard/events/[id]/promos.tsx
//
// Promo codes: buyers type one at checkout (e.g. MUKURU) for a discount.
// A code can be for this event or all events, limited to some ticket
// types, capped, time-boxed, and tied to a promoter who then earns
// commission on its sales.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';
import { formatDateTime } from '@/lib/format';

interface PromoRow {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  eventId: string | null;
  tierIds: string[];
  maxUses: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  promoterId: string | null;
  promoterName: string | null;
  isActive: boolean;
  orders: number;
  revenue: number;
  discountGiven: number;
}

interface Tier {
  id: string;
  name: string;
  price: number;
}


const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const describe = (p: Pick<PromoRow, 'discountType' | 'discountValue'>) =>
  p.discountType === 'percent' ? `${p.discountValue}% off` : `${kes(p.discountValue)} off per ticket`;

const emptyForm = {
  code: '',
  discountType: 'fixed' as 'percent' | 'fixed',
  discountValue: '',
  allEvents: false,
  tierIds: [] as string[],
  maxUses: '',
  endsAt: '',
  promoterId: '',
};

export default function PromoCodesPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [rows, setRows] = useState<PromoRow[] | null>(null);
  const [eventTitle, setEventTitle] = useState('');
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [promoters, setPromoters] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/tenant/promos?eventId=${id}`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load.');
    setRows(result.data);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    load().catch((err) => setError(err.message));
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.data) return;
        setEventTitle(result.data.title);
        setTiers(result.data.ticketTiers);
      })
      .catch(() => {});
    fetch('/api/tenant/promoters')
      .then((res) => res.json())
      .then((result) => Array.isArray(result.data) && setPromoters(result.data.map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, [id, load]);

  const send = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/tenant/promos${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      await load();
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
    const ok = await send(`?eventId=${id}`, 'POST', {
      code: form.code,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      eventId: form.allEvents ? null : id,
      tierIds: form.allEvents ? [] : form.tierIds,
      maxUses: form.maxUses || null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      promoterId: form.promoterId || null,
    });
    if (ok) setForm(emptyForm);
  };

  const tierNames = (ids: string[]) =>
    ids.length === 0 ? 'All ticket types' : ids.map((t) => tiers.find((x) => x.id === t)?.name ?? '—').join(', ');

  // A worked example for the form, using this event's first paid tier.
  const exampleTier = tiers.find((t) => t.price > 0);
  const exampleValue = Number(form.discountValue) || 0;
  const examplePrice = exampleTier
    ? Math.max(
        exampleTier.price - (form.discountType === 'percent' ? (exampleTier.price * exampleValue) / 100 : exampleValue),
        0
      )
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Promo Codes</h1>
          <p className="text-sm text-slate-400 mt-1">{eventTitle || 'Loading event...'}</p>
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
              <h2 className="text-sm font-semibold text-white">Discounts buyers type at checkout</h2>
              <p className="text-sm text-slate-400">
                Give a code to a promoter, a community or a sponsor — e.g. <span className="font-mono text-white">MUKURU</span>{' '}
                takes KES 100 off every ticket. Tie it to a promoter and their sales and commission are tracked
                automatically, even when buyers don&apos;t use the promoter&apos;s link.
              </p>
            </div>
          ) : (
            rows.map((p) => (
              <div key={p.id} className={`${cardClass} space-y-3 ${p.isActive ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-white tracking-[0.06em]">
                      {p.code}
                      {!p.isActive && <span className="ml-2 text-[11px] uppercase text-slate-500 font-medium">Paused</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {describe(p)} · {p.eventId ? tierNames(p.tierIds) : 'All your events'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {p.maxUses ? `${p.usedCount} / ${p.maxUses} used` : `${p.usedCount} used`}
                      {p.endsAt && ` · ends ${formatDateTime(p.endsAt)}`}
                      {p.promoterName && ` · promoter: ${p.promoterName}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">{kes(p.revenue)}</p>
                    <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                      {p.orders} order{p.orders === 1 ? '' : 's'} · {kes(p.discountGiven)} off
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className={buttonClass} onClick={() => send(`/${p.id}`, 'PATCH', { isActive: !p.isActive })}>
                    {p.isActive ? 'Pause' : 'Resume'}
                  </button>
                  {p.usedCount === 0 && p.orders === 0 && (
                    <button type="button" disabled={busy} className={`${buttonClass} text-rose-400`} onClick={() => send(`/${p.id}`, 'DELETE')}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={create} className={`${cardClass} space-y-4`}>
          <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">New Code</h2>
          <div>
            <label className={labelClass}>Code</label>
            <input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
              placeholder="MUKURU"
              className={`${inputClass} mt-1 uppercase font-medium`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Discount</label>
              <select
                value={form.discountType}
                onChange={(e) => setForm({ ...form, discountType: e.target.value as 'percent' | 'fixed' })}
                className={`${inputClass} mt-1`}
              >
                <option value="fixed">KES off / ticket</option>
                <option value="percent">% off</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{form.discountType === 'percent' ? 'Percent' : 'Amount'}</label>
              <input
                required
                type="number"
                min="1"
                max={form.discountType === 'percent' ? 100 : undefined}
                step="any"
                value={form.discountValue}
                onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                placeholder={form.discountType === 'percent' ? '10' : '100'}
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>
          {exampleTier && exampleValue > 0 && (
            <p className="text-[11px] text-slate-500">
              {exampleTier.name}: {kes(exampleTier.price)} → <span className="text-emerald-400">{kes(examplePrice)}</span>
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={form.allEvents} onChange={(e) => setForm({ ...form, allEvents: e.target.checked })} />
            Valid for all my events
          </label>
          {!form.allEvents && tiers.length > 1 && (
            <div>
              <label className={labelClass}>Ticket types (none ticked = all)</label>
              <div className="mt-1 space-y-1">
                {tiers.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.tierIds.includes(t.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tierIds: e.target.checked ? [...form.tierIds, t.id] : form.tierIds.filter((x) => x !== t.id),
                        })
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Max tickets</label>
              <input
                type="number"
                min="1"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                placeholder="Unlimited"
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass}>Ends</label>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>
          {promoters.length > 0 && (
            <div>
              <label className={labelClass}>Promoter (earns commission)</label>
              <select value={form.promoterId} onChange={(e) => setForm({ ...form, promoterId: e.target.value })} className={`${inputClass} mt-1`}>
                <option value="">None</option>
                {promoters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? 'Saving...' : 'Create Code'}
          </button>
        </form>
      </div>
    </div>
  );
}
