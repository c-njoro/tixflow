// pages/dashboard/events/[id]/guests.tsx
//
// The guest list: people the organiser lets in by name. Each guest (and
// anyone they bring) gets a pass. With an email or WhatsApp number it can
// be sent to them; without one they're on the door list, and the gate
// finds them by name (src/lib/guests.ts).
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';
import { formatDateTime } from '@/lib/format';

interface Pass {
  code: string;
  name: string;
  checkedIn: boolean;
}

interface GuestRow {
  id: string;
  name: string;
  email: string | null;
  whatsapp: string | null;
  plusOnes: number;
  group: string | null;
  note: string | null;
  passSentAt: string | null;
  passes: Pass[];
}

const emptyGuest = { name: '', email: '', whatsapp: '', plusOnes: '0', group: '', note: '' };

const contactOf = (g: Pick<GuestRow, 'email' | 'whatsapp'>) =>
  [g.email, g.whatsapp].filter(Boolean).join(' · ');

export default function GuestListPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [eventTitle, setEventTitle] = useState('');
  const [guests, setGuests] = useState<GuestRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<'one' | 'paste'>('one');
  const [form, setForm] = useState(emptyGuest);
  const [pasted, setPasted] = useState('');
  const [sendNow, setSendNow] = useState(true);

  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyGuest);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/events/${id}/guests`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load the guest list.');
    setGuests(result.data.guests);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    // Fetch-on-mount; the state updates land after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err) => setError(err.message));
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id, load]);

  const request = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/events/${id}/guests${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      await load();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addOne = async (e: FormEvent) => {
    e.preventDefault();
    const hasContact = !!(form.email.trim() || form.whatsapp.trim());
    const result = await request('', 'POST', {
      guests: [{ ...form, plusOnes: Number(form.plusOnes) || 0 }],
      send: sendNow && hasContact,
    });
    if (result) {
      setNotice(`${form.name.trim()} is on the list${sendNow && hasContact ? '. Their pass is on its way.' : '.'}`);
      setForm(emptyGuest);
    }
  };

  const addPasted = async (e: FormEvent) => {
    e.preventDefault();
    const result = await request('', 'POST', { text: pasted, send: sendNow });
    if (result) {
      const n = result.data.added;
      setNotice(`Added ${n} guest${n === 1 ? '' : 's'}${sendNow ? '. Passes are going out to everyone with an email or number.' : '.'}`);
      setPasted('');
    }
  };

  const sendAll = async () => {
    const result = await request('', 'POST', { action: 'send_all' });
    if (result) {
      const n = result.data.sending;
      setNotice(n === 0 ? 'Everyone with an email or number already has their pass.' : `Sending passes to ${n} guest${n === 1 ? '' : 's'}. This takes a few minutes.`);
    }
  };

  const sendOne = async (g: GuestRow) => {
    const result = await request(`/${g.id}`, 'POST', { action: 'send' });
    if (result) setNotice(`Pass sent to ${g.name}.`);
  };

  const startEdit = (g: GuestRow) => {
    setEditing(g.id);
    setConfirmRemove(null);
    setEditForm({
      name: g.name,
      email: g.email ?? '',
      whatsapp: g.whatsapp ?? '',
      plusOnes: String(g.plusOnes),
      group: g.group ?? '',
      note: g.note ?? '',
    });
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const result = await request(`/${editing}`, 'PATCH', { ...editForm, plusOnes: Number(editForm.plusOnes) || 0 });
    if (result) setEditing(null);
  };

  const remove = async (g: GuestRow) => {
    const result = await request(`/${g.id}`, 'DELETE');
    if (result) {
      setConfirmRemove(null);
      setNotice(`${g.name} is off the list. Their unused passes no longer work.`);
    }
  };

  const groups = useMemo(() => [...new Set((guests ?? []).map((g) => g.group).filter((g): g is string => !!g))].sort(), [guests]);
  const totals = useMemo(() => {
    const all = guests ?? [];
    const people = all.reduce((n, g) => n + g.passes.length, 0);
    const arrived = all.reduce((n, g) => n + g.passes.filter((p) => p.checkedIn).length, 0);
    const unsent = all.filter((g) => !g.passSentAt && (g.email || g.whatsapp)).length;
    const doorOnly = all.filter((g) => !g.email && !g.whatsapp).length;
    const sent = all.filter((g) => g.passSentAt).length;
    return { people, arrived, unsent, doorOnly, sent };
  }, [guests]);

  const shown = (guests ?? []).filter((g) => {
    if (groupFilter && g.group !== groupFilter) return false;
    const q = query.trim().toLowerCase();
    return !q || g.name.toLowerCase().includes(q) || (g.email ?? '').includes(q) || (g.whatsapp ?? '').includes(q.replace(/\D/g, '') || '\u0000');
  });

  const guestFields = (f: typeof emptyGuest, set: (f: typeof emptyGuest) => void) => (
    <>
      <div>
        <label className={labelClass} htmlFor={`${f === form ? 'add' : 'edit'}-name`}>Name</label>
        <input id={`${f === form ? 'add' : 'edit'}-name`} required value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder="Wanjiru Kamau" className={`mt-1 ${inputClass}`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Email</label>
          <input type="email" value={f.email} onChange={(e) => set({ ...f, email: e.target.value })} placeholder="Optional" className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>WhatsApp</label>
          <input type="tel" value={f.whatsapp} onChange={(e) => set({ ...f, whatsapp: e.target.value })} placeholder="Optional" className={`mt-1 ${inputClass}`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Guests they bring</label>
          <input type="number" min="0" max="20" value={f.plusOnes} onChange={(e) => set({ ...f, plusOnes: e.target.value })} className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Group</label>
          <input value={f.group} onChange={(e) => set({ ...f, group: e.target.value })} placeholder="Press, Family…" list="guest-groups" className={`mt-1 ${inputClass}`} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Note for the gate</label>
        <input value={f.note} onChange={(e) => set({ ...f, note: e.target.value })} placeholder="Optional, e.g. Backstage access" className={`mt-1 ${inputClass}`} />
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Guest list</h1>
          <p className="text-sm text-slate-400 mt-1">{eventTitle || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {notice && <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">{notice}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'On the list', value: totals.people.toLocaleString(), sub: `${(guests?.length ?? 0).toLocaleString()} invites` },
          { label: 'Arrived', value: totals.arrived.toLocaleString(), sub: totals.people ? `${Math.round((totals.arrived / totals.people) * 100)}%` : '—' },
          { label: 'Door list only', value: totals.doorOnly.toLocaleString(), sub: 'No email or number' },
          { label: 'Passes sent', value: totals.sent.toLocaleString(), sub: `${totals.unsent.toLocaleString()} not sent yet` },
        ].map((s) => (
          <div key={s.label} className="p-3 bg-panel border border-slate-800/80 rounded-xl">
            <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">{s.label}</div>
            <div className="text-2xl tabular-nums font-bold text-white">{s.value}</div>
            <div className="text-[11px] text-slate-500">{s.sub}</div>
          </div>
        ))}
      </div>

      <datalist id="guest-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="space-y-3 lg:col-span-2 min-w-0">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names"
              aria-label="Search guests"
              className={`${inputClass} flex-1 min-w-[12rem]`}
            />
            {groups.length > 0 && (
              <div className="w-full sm:w-44">
                <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by group" className={inputClass}>
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {isAdmin && totals.unsent > 0 && (
              <button type="button" disabled={busy} onClick={sendAll} className={buttonClass}>
                Send {totals.unsent} unsent pass{totals.unsent === 1 ? '' : 'es'}
              </button>
            )}
          </div>

          {!guests ? (
            <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading...</p>
          ) : guests.length === 0 ? (
            <div className={`${cardClass} space-y-2`}>
              <h2 className="text-sm font-semibold text-white">No guests yet</h2>
              <p className="text-sm text-slate-400">
                Add people by name: speakers, sponsors, press, family. Give an email or WhatsApp number and they get a pass
                with a QR code. Leave it out and they&apos;re on the door list: the gate finds them by name.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-slate-500">No guests match.</p>
          ) : (
            <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
              {shown.map((g) => {
                const arrived = g.passes.filter((p) => p.checkedIn).length;
                return (
                  <li key={g.id} className="px-4 sm:px-5 py-4 bg-panel space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-white">
                          {g.name}
                          {g.plusOnes > 0 && <span className="ml-1.5 text-slate-400 font-normal tabular-nums">+{g.plusOnes}</span>}
                          {g.group && (
                            <span className="ml-2 text-[11px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 font-medium align-middle">
                              {g.group}
                            </span>
                          )}
                        </div>
                        <div className="text-[13px] text-slate-500 truncate">{contactOf(g) || 'Door list only'}</div>
                        {g.note && <div className="text-[13px] text-slate-400 mt-0.5">{g.note}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <span
                          className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded font-medium ${
                            arrived === 0
                              ? 'bg-slate-800 text-slate-400'
                              : arrived === g.passes.length
                                ? 'bg-emerald-950/40 text-emerald-400'
                                : 'bg-sky-950/40 text-sky-400'
                          }`}
                        >
                          {arrived === 0 ? 'Not arrived' : g.passes.length === 1 ? 'Arrived' : `${arrived} of ${g.passes.length} in`}
                        </span>
                        <div className="text-[11px] text-slate-500 mt-1.5">
                          {g.passSentAt ? `Pass sent ${formatDateTime(g.passSentAt)}` : g.email || g.whatsapp ? 'Pass not sent' : ''}
                        </div>
                      </div>
                    </div>

                    {isAdmin && editing !== g.id && (
                      <div className="flex flex-wrap gap-2">
                        {(g.email || g.whatsapp) && (
                          <button type="button" disabled={busy} onClick={() => sendOne(g)} className={buttonClass}>
                            {g.passSentAt ? 'Resend pass' : 'Send pass'}
                          </button>
                        )}
                        <button type="button" disabled={busy} onClick={() => startEdit(g)} className={buttonClass}>
                          Edit
                        </button>
                        {confirmRemove === g.id ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => remove(g)} className={`${buttonClass} !border-rose-900/60 !text-rose-300`}>
                              Remove {g.name.split(' ')[0]}
                            </button>
                            <button type="button" onClick={() => setConfirmRemove(null)} className={buttonClass}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => setConfirmRemove(g.id)} className={buttonClass}>
                            Remove
                          </button>
                        )}
                      </div>
                    )}

                    {isAdmin && editing === g.id && (
                      <form onSubmit={saveEdit} className="space-y-3 pt-1">
                        {guestFields(editForm, setEditForm)}
                        <div className="flex gap-2">
                          <button type="submit" disabled={busy} className={primaryButtonClass}>
                            {busy ? 'Saving...' : 'Save'}
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className={buttonClass}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {isAdmin && (
          <div className={`${cardClass} space-y-4 lg:sticky lg:top-6`}>
            <div className="flex gap-1 p-1 rounded-lg bg-ink border border-slate-800" role="tablist">
              {[
                { value: 'one' as const, label: 'Add a guest' },
                { value: 'paste' as const, label: 'Paste a list' },
              ].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  className={`flex-1 h-8 rounded-md text-[13px] font-medium transition-colors ${tab === t.value ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'one' ? (
              <form onSubmit={addOne} className="space-y-3">
                {guestFields(form, setForm)}
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} className="mt-1" />
                  <span className="text-sm text-slate-300">Send their pass now (needs an email or WhatsApp number)</span>
                </label>
                <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
                  {busy ? 'Adding...' : 'Add to guest list'}
                </button>
              </form>
            ) : (
              <form onSubmit={addPasted} className="space-y-3">
                <div>
                  <label className={labelClass} htmlFor="paste-guests">One guest per line</label>
                  <textarea
                    id="paste-guests"
                    required
                    rows={8}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={'Wanjiru Kamau, 0712345678, +1, Press\nBrian Otieno, brian@example.com\nAunt Njeri, Family'}
                    className={`mt-1 ${inputClass} font-mono text-[13px]`}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Name first, then any of: an email, a phone number, +2 for guests they bring, a group. Separate with commas,
                    or paste straight from a spreadsheet.
                  </p>
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} className="mt-1" />
                  <span className="text-sm text-slate-300">Send passes now to everyone with an email or number</span>
                </label>
                <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
                  {busy ? 'Adding...' : 'Add guests'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
