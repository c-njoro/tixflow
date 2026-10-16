// components/GroupStart.tsx
//
// "Buying with friends? Start a group" on the event page (see
// src/lib/groups.ts): pick the ticket type and how many of you, pay for
// your own seat(s), then share the group link so everyone pays their own.
import { FormEvent, useState } from 'react';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import TicketCard from '@/components/TicketCard';
import { useMpesaCheckout } from '@/lib/useMpesaCheckout';

interface Tier {
  id: string;
  name: string;
  price: number;
  available: number;
}

const MAX_GROUP = 20;
const kes = (n: number) => `KES ${n.toLocaleString()}`;
const fieldClass =
  'block w-full bg-ink border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500 transition';
const labelClass = 'text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium';

export default function GroupStart({ eventId, eventTitle, tiers }: { eventId: string; eventTitle: string; tiers: Tier[] }) {
  const options = tiers.filter((t) => t.price > 0 && t.available >= 2);
  const [open, setOpen] = useState(false);
  const [tierId, setTierId] = useState(options[0]?.id ?? '');
  const [size, setSize] = useState(4);
  const [mine, setMine] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkout = useMpesaCheckout();

  if (options.length === 0) return null;
  const tier = options.find((t) => t.id === tierId) ?? options[0];
  const maxSize = Math.min(MAX_GROUP, tier.available);
  const groupSize = Math.min(Math.max(size, 2), maxSize);
  const mySeats = Math.min(mine, groupSize - 1);
  const link = code ? `${window.location.origin}/g/${code}` : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    let groupCode = code;
    if (!groupCode) {
      setStarting(true);
      try {
        const res = await fetch('/api/public/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, ticketTierId: tier.id, size: groupSize, name, email, whatsapp: whatsapp.trim() || undefined }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Could not start the group.');
        groupCode = result.data.code as string;
        setCode(groupCode);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the group.');
        return;
      } finally {
        setStarting(false);
      }
    }
    await checkout.pay({
      eventId,
      buyerName: name,
      buyerEmail: email,
      buyerWhatsapp: whatsapp.trim() || undefined,
      phoneNumber: phone,
      group: groupCode,
      items: [{ ticketTierId: tier.id, quantity: mySeats }],
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (checkout.stage === 'completed' && code) {
    const shareText = `Join our group for ${eventTitle}: each of us pays for our own ${tier.name} ticket (${kes(tier.price)}) by M-Pesa.`;
    return (
      <div className="p-6 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-emerald-400">Your group is started</h3>
          <p className="text-sm text-slate-400 mt-1">
            You&apos;ve paid for {mySeats === 1 ? 'your seat' : `${mySeats} seats`}. Now send the link to your friends: each of
            them pays for their own ticket, and the other {groupSize - mySeats} seat{groupSize - mySeats === 1 ? ' is' : 's are'} held
            for them. We&apos;ve emailed you the link too.
          </p>
        </div>
        <div className="p-3 rounded-lg bg-ink border border-slate-800 text-sm text-slate-200 break-all">{link}</div>
        <div className="flex flex-wrap gap-2">
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
          <a href={`/g/${code}`} className="h-10 px-4 inline-flex items-center rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800/60 transition-colors">
            Open the group
          </a>
        </div>
        <div className="space-y-6 pt-2">
          {checkout.tickets.map((t) => (
            <TicketCard key={t.ticketCode} ticketCode={t.ticketCode} />
          ))}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-dashed border-slate-700 text-left hover:border-slate-500 hover:bg-panel/50 transition-colors"
      >
        <UserGroupIcon className="w-5 h-5 text-slate-400 shrink-0" />
        <span>
          <span className="block text-sm font-medium text-white">Buying with friends? Start a group</span>
          <span className="block text-xs text-slate-500 mt-0.5">Everyone pays for their own ticket by M-Pesa. We hold the seats while they do.</span>
        </span>
      </button>
    );
  }

  if (checkout.stage === 'awaiting_pin') {
    return (
      <div className="p-6 rounded-2xl bg-sky-950/20 border border-sky-800/30 text-center space-y-2">
        <h3 className="text-lg font-bold text-sky-400">Check your phone</h3>
        <p className="text-sm text-slate-400">
          Enter your M-Pesa PIN on the prompt sent to <span className="text-slate-200 tabular-nums">{phone}</span> to pay for your seat.
        </p>
        <p className="text-xs text-slate-600">Waiting for confirmation… Don&apos;t close this page.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="p-5 sm:p-6 bg-panel border border-slate-800/60 rounded-2xl space-y-4">
      <div>
        <h3 className="text-base font-semibold">Start a group</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Pay for your own seat now. You get a link to share; each friend pays for theirs and gets a ticket in their own name. Seats
          nobody pays for go back on sale after the deadline, and nobody pays for anyone else.
        </p>
      </div>
      {(error || checkout.error) && (
        <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-800/30 text-rose-400 text-sm">{error || checkout.error}</div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3 sm:col-span-1 space-y-1.5">
          <label className={labelClass} htmlFor="gs-tier">Ticket</label>
          <select id="gs-tier" value={tier.id} disabled={!!code} onChange={(e) => setTierId(e.target.value)} className={fieldClass}>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {kes(t.price)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="gs-size">People</label>
          <select id="gs-size" value={groupSize} disabled={!!code} onChange={(e) => setSize(Number(e.target.value))} className={fieldClass}>
            {Array.from({ length: maxSize - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="gs-mine">I&apos;m paying for</label>
          <select id="gs-mine" value={mySeats} disabled={!!code} onChange={(e) => setMine(Number(e.target.value))} className={fieldClass}>
            {Array.from({ length: groupSize - 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} seat{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="gs-name">Your name</label>
          <input id="gs-name" required value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="gs-email">Email</label>
          <input id="gs-email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="gs-wa">WhatsApp (optional)</label>
          <input id="gs-wa" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={fieldClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="gs-phone">M-Pesa number</label>
          <input id="gs-phone" required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712345678" className={fieldClass} />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={starting || checkout.stage === 'submitting'}
          className="flex-1 py-3 rounded-xl text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors disabled:opacity-50"
        >
          {starting || checkout.stage === 'submitting' ? 'Starting…' : `Start the group and pay for my ${mySeats === 1 ? 'seat' : `${mySeats} seats`}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 rounded-xl text-sm text-slate-400 hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}
