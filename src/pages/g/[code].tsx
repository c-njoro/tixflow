// pages/g/[code].tsx
//
// A group booking's share link (src/lib/groups.ts). Shows who's paid and
// how many seats are left, and lets each friend pay for their own ticket
// by M-Pesa.
import { FormEvent, useEffect, useState } from 'react';
import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { CheckCircleIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { SiteHeader } from '@/components/site/SiteChrome';
import TicketCard from '@/components/TicketCard';
import { groupUrl, publicGroup } from '@/lib/groups';
import { useMpesaCheckout } from '@/lib/useMpesaCheckout';
import { inputClass, labelClass } from '@/lib/ui';

type Group = NonNullable<Awaited<ReturnType<typeof publicGroup>>>;

const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const when = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', ...opts });

export default function GroupPage({ group: initial, link }: { group: Group; link: string }) {
  const [group, setGroup] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [phone, setPhone] = useState('');
  const [seats, setSeats] = useState(1);
  const [copied, setCopied] = useState(false);
  const checkout = useMpesaCheckout();

  const refresh = () =>
    fetch(`/api/public/groups/${group.code}`)
      .then((r) => r.json())
      .then((r) => r.data && setGroup(r.data))
      .catch(() => {});

  // Watch the group fill up.
  useEffect(() => {
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const left = group.size - group.paidSeats;
  const taking = group.status === 'open' || group.status === 'pending';
  const pct = Math.round((group.paidSeats / group.size) * 100);
  const shareText = `Join our group for ${group.event.title}: each of us pays for our own ${group.tier.name} ticket (${kes(group.tier.price)}) by M-Pesa.`;
  // What the selected seats really cost (booking fee included).
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/checkout/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: group.event.id, items: [{ ticketTierId: group.tier.id, quantity: seats }] }),
    })
      .then((r) => r.json())
      .then((r) => !cancelled && typeof r.data?.total === 'number' && setTotal(r.data.total))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [group.event.id, group.tier.id, seats]);

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    const paid = await checkout.pay({
      eventId: group.event.id,
      buyerName: name,
      buyerEmail: email,
      buyerWhatsapp: whatsapp.trim() || undefined,
      phoneNumber: phone,
      group: group.code,
      items: [{ ticketTierId: group.tier.id, quantity: seats }],
    });
    if (paid) refresh();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-ink text-white">
      <Head>
        <title>{`${group.starter}'s group · ${group.event.title} · Tixflow`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <SiteHeader cta="buyer" />

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">
            <UserGroupIcon className="w-4 h-4" /> Group booking
          </p>
          <h1 className="mt-3 font-display text-3xl sm:text-4xl font-semibold leading-tight">
            {group.starter}&apos;s group for {group.event.title}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {when(group.event.date, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ·{' '}
            {group.event.location} · by {group.event.organiser}
          </p>
        </div>

        <section className="p-5 sm:p-6 bg-panel border border-slate-800/70 rounded-2xl space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-sm text-slate-400">
                {group.tier.name} · {kes(group.tier.price)} each
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {group.paidSeats} of {group.size} paid
              </div>
            </div>
            {taking && (
              <div className="text-right text-xs text-slate-400">
                <ClockIcon className="w-4 h-4 inline -mt-0.5 mr-1" />
                Seats held until
                <div className="text-sm text-slate-200 tabular-nums">
                  {when(group.expiresAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          {(group.members.length > 0 || taking) && (
            <ul className="flex flex-wrap gap-2">
              {group.members.map((m, i) => (
                <li key={i} className="px-2.5 py-1 rounded-full text-xs bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
                  ✓ {m.name}
                  {m.seats > 1 && ` +${m.seats - 1}`}
                </li>
              ))}
              {Array.from({ length: Math.max(left, 0) }, (_, i) => (
                <li key={`open-${i}`} className="px-2.5 py-1 rounded-full text-xs border border-dashed border-slate-700 text-slate-500">
                  Open seat
                </li>
              ))}
            </ul>
          )}
          {taking && (
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${link}`)}`}
                target="_blank"
                rel="noreferrer"
                className="h-10 px-4 inline-flex items-center rounded-xl text-sm font-medium bg-emerald-600 text-[#fff] hover:bg-emerald-500 transition-colors"
              >
                Share on WhatsApp
              </a>
              <button type="button" onClick={copy} className="h-10 px-4 rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800/60 transition-colors">
                {copied ? 'Link copied' : 'Copy link'}
              </button>
            </div>
          )}
        </section>

        {checkout.stage === 'completed' ? (
          <section className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 text-center space-y-5">
            <CheckCircleIcon className="w-10 h-10 text-emerald-400 mx-auto" />
            <div>
              <h2 className="text-xl font-bold text-emerald-400">You&apos;re in</h2>
              <p className="text-sm text-slate-400 mt-1">Your ticket is below and on its way to your email. Show the QR code at the entrance.</p>
            </div>
            <div className="space-y-6">
              {checkout.tickets.map((t) => (
                <TicketCard key={t.ticketCode} ticketCode={t.ticketCode} />
              ))}
            </div>
          </section>
        ) : !taking || left <= 0 ? (
          <section className="p-6 bg-panel border border-slate-800/70 rounded-2xl text-center space-y-3">
            <h2 className="text-lg font-semibold">{group.status === 'complete' || left <= 0 ? 'Everyone has paid' : 'This group has closed'}</h2>
            <p className="text-sm text-slate-400">
              {group.status === 'complete' || left <= 0
                ? 'Every seat in this group is booked.'
                : 'Time ran out, so the unpaid seats went back on sale.'}{' '}
              You can still look for tickets on the event page.
            </p>
            <a href={group.event.url} className="inline-flex h-10 px-4 items-center rounded-xl text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors">
              Go to the event
            </a>
          </section>
        ) : checkout.stage === 'awaiting_pin' ? (
          <section className="p-6 rounded-2xl bg-sky-950/20 border border-sky-800/30 text-center space-y-2">
            <h2 className="text-lg font-bold text-sky-400">Check your phone</h2>
            <p className="text-sm text-slate-400">
              Enter your M-Pesa PIN on the prompt sent to <span className="text-slate-200 tabular-nums">{phone}</span>.
            </p>
            <p className="text-xs text-slate-600">Waiting for confirmation… Don&apos;t close this page.</p>
          </section>
        ) : (
          <form onSubmit={pay} className="p-5 sm:p-6 bg-panel border border-slate-800/70 rounded-2xl space-y-4">
            <div>
              <h2 className="text-base font-semibold">Pay for your ticket</h2>
              <p className="text-xs text-slate-500 mt-0.5">You pay only for your own seat. The ticket comes in your name.</p>
            </div>
            {checkout.error && (
              <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-800/30 text-rose-400 text-sm">{checkout.error}</div>
            )}
            <div>
              <label className={labelClass} htmlFor="g-name">Your name</label>
              <input id="g-name" required value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${inputClass}`} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="g-email">Email</label>
                <input id="g-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 ${inputClass}`} />
              </div>
              <div>
                <label className={labelClass} htmlFor="g-wa">WhatsApp (optional)</label>
                <input id="g-wa" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={`mt-1 ${inputClass}`} />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div>
                <label className={labelClass} htmlFor="g-phone">M-Pesa number</label>
                <input id="g-phone" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" className={`mt-1 ${inputClass}`} />
              </div>
              {left > 1 && (
                <div>
                  <label className={labelClass} htmlFor="g-seats">Seats</label>
                  <select id="g-seats" value={seats} onChange={(e) => setSeats(Number(e.target.value))} className={`mt-1 ${inputClass}`}>
                    {Array.from({ length: left }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={checkout.stage === 'submitting'}
              className="w-full py-3.5 rounded-xl text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors disabled:opacity-50"
            >
              {checkout.stage === 'submitting'
                ? 'Sending M-Pesa prompt…'
                : `Pay ${kes(total ?? group.tier.price * seats)}${seats > 1 ? ` for ${seats} seats` : ''}`}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async ({ params }) => {
  const code = typeof params?.code === 'string' ? params.code.toUpperCase() : '';
  const group = await publicGroup(code);
  if (!group) return { notFound: true };
  return { props: { group: JSON.parse(JSON.stringify(group)), link: groupUrl(group.code) } };
};
