// pages/dashboard/events/[id]/box-office.tsx
//
// Selling at the gate, at the door price. Cash or M-Pesa; the buyer can be
// admitted straight away. Tickets go to their phone (SMS / WhatsApp) or
// email, and can be printed — on a Sunmi V2s the built-in 58mm printer
// shows up as a normal printer in Chrome's print dialog.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import QRCode from 'qrcode';
import { buttonClass, cardClass, inputClass, labelClass } from '@/lib/ui';

interface Tier {
  id: string;
  name: string;
  tierColor: string;
  price: number;
  fee: number;
  onlinePrice: number;
  available: number;
}

interface Takings {
  seller: string;
  mine: boolean;
  method: string;
  orders: number;
  total: number;
}

interface BoxOfficeData {
  title: string;
  date: string;
  location: string;
  status: string;
  passFeeToBuyer: boolean;
  tiers: Tier[];
  takings: Takings[];
}

interface Sold {
  ticketCode: string;
  tierName: string;
  qr: string;
}


const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

// Only the receipt-sized tickets print; the page around them doesn't.
const PRINT_CSS = `
@media print {
  @page { size: 58mm auto; margin: 0; }
  body * { visibility: hidden !important; }
  #print-area, #print-area * { visibility: visible !important; }
  #print-area { position: absolute; left: 0; top: 0; width: 58mm; background: #fff; color: #000; }
  .print-ticket { page-break-after: always; padding: 3mm; font-family: sans-serif; text-align: center; }
}
`;

export default function BoxOfficePage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [data, setData] = useState<BoxOfficeData | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [whatsappToo, setWhatsappToo] = useState(true);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [admitNow, setAdmitNow] = useState(true);
  const [stage, setStage] = useState<'idle' | 'selling' | 'waiting' | 'done'>('idle');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sold, setSold] = useState<{ tickets: Sold[]; buyer: string; total: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/events/${id}/box-office`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load.');
    setData(result.data);
  }, [id]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const tiers = data?.tiers ?? [];
  const count = tiers.reduce((n, t) => n + (quantities[t.id] || 0), 0);
  const total = tiers.reduce(
    (sum, t) => sum + (quantities[t.id] || 0) * (t.price + (data?.passFeeToBuyer ? t.fee : 0)),
    0
  );

  const reset = () => {
    setQuantities({});
    setBuyerName('');
    setBuyerPhone('');
    setBuyerEmail('');
    setSold(null);
    setStage('idle');
    setNote('');
    setError('');
  };

  // Issued: render QR codes for printing, and admit at the gate if asked.
  const finish = async (tickets: { ticketCode: string; tierName: string }[], buyer: string, paid: number) => {
    const withQr = await Promise.all(
      tickets.map(async (t) => ({ ...t, qr: await QRCode.toDataURL(t.ticketCode, { margin: 1, width: 320 }) }))
    );
    setSold({ tickets: withQr, buyer, total: paid });
    setStage('done');
    if (admitNow) {
      const results = await Promise.all(
        tickets.map((t) =>
          fetch('/api/tickets/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketCode: t.ticketCode, eventId: id, direction: 'in' }),
          }).then((r) => r.ok)
        )
      );
      setNote(results.every(Boolean) ? 'Admitted — they can go in.' : 'Sold, but admitting failed — scan the ticket at the gate.');
    }
    load().catch(() => {});
  };

  const sell = async () => {
    if (!id || count === 0) return;
    setError('');
    setNote('');
    setStage('selling');
    try {
      const res = await fetch(`/api/events/${id}/box-office`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          buyerName,
          buyerPhone: buyerPhone || undefined,
          buyerWhatsapp: whatsappToo && buyerPhone ? buyerPhone : undefined,
          buyerEmail: buyerEmail || undefined,
          items: tiers.filter((t) => quantities[t.id]).map((t) => ({ ticketTierId: t.id, quantity: quantities[t.id] })),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Sale failed.');
      const buyer = buyerName || 'Walk-in';
      if (result.data.tickets) {
        if (result.data.warning) setError(result.data.warning);
        await finish(result.data.tickets, buyer, result.data.total);
        return;
      }
      // M-Pesa: wait for the buyer's PIN.
      setStage('waiting');
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(
            `/api/checkout/mpesa/status?orderId=${result.data.orderId}&key=${encodeURIComponent(result.data.accessKey)}`
          );
          const s = await r.json();
          if (s.data?.status === 'completed') {
            clearInterval(pollRef.current!);
            const names = new Map(tiers.map((t) => [t.id, t.name]));
            await finish(
              (s.data.tickets as { ticketCode: string; ticketTierId: string }[]).map((t) => ({
                ticketCode: t.ticketCode,
                tierName: names.get(t.ticketTierId) ?? 'Ticket',
              })),
              buyer,
              result.data.total
            );
          } else if (s.data?.status === 'failed' || Date.now() - started > 2 * 60_000) {
            clearInterval(pollRef.current!);
            setError(s.data?.failureReason || 'Payment not completed. Try again or take cash.');
            setStage('idle');
          }
        } catch {}
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sale failed.');
      setStage('idle');
    }
  };

  const myCash = (data?.takings ?? []).filter((t) => t.mine && t.method === 'cash').reduce((n, t) => n + t.total, 0);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Box Office</h1>
          <p className="text-sm text-slate-400 mt-1">
            {data?.title || 'Loading event...'} · your cash: {kes(myCash)}
          </p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}

      {stage === 'done' && sold ? (
        <div className={`${cardClass} space-y-4 text-center`}>
          <div className="text-2xl font-bold text-emerald-400">Sold — {kes(sold.total)}</div>
          {note && <p className="text-sm text-slate-300">{note}</p>}
          <p className="text-xs text-slate-500">
            {buyerPhone || buyerEmail ? 'Tickets are on their way to the buyer’s phone / email.' : 'No phone or email given — print the ticket.'}
          </p>
          <div id="print-area" className="flex flex-wrap justify-center gap-4">
            {sold.tickets.map((t) => (
              <div key={t.ticketCode} className="print-ticket bg-white text-black rounded-lg p-3 w-[220px]">
                <div className="text-sm font-bold leading-tight">{data?.title}</div>
                <div className="text-[10px]">
                  {data && new Date(data.date).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.qr} alt={t.ticketCode} className="w-full my-2" />
                <div className="text-xs font-semibold">{t.tierName}</div>
                <div className="text-[10px]">{sold.buyer}</div>
                <div className="text-[10px] font-mono">{t.ticketCode}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-2">
            <button type="button" onClick={() => window.print()} className={buttonClass}>
              Print
            </button>
            <button type="button" onClick={reset} className="px-4 py-2 text-[13px] bg-white text-black rounded-md hover:bg-slate-200 transition font-medium">
              Next sale
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={`${cardClass} space-y-3`}>
            <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Tickets at the door</h2>
            {tiers.length === 0 && <p className="text-sm text-slate-500">No ticket types on sale.</p>}
            {tiers.map((t) => {
              const q = quantities[t.id] || 0;
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 p-3 border border-slate-800 rounded-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.tierColor }} />
                    <div className="min-w-0">
                      <div className="text-sm text-white">{t.name}</div>
                      <div className="text-xs text-slate-500">
                        {kes(t.price)}
                        {t.price !== t.onlinePrice && <span> · online {kes(t.onlinePrice)}</span>} · {t.available} left
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" className={`${buttonClass} w-10 text-lg`} disabled={q === 0} onClick={() => setQuantities({ ...quantities, [t.id]: q - 1 })}>
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums text-white">{q}</span>
                    <button type="button" className={`${buttonClass} w-10 text-lg`} disabled={q >= t.available} onClick={() => setQuantities({ ...quantities, [t.id]: q + 1 })}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`${cardClass} space-y-4`}>
            <div className="grid grid-cols-2 gap-2">
              {(['cash', 'mpesa'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`py-3 rounded-lg border text-sm transition ${
                    method === m ? 'bg-slate-800 border-slate-500 text-white' : 'border-slate-800 text-slate-500'
                  } font-medium`}
                >
                  {m === 'cash' ? 'Cash' : 'M-Pesa'}
                </button>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Name (optional)</label>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Walk-in" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label className={labelClass}>Phone {method === 'mpesa' ? '(M-Pesa)' : '(for SMS ticket)'}</label>
                <input type="tel" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} placeholder="0712345678" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label className={labelClass}>Email (optional)</label>
                <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className={`${inputClass} mt-1`} />
              </div>
              <div className="space-y-2 pt-5">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={whatsappToo} onChange={(e) => setWhatsappToo(e.target.checked)} />
                  Also send on WhatsApp
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={admitNow} onChange={(e) => setAdmitNow(e.target.checked)} />
                  Admit now (they&apos;re at the gate)
                </label>
              </div>
            </div>
            <button
              type="button"
              disabled={count === 0 || stage !== 'idle' || (method === 'mpesa' && !buyerPhone)}
              onClick={sell}
              className="w-full py-4 rounded-xl text-base font-semibold bg-white text-black hover:bg-slate-200 transition disabled:opacity-40"
            >
              {stage === 'selling'
                ? 'Processing...'
                : stage === 'waiting'
                  ? 'Waiting for M-Pesa PIN...'
                  : count === 0
                    ? 'Pick tickets'
                    : method === 'cash'
                      ? `Collect ${kes(total)} cash · issue ${count}`
                      : `Send M-Pesa prompt · ${kes(total)}`}
            </button>
            {data?.passFeeToBuyer && count > 0 && <p className="text-[11px] text-slate-500 text-center">Includes the booking fee.</p>}
          </div>

          {data && data.takings.length > 0 && (
            <div className={`${cardClass} space-y-2`}>
              <h2 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Box office takings</h2>
              {data.takings.map((t, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-300">
                    {t.seller} · {t.method === 'cash' ? 'Cash' : t.method === 'mpesa' ? 'M-Pesa' : t.method}
                  </span>
                  <span className="tabular-nums text-white">
                    {kes(t.total)} <span className="text-slate-500 text-xs">({t.orders})</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
