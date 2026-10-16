// pages/dashboard/events/[id]/plan.tsx
//
// Rooms & gear: the event's Event Space rooms (one comes with ticket
// sales; the rest are bought by size, by M-Pesa or card — src/lib/plans.ts)
// and renting gate scanners and scanning staff from Tixflow for the day.
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

type RoomSize = 'small' | 'medium' | 'large';

interface Rooms {
  ticketed: boolean;
  included: { owned: number; used: number };
  bought: Record<RoomSize, { owned: number; used: number }>;
  available: number;
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
  rooms: Rooms;
  roomSizes: Record<RoomSize, { label: string; capacity: number | null; price: number }>;
  cardPayments: boolean;
  rentalRates: { devicePerDay: number; staffPerDay: number };
  equipment: EquipmentRow[];
}


const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const people = (capacity: number | null) => (capacity === null ? 'No limit on people' : `Up to ${capacity.toLocaleString()} people at once`);

const EQUIPMENT_STATUS: Record<string, string> = {
  requested: 'Requested — we’ll call you to confirm',
  quoted: 'Quote sent',
  confirmed: 'Confirmed',
  declined: 'Declined',
  done: 'Done',
};

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
            setNotice('Payment received. Your room is ready: open it from Event Space.');
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

  const buy = async (size: string) => {
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/events/${id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, method: payMethod, phoneNumber: phone }),
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

  const rooms = data?.rooms;
  const rates = data?.rentalRates;
  const gearEstimate = rates
    ? ((Number(gear.devices) || 0) * rates.devicePerDay + (Number(gear.staff) || 0) * rates.staffPerDay) *
      Math.max(Number(gear.days) || 1, 1)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Rooms &amp; gear</h1>
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

      {!data || !rooms ? (
        <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading...</p>
      ) : (
        <>
          <div className={`${cardClass} space-y-5`}>
            <div>
              <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Event Space rooms</h2>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl">
                {rooms.ticketed
                  ? 'Your ticket sales include one room with no limit on people. Buy more rooms for extra halls or tracks.'
                  : 'This event has no ticket sales, so each room is bought on its own. There’s no limit on registrations or guests.'}{' '}
                A room is a live space for polls, Q&amp;A and slides; its size is how many people can be in it at once.
              </p>
            </div>

            <ul className="rounded-xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
              {rooms.included.owned > 0 && (
                <li className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm text-white">Included with ticket sales</div>
                    <div className="text-xs text-slate-500">No limit on people</div>
                  </div>
                  <span className="text-sm tabular-nums text-slate-300">{rooms.included.used > 0 ? 'In use' : 'Ready to open'}</span>
                </li>
              )}
              {(Object.keys(data.roomSizes) as RoomSize[])
                .filter((size) => rooms.bought[size].owned > 0)
                .map((size) => (
                  <li key={size} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="text-sm text-white">
                        {rooms.bought[size].owned} × {data.roomSizes[size].label} room{rooms.bought[size].owned === 1 ? '' : 's'}
                      </div>
                      <div className="text-xs text-slate-500">{people(data.roomSizes[size].capacity)}</div>
                    </div>
                    <span className="text-sm tabular-nums text-slate-300">
                      {rooms.bought[size].used} in use · {Math.max(rooms.bought[size].owned - rooms.bought[size].used, 0)} ready
                    </span>
                  </li>
                ))}
              {rooms.included.owned === 0 && (Object.values(rooms.bought) as { owned: number }[]).every((b) => b.owned === 0) && (
                <li className="px-4 py-3 text-sm text-slate-500">No rooms yet.</li>
              )}
            </ul>
            {rooms.available > 0 && id && (
              <p className="text-xs text-slate-400">
                {rooms.available} room{rooms.available === 1 ? '' : 's'} ready to open.{' '}
                <Link href={`/dashboard/events/${id}/spaces`} className="text-slate-200 underline underline-offset-2 hover:text-white">
                  Open it in Event Space
                </Link>
              </p>
            )}

            <div>
              <h3 className="text-sm font-medium text-white">Buy a room</h3>
              <div className="mt-3 grid sm:grid-cols-3 gap-3">
                {(Object.keys(data.roomSizes) as RoomSize[]).map((size) => {
                  const r = data.roomSizes[size];
                  return (
                    <div key={size} className="p-4 border border-slate-800 rounded-lg space-y-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-white">{r.label}</span>
                        <span className="tabular-nums text-sm text-white">{kes(r.price)}</span>
                      </div>
                      <p className="text-xs text-slate-400">{people(r.capacity)}</p>
                      {buying === size ? (
                        <div className="space-y-2 pt-1">
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
                          <button type="button" disabled={waiting} onClick={() => buy(size)} className={primaryButtonClass}>
                            {waiting ? 'Waiting for payment...' : `Pay ${kes(r.price)}`}
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setBuying(size)} className={buttonClass}>
                          Buy a {r.label.toLowerCase()} room
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Rooms are per event.{' '}
                {rooms.extras
                  ? 'Certificates and exhibitor lead scanning are on for this event.'
                  : 'Buying any room also turns on certificates and exhibitor lead scanning for this event.'}
              </p>
            </div>
          </div>

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
