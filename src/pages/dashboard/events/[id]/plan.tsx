// pages/dashboard/events/[id]/plan.tsx
//
// What this event's plan includes (registrations, Event Space rooms,
// conference extras), upgrades by M-Pesa or card, and renting gate
// scanners and scanning staff from Tixflow for the event day.
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

interface Entitlements {
  freeEvent: boolean;
  plan: string;
  planLabel: string;
  registrations: number | null;
  rooms: number;
  roomCapacity: number | null;
  extras: boolean;
}

interface Upgrade {
  id: string;
  label: string;
  price: number;
  charge: number;
  registrations: number | null;
  rooms: number;
  roomCapacity: number | null;
  extras: boolean;
}

interface EquipmentRow {
  id: string;
  devices: number;
  staff: number;
  days: number;
  estimate: number;
  status: string;
  adminNote: string | null;
  createdAt: string;
}

interface PlanData {
  title: string;
  date: string;
  endDate: string | null;
  entitlements: Entitlements;
  usage: { registrations: number; rooms: number };
  upgrades: Upgrade[];
  cardPayments: boolean;
  rentalRates: { devicePerDay: number; staffPerDay: number };
  equipment: EquipmentRow[];
}


const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const limit = (n: number | null, unit: string) => (n === null ? `Unlimited ${unit}` : `${n.toLocaleString()} ${unit}`);

const EQUIPMENT_STATUS: Record<string, string> = {
  requested: 'Requested — we’ll call you to confirm',
  quoted: 'Quote sent',
  confirmed: 'Confirmed',
  declined: 'Declined',
  done: 'Done',
};

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min((used / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-300">
          {used.toLocaleString()} / {max === null ? '∞' : max.toLocaleString()}
        </span>
      </div>
      {max !== null && (
        <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
          <div className={`h-full ${pct >= 90 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function PlanPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [buying, setBuying] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'mpesa' | 'card'>('mpesa');
  const [phone, setPhone] = useState('');
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [gear, setGear] = useState({ devices: '2', staff: '0', days: '1', contactName: '', contactPhone: '', notes: '' });
  const [sendingGear, setSendingGear] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/events/${id}/plan`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load.');
    setData(result.data);
  }, [id]);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const poll = useCallback(
    (orderId: string, key: string) => {
      stopPolling();
      setWaiting(true);
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/checkout/mpesa/status?orderId=${orderId}&key=${encodeURIComponent(key)}`);
          const result = await res.json();
          const status = result.data?.status;
          if (status === 'completed') {
            stopPolling();
            setWaiting(false);
            setBuying(null);
            setNotice('Payment received — your plan is upgraded.');
            load().catch(() => {});
          } else if (status === 'failed' || Date.now() - started > 5 * 60_000) {
            stopPolling();
            setWaiting(false);
            setError(result.data?.failureReason || 'Payment was not completed.');
          }
        } catch {}
      }, 3000);
    },
    [load]
  );

  useEffect(() => {
    if (!id) return;
    load().catch((err) => setError(err.message));
    // Back from the card processor.
    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    const key = params.get('key');
    if (order && key) {
      window.history.replaceState(null, '', window.location.pathname);
      poll(order, key);
    }
    return stopPolling;
  }, [id, load, poll]);

  const buy = async (plan: string) => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/events/${id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, method: payMethod, phoneNumber: phone }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not start payment.');
      if (result.data.redirectUrl) {
        window.location.href = result.data.redirectUrl;
        return;
      }
      setNotice('Check your phone and enter your M-Pesa PIN.');
      poll(result.data.orderId, result.data.accessKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start payment.');
    }
  };

  const requestGear = async (e: FormEvent) => {
    e.preventDefault();
    setSendingGear(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/events/${id}/equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gear),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not send the request.');
      setNotice('Request sent — the Tixflow team will call you to confirm.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
    } finally {
      setSendingGear(false);
    }
  };

  const ent = data?.entitlements;
  const rates = data?.rentalRates;
  const gearEstimate = rates
    ? ((Number(gear.devices) || 0) * rates.devicePerDay + (Number(gear.staff) || 0) * rates.staffPerDay) *
      Math.max(Number(gear.days) || 1, 1)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Plan &amp; Gear</h1>
          <p className="text-sm text-slate-400 mt-1">{data?.title || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {notice && (
        <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">{notice}</div>
      )}

      {!data || !ent ? (
        <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading...</p>
      ) : (
        <>
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">Current plan</div>
                <div className="text-lg font-semibold text-white mt-1">{ent.planLabel}</div>
                <p className="text-xs text-slate-400 mt-1">
                  {ent.freeEvent
                    ? 'Free events are free up to these limits. Upgrade for more people, rooms and the conference extras.'
                    : `Ticketed events include everything — Tixflow earns a small fee per ticket sold. Free tickets (KES 0 ticket types and comps): ${ent.registrations === null ? 'unlimited' : `${ent.registrations.toLocaleString()} included`}.`}
                </p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Meter label={ent.freeEvent ? 'Registrations' : 'Free tickets'} used={data.usage.registrations} max={ent.registrations} />
              <Meter label="Event Space rooms" used={data.usage.rooms} max={ent.rooms} />
            </div>
            <p className="text-[11px] text-slate-500">
              {ent.roomCapacity ? `Up to ${ent.roomCapacity} people in a room at once. ` : 'No limit on people per room. '}
              Certificates &amp; exhibitor lead scanning: {ent.extras ? 'included' : 'not included'}.
            </p>
          </div>

          {data.upgrades.length > 0 && (
            <div className={`${cardClass} space-y-4`}>
              <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Upgrade</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {data.upgrades.map((u) => (
                  <div key={u.id} className="p-4 border border-slate-800 rounded-lg space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-white">{u.label}</span>
                      <span className="tabular-nums text-sm text-white">
                        {kes(u.charge)}
                        {u.charge !== u.price && <span className="text-[10px] text-slate-500 ml-1">(difference)</span>}
                      </span>
                    </div>
                    <ul className="text-xs text-slate-400 space-y-0.5">
                      <li>{limit(u.registrations, ent.freeEvent ? 'registrations' : 'free tickets')}</li>
                      <li>
                        {u.rooms} Event Space rooms{u.roomCapacity ? `, ${u.roomCapacity} people each` : ', no size limit'}
                      </li>
                      {u.extras && <li>Certificates &amp; exhibitor lead scanning</li>}
                    </ul>
                    {buying === u.id ? (
                      <div className="space-y-2 pt-2">
                        {data.cardPayments && (
                          <div className="flex gap-2">
                            {(['mpesa', 'card'] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setPayMethod(m)}
                                className={`${buttonClass} ${payMethod === m ? 'bg-slate-800 text-white' : ''}`}
                              >
                                {m === 'mpesa' ? 'M-Pesa' : 'Card'}
                              </button>
                            ))}
                          </div>
                        )}
                        {payMethod === 'mpesa' && (
                          <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="M-Pesa number, e.g. 0712345678"
                            className={inputClass}
                          />
                        )}
                        <button type="button" disabled={waiting} onClick={() => buy(u.id)} className={primaryButtonClass}>
                          {waiting ? 'Waiting for payment...' : `Pay ${kes(u.charge)}`}
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setBuying(u.id)} className={buttonClass}>
                        Choose {u.label}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <form onSubmit={requestGear} className={`${cardClass} space-y-4 lg:col-span-2`}>
              <div>
                <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Rent gate scanners &amp; staff</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Handheld scanners (Sunmi V2s) with a built-in barcode reader and receipt printer — they scan tickets
                  instantly, work offline, and print tickets at the box office. Add trained Tixflow staff to run the
                  gate for you.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Scanners</label>
                  <input type="number" min="0" max="50" value={gear.devices} onChange={(e) => setGear({ ...gear, devices: e.target.value })} className={`${inputClass} mt-1`} />
                  <p className="text-[10px] text-slate-500 mt-1">{kes(data.rentalRates.devicePerDay)} / day</p>
                </div>
                <div>
                  <label className={labelClass}>Staff</label>
                  <input type="number" min="0" max="50" value={gear.staff} onChange={(e) => setGear({ ...gear, staff: e.target.value })} className={`${inputClass} mt-1`} />
                  <p className="text-[10px] text-slate-500 mt-1">{kes(data.rentalRates.staffPerDay)} / day</p>
                </div>
                <div>
                  <label className={labelClass}>Days</label>
                  <input type="number" min="1" max="14" value={gear.days} onChange={(e) => setGear({ ...gear, days: e.target.value })} className={`${inputClass} mt-1`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Contact name</label>
                  <input required value={gear.contactName} onChange={(e) => setGear({ ...gear, contactName: e.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Contact phone</label>
                  <input required type="tel" value={gear.contactPhone} onChange={(e) => setGear({ ...gear, contactPhone: e.target.value })} placeholder="0712345678" className={`${inputClass} mt-1`} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Notes (gates, expected crowd, timings)</label>
                <textarea rows={2} value={gear.notes} onChange={(e) => setGear({ ...gear, notes: e.target.value })} className={`${inputClass} mt-1`} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-white">
                  Estimate: <span className="tabular-nums">{kes(gearEstimate)}</span>
                  <span className="text-[11px] text-slate-500 ml-2">final quote confirmed by phone</span>
                </span>
                <button type="submit" disabled={sendingGear} className={primaryButtonClass}>
                  {sendingGear ? 'Sending...' : 'Request'}
                </button>
              </div>
            </form>

            <div className={`${cardClass} space-y-3`}>
              <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Your requests</h2>
              {data.equipment.length === 0 ? (
                <p className="text-xs text-slate-500">None yet.</p>
              ) : (
                data.equipment.map((r) => (
                  <div key={r.id} className="p-3 border border-slate-800 rounded-lg space-y-1">
                    <div className="text-sm text-white">
                      {r.devices} scanner{r.devices === 1 ? '' : 's'} · {r.staff} staff · {r.days} day{r.days === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-slate-400">{kes(r.estimate)} · {EQUIPMENT_STATUS[r.status] || r.status}</div>
                    {r.adminNote && <div className="text-[11px] text-slate-500">{r.adminNote}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
