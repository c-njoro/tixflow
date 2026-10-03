// pages/plan/[planId].tsx
//
// A buyer's Lipa Pole Pole plan: progress, payment history, a top-up form
// (M-Pesa STK push), and the tickets once it's paid off. Reached by the
// secret link sent at deposit time.
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { CheckCircleIcon, ClockIcon } from '@heroicons/react/24/outline';

interface Plan {
  status: 'active' | 'completed' | 'expired' | 'cancelled';
  buyerName: string;
  buyerPhone: string;
  totalAmount: number;
  paidAmount: number;
  remaining: number;
  minPayment: number;
  dueAt: string;
  event: { title: string; date: string; location: string; organiser: string } | null;
  items: { name: string; quantity: number }[];
  payments: { amount: number; at: string; receipt: string | null }[];
  tickets: { ticketCode: string; tierName: string }[];
}

const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });

const cardClass = 'p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl';
const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 transition';

export default function PlanPage() {
  const router = useRouter();
  const planId = typeof router.query.planId === 'string' ? router.query.planId : undefined;
  const key = typeof router.query.key === 'string' ? router.query.key : undefined;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<'idle' | 'submitting' | 'awaiting_pin'>('idle');
  const [payError, setPayError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!planId || !key) return;
    try {
      const res = await fetch(`/api/installments/${planId}?key=${encodeURIComponent(key)}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Plan not found.');
      setPlan(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan not found.');
    }
  }, [planId, key]);

  useEffect(() => {
    if (!planId || !key) return;
    fetch(`/api/installments/${planId}?key=${encodeURIComponent(key)}`)
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Plan not found.');
        setPlan(result.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Plan not found.'));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [planId, key]);

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    if (!plan || !planId) return;
    setPayError('');
    setStage('submitting');
    try {
      const res = await fetch(`/api/installments/${planId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, amount: Number(amount || plan.remaining), phoneNumber: phone || undefined }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not start the payment.');
      setStage('awaiting_pin');

      const started = Date.now();
      pollRef.current = setInterval(async () => {
        const statusRes = await fetch(
          `/api/checkout/mpesa/status?orderId=${result.data.orderId}&key=${encodeURIComponent(result.data.accessKey)}`
        ).catch(() => null);
        const status = statusRes && statusRes.ok ? (await statusRes.json()).data : null;
        const done = status && status.status !== 'pending';
        if (done || Date.now() - started > 120_000) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (status?.status === 'failed') setPayError(status.failureReason || 'The payment was not completed.');
          else if (!done) setPayError('Still waiting on M-Pesa — check your messages; this page updates once it arrives.');
          setStage('idle');
          setAmount('');
          load();
        }
      }, 3000);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Could not start the payment.');
      setStage('idle');
    }
  };

  const pct = plan ? Math.min(Math.round((plan.paidAmount / plan.totalAmount) * 100), 100) : 0;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100">
      <Head>
        <title>{plan?.event ? `${plan.event.title} · Payment plan` : 'Payment plan · Tixflow'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="max-w-lg mx-auto px-4 py-10 space-y-5">
        {error ? (
          <p className="text-center text-sm text-slate-400 pt-20">{error}</p>
        ) : !plan ? (
          <p className="text-center text-xs font-mono uppercase tracking-widest text-slate-500 pt-20">Loading...</p>
        ) : (
          <>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                Lipa Pole Pole · {plan.event?.organiser}
              </p>
              <h1 className="text-2xl font-bold mt-1">{plan.event?.title}</h1>
              {plan.event && (
                <p className="text-sm text-slate-400 mt-1">
                  {when(plan.event.date)} · {plan.event.location}
                </p>
              )}
              <p className="text-sm text-slate-300 mt-2">{plan.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</p>
            </div>

            <div className={`${cardClass} space-y-3`}>
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-semibold">{kes(plan.paidAmount)}</span>
                <span className="text-sm text-slate-400">of {kes(plan.totalAmount)}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden" style={{ background: '#0c2a40' }}>
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: '#0284c7' }} />
              </div>
              {plan.status === 'active' && (
                <p className="text-sm text-slate-400">
                  {kes(plan.remaining)} left · pay by <span className="text-white">{when(plan.dueAt)}</span>
                </p>
              )}
            </div>

            {plan.status === 'completed' && (
              <div className="p-5 rounded-xl border border-emerald-800/40 bg-emerald-950/20 space-y-4">
                <p className="flex items-center gap-2 text-emerald-300 font-semibold">
                  <CheckCircleIcon className="w-5 h-5" /> Fully paid — here {plan.tickets.length === 1 ? 'is your ticket' : 'are your tickets'}
                </p>
                {plan.tickets.map((t) => (
                  <div key={t.ticketCode} className="flex items-center gap-4 bg-[#0B0F17] border border-slate-800/60 rounded-xl p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/tickets/qr/${t.ticketCode}`} alt={`QR code for ${t.ticketCode}`} className="w-20 h-20 rounded-lg bg-white p-1.5" />
                    <div>
                      <p className="text-sm text-white">{t.tierName}</p>
                      <p className="font-mono text-xs text-slate-400">{t.ticketCode}</p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-500">We&apos;ve also emailed them to you.</p>
              </div>
            )}

            {(plan.status === 'expired' || plan.status === 'cancelled') && (
              <div className="p-4 rounded-xl border border-amber-800/40 bg-amber-950/20 text-sm text-amber-200">
                This plan {plan.status === 'expired' ? 'passed its deadline' : 'was cancelled by the organiser'} and the seats
                were released. Contact {plan.event?.organiser} about the {kes(plan.paidAmount)}{' '}you&apos;ve paid.
              </div>
            )}

            {plan.status === 'active' &&
              (stage === 'awaiting_pin' ? (
                <div className="p-6 rounded-xl border border-sky-800/40 bg-sky-950/20 text-center space-y-2">
                  <ClockIcon className="w-8 h-8 text-sky-400 mx-auto animate-pulse" />
                  <p className="text-sky-300 font-semibold">Check your phone</p>
                  <p className="text-sm text-slate-400">Enter your M-Pesa PIN to complete the payment.</p>
                </div>
              ) : (
                <form onSubmit={pay} className={`${cardClass} space-y-3`}>
                  <h2 className="text-sm font-semibold">Pay the next instalment</h2>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Amount (KES)</label>
                    <input
                      type="number"
                      min={plan.minPayment}
                      max={Math.ceil(plan.remaining)}
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={String(Math.ceil(plan.remaining))}
                      className={`${inputClass} mt-1`}
                    />
                    <div className="flex gap-2 mt-2">
                      {[0.25, 0.5, 1].map((share) => {
                        const value = Math.max(Math.ceil(plan.remaining * share), Math.ceil(plan.minPayment));
                        return (
                          <button
                            key={share}
                            type="button"
                            onClick={() => setAmount(String(Math.min(value, Math.ceil(plan.remaining))))}
                            className="px-3 py-1 rounded-full border border-slate-700 text-xs text-slate-300 hover:text-white"
                          >
                            {share === 1 ? 'Pay it all' : kes(Math.min(value, Math.ceil(plan.remaining)))}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">M-Pesa number</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={plan.buyerPhone}
                      className={`${inputClass} mt-1`}
                    />
                  </div>
                  {payError && <p className="text-xs text-rose-400">{payError}</p>}
                  <button
                    type="submit"
                    disabled={stage === 'submitting'}
                    className="w-full py-3 rounded-xl text-sm font-medium bg-white text-black hover:bg-slate-200 transition disabled:opacity-50"
                  >
                    {stage === 'submitting' ? 'Sending prompt...' : `Pay ${kes(Number(amount) || Math.ceil(plan.remaining))}`}
                  </button>
                </form>
              ))}

            {plan.payments.length > 0 && (
              <div className={`${cardClass} space-y-2`}>
                <h2 className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Payments</h2>
                <table className="w-full text-sm">
                  <tbody>
                    {plan.payments.map((p, i) => (
                      <tr key={i} className="border-t border-slate-800/80 first:border-0">
                        <td className="py-2 text-slate-400">{when(p.at)}</td>
                        <td className="py-2 font-mono text-xs text-slate-500">{p.receipt ?? ''}</td>
                        <td className="py-2 text-right text-white">{kes(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-600 text-center">Keep this link — it&apos;s how you pay and get your tickets.</p>
          </>
        )}
      </main>
    </div>
  );
}
