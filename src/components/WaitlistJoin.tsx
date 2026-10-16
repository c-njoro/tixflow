// components/WaitlistJoin.tsx
//
// "Join the waitlist" for a sold-out ticket type on the event page (see
// src/lib/waitlist.ts): if seats come back, they're held for the next
// people in line and offered by email and WhatsApp.
import { FormEvent, useState } from 'react';

const fieldClass =
  'block w-full bg-ink border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-500 transition';

export default function WaitlistJoin({ eventId, tierId, tierName }: { eventId: string; tierId: string; tierName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<number | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/public/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, ticketTierId: tierId, name, email, whatsapp: whatsapp.trim() || undefined, quantity }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not join the waitlist.');
      setPosition(result.data.position);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the waitlist.');
    } finally {
      setBusy(false);
    }
  };

  if (position !== null) {
    return (
      <div className="mt-3 p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-sm text-emerald-300">
        You&apos;re number {position} in line for {tierName}. If tickets come back, we&apos;ll hold them for you and send a
        link to {email}
        {whatsapp.trim() ? ' and WhatsApp' : ''}.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 h-9 px-3 rounded-lg text-[13px] font-medium border border-slate-700 text-slate-200 hover:bg-slate-800/60 transition-colors"
      >
        Join the waitlist
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 p-3 rounded-lg border border-slate-800 bg-deep">
      <p className="text-xs text-slate-400">
        If {tierName} tickets come back, the next people in line get them first. We hold them for you for 2 hours and send
        you a link.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" className={fieldClass} />
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" className={fieldClass} />
        <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp (optional)" aria-label="WhatsApp number" className={fieldClass} />
        <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="How many tickets" className={fieldClass}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} ticket{n === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="h-9 px-4 rounded-lg text-[13px] font-medium bg-slate-100 text-ink hover:bg-white transition-colors disabled:opacity-50">
          {busy ? 'Joining...' : 'Join the waitlist'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 px-3 rounded-lg text-[13px] text-slate-400 hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}
