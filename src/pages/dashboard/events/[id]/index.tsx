// pages/dashboard/events/[id].tsx
import { useEffect, useState, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { buttonClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';
import { StatusBlock } from '@/components/site/StatusPage';

interface TicketTier {
  id: string;
  name: string;
  price: number;
  doorPrice: number | null;
  capacity: number;
  sold: number;
  tierColor: string;
  description: string | null;
  isActive: boolean;
}

interface EventImage {
  url: string;
  publicId: string;
}

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  date: string;
  endDate: string | null;
  location: string;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  remindersEnabled: boolean;
  reentryLimit: number;
  passFeeToBuyer: boolean;
  coverImageUrl: string | null;
  coverImagePublicId: string | null;
  galleryImages: EventImage[];
  ticketTiers: TicketTier[];
  _count: { tickets: number };
  slug: string;
  tenant?: { slug: string };
}

// The event's tools, grouped by the job they do.
const TOOL_GROUPS: { title: string; tools: { href: string; label: string; hint: string; adminOnly: boolean }[] }[] = [
  {
    title: 'On the day',
    tools: [
      { href: 'checkin', label: 'Check-in', hint: 'Scan tickets in and out', adminOnly: false },
      { href: 'gate', label: 'Gate dashboard', hint: 'Live arrivals and who is inside', adminOnly: false },
      { href: 'box-office', label: 'Box office', hint: 'Sell at the door', adminOnly: false },
      { href: 'attendees', label: 'Attendees', hint: 'Tickets and buyers', adminOnly: false },
    ],
  },
  {
    title: 'Selling',
    tools: [
      { href: 'promos', label: 'Promo codes', hint: 'Discounts and promoters', adminOnly: true },
      { href: 'installments', label: 'Lipa Pole Pole', hint: 'Pay in instalments', adminOnly: true },
      { href: 'refunds', label: 'Refunds', hint: 'Buyer requests', adminOnly: true },
      { href: 'plan', label: 'Plan & gear', hint: 'Rooms, scanners, staff', adminOnly: true },
    ],
  },
  {
    title: 'Engagement',
    tools: [
      { href: 'spaces', label: 'Event Space', hint: 'Polls, Q&A, slides', adminOnly: false },
      { href: 'feedback', label: 'Feedback', hint: 'Post-event survey', adminOnly: true },
      { href: 'certificates', label: 'Certificates', hint: 'Proof of attendance', adminOnly: true },
      { href: 'exhibitors', label: 'Exhibitors', hint: 'Sponsor lead scanning', adminOnly: true },
    ],
  },
];

const toLocalInputValue = (iso: string) => {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });


const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  published: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  cancelled: 'bg-rose-950/40 text-rose-400 border-rose-800/50',
  completed: 'bg-slate-800/60 text-slate-400 border-slate-700',
};

export default function EventDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  // Non-admins never see edit mode, no matter what.
  useEffect(() => {
    if (!isAdmin) setMode('view');
  }, [isAdmin]);

  // ---- Edit form field state ----
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');

  // ---- Image upload state ----
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [deletingImage, setDeletingImage] = useState<string | null>(null); // 'cover' or a publicId
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // ---- Tier management state ----
  const [newTier, setNewTier] = useState({
    name: '', price: '', doorPrice: '', capacity: '', tierColor: '#000000', description: '',
  });
  const [addingTier, setAddingTier] = useState(false);

  const loadEvent = async () => {
    if (typeof id !== 'string') return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load event.');

      const e: EventDetail = result.data;
      setEvent(e);
      setTitle(e.title);
      setDescription(e.description || '');
      setCategory(e.category || '');
      setDate(toLocalInputValue(e.date));
      setEndDate(e.endDate ? toLocalInputValue(e.endDate) : '');
      setLocation(e.location);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- Core field save ----
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string') return;
    setSaving(true);
    setError('');
    setSaveMessage('');

    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          category: category || null,
          date,
          endDate: endDate || null,
          location,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to save changes.');

      setEvent(result.data);
      setSaveMessage('Saved.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = (status: string) => patchEvent({ status });

  const patchEvent = async (updates: Record<string, unknown>) => {
    if (typeof id !== 'string') return;
    setError('');
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update the event.');
      setEvent(result.data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteEvent = async () => {
    if (typeof id !== 'string') return;
    if (!confirm('Delete this event permanently? This cannot be undone.')) return;
    setError('');
    try {
      const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete event.');
      router.push('/dashboard/events');
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ---- Image upload/delete ----
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || typeof id !== 'string') return;
    setUploadingCover(true);
    setError('');
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch(`/api/events/${id}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, type: 'cover' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to upload cover image.');
      setEvent(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleDeleteCover = async () => {
    if (typeof id !== 'string') return;
    setDeletingImage('cover');
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cover' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to remove cover image.');
      setEvent(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingImage(null);
    }
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || typeof id !== 'string') return;
    setUploadingGallery(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const res = await fetch(`/api/events/${id}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, type: 'gallery' }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to upload an image.');
        setEvent(result.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingGallery(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleDeleteGalleryImage = async (publicId: string) => {
    if (typeof id !== 'string') return;
    setDeletingImage(publicId);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'gallery', publicId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to remove image.');
      setEvent(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingImage(null);
    }
  };

  // ---- Tier management ----
  const handleAddTier = async () => {
    if (typeof id !== 'string') return;
    if (!newTier.name || !newTier.price || !newTier.capacity) {
      setError('Tier name, price, and capacity are required.');
      return;
    }
    setAddingTier(true);
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/tiers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTier.name,
          price: Number(newTier.price),
          doorPrice: newTier.doorPrice === '' ? null : Number(newTier.doorPrice),
          capacity: Number(newTier.capacity),
          tierColor: newTier.tierColor,
          description: newTier.description || undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to add tier.');

      setEvent((prev) => (prev ? { ...prev, ticketTiers: [...prev.ticketTiers, result.data] } : prev));
      setNewTier({ name: '', price: '', doorPrice: '', capacity: '', tierColor: '#000000', description: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingTier(false);
    }
  };

  const handleUpdateTier = async (tierId: string, updates: Partial<TicketTier>) => {
    if (typeof id !== 'string') return;
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/tiers/${tierId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update tier.');

      setEvent((prev) =>
        prev
          ? { ...prev, ticketTiers: prev.ticketTiers.map((t) => (t.id === tierId ? result.data : t)) }
          : prev
      );
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteTier = async (tierId: string) => {
    if (typeof id !== 'string') return;
    if (!confirm('Delete this ticket tier?')) return;
    setError('');
    try {
      const res = await fetch(`/api/events/${id}/tiers/${tierId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete tier.');

      setEvent((prev) =>
        prev ? { ...prev, ticketTiers: prev.ticketTiers.filter((t) => t.id !== tierId) } : prev
      );
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading event...</div>;
  }
  if (!event) {
    return (
      <StatusBlock
        label="TIX-404"
        verdict="Not found"
        title="We couldn't open this event"
        message={error || 'It may have been deleted, or it belongs to another account.'}
        actions={[{ label: 'All events', href: '/dashboard/events' }]}
      />
    );
  }

  const totalSold = event.ticketTiers.reduce((sum, t) => sum + t.sold, 0);
  const totalCapacity = event.ticketTiers.reduce((sum, t) => sum + t.capacity, 0);

  // ===========================================================================
  // VIEW MODE
  // ===========================================================================
  if (mode === 'view') {
    const pct = totalCapacity > 0 ? Math.min((totalSold / totalCapacity) * 100, 100) : 0;
    const when = new Date(event.date).toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const publicUrl = event.tenant ? `/${event.tenant.slug}/${event.slug}` : null;
    const settingRow = 'flex flex-wrap items-center justify-between gap-4 py-4';

    return (
      <div className="space-y-8">
        {error && <div className="p-3 text-sm border rounded-lg bg-rose-950/30 text-rose-300 border-rose-800/50">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
          <div className="w-full sm:w-44 aspect-[16/10] rounded-xl overflow-hidden border border-slate-800/70 bg-raised shrink-0">
            {event.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-xs text-slate-600">No cover</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-0.5 rounded border font-medium ${STATUS_STYLES[event.status]}`}>
                {event.status}
              </span>
              {event.category && <span className="text-sm text-slate-500">{event.category}</span>}
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold text-white leading-tight">{event.title}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {when} · {event.location}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:self-start">
            <a href={`/dashboard/events/${event.id}/checkin`} className={primaryButtonClass}>
              Open check-in
            </a>
            {publicUrl && event.status === 'published' && (
              <a href={publicUrl} target="_blank" rel="noreferrer" className={buttonClass}>
                View page
              </a>
            )}
            {isAdmin && (
              <button type="button" onClick={() => setMode('edit')} className={buttonClass}>
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="space-y-8 min-w-0">
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-base font-semibold text-white">Tickets</h2>
                <span className="text-sm text-slate-400 tabular-nums">
                  {totalSold.toLocaleString()} / {totalCapacity.toLocaleString()} sold
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-4">
                <div className="h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
              </div>
              <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
                {event.ticketTiers.map((tier) => (
                  <li key={tier.id} className="flex items-center justify-between gap-4 px-5 py-4 bg-panel">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tier.tierColor }} />
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">
                          {tier.name}
                          {!tier.isActive && <span className="ml-2 text-xs font-normal text-slate-500">Hidden</span>}
                        </div>
                        <div className="text-sm text-slate-500 tabular-nums">
                          {tier.price > 0 ? `KES ${tier.price.toLocaleString()}` : 'Free'}
                          {tier.doorPrice !== null && tier.doorPrice !== tier.price && ` · KES ${tier.doorPrice.toLocaleString()} at the door`}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-slate-300 tabular-nums shrink-0">
                      {tier.sold} <span className="text-slate-500">/ {tier.capacity}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {isAdmin && (
              <section>
                <h2 className="text-base font-semibold text-white mb-3">Settings</h2>
                <div className="rounded-2xl border border-slate-800/70 bg-panel px-5 divide-y divide-slate-800/70">
                  <div className={settingRow}>
                    <div>
                      <div className="text-sm font-medium text-white">Status</div>
                      <p className="text-sm text-slate-500">Only published events can sell tickets.</p>
                    </div>
                    <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-ink border border-slate-800">
                      {['draft', 'published', 'cancelled', 'completed'].map((st) => (
                        <button
                          key={st}
                          onClick={() => changeStatus(st)}
                          disabled={event.status === st}
                          className={`h-8 px-3 rounded-md text-[13px] font-medium capitalize transition-colors ${
                            event.status === st ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={settingRow}>
                    <div className="max-w-md">
                      <div className="text-sm font-medium text-white">Reminders</div>
                      <p className="text-sm text-slate-500">Email and WhatsApp the day before and about 2 hours before, with directions.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={event.remindersEnabled}
                      onClick={() => patchEvent({ remindersEnabled: !event.remindersEnabled })}
                      className={`relative w-11 h-6 rounded-full transition-colors ${event.remindersEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[#fff] transition-transform ${event.remindersEnabled ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  <div className={settingRow}>
                    <div className="max-w-md">
                      <div className="text-sm font-medium text-white">Re-entries per ticket</div>
                      <p className="text-sm text-slate-500">0 means once in, stays in. Otherwise attendees scan out and can come back this many times.</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      key={`reentry-${event.reentryLimit}`}
                      defaultValue={event.reentryLimit}
                      onBlur={(e) => Number(e.target.value) !== event.reentryLimit && patchEvent({ reentryLimit: Number(e.target.value) })}
                      aria-label="Re-entries per ticket"
                      className="w-20 h-9 bg-ink border border-slate-800 rounded-lg px-3 text-sm text-white text-center tabular-nums focus:outline-none focus:border-slate-500"
                    />
                  </div>
                  <div className={settingRow}>
                    <div className="max-w-md">
                      <div className="text-sm font-medium text-white">Booking fee</div>
                      <p className="text-sm text-slate-500">
                        {event.passFeeToBuyer
                          ? 'Buyers pay Tixflow’s fee on top of the ticket price — you receive the full price.'
                          : 'Tixflow’s fee comes out of your sales — buyers pay just the ticket price.'}
                      </p>
                    </div>
                    <div className="flex gap-1 p-1 rounded-lg bg-ink border border-slate-800">
                      {[
                        { value: true, label: 'Buyer pays' },
                        { value: false, label: 'I pay' },
                      ].map((o) => (
                        <button
                          key={o.label}
                          type="button"
                          disabled={event.passFeeToBuyer === o.value}
                          onClick={() => patchEvent({ passFeeToBuyer: o.value })}
                          className={`h-8 px-3 rounded-md text-[13px] font-medium transition-colors ${
                            event.passFeeToBuyer === o.value ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {event.description && (
              <section>
                <h2 className="text-base font-semibold text-white mb-3">Description</h2>
                <p className="text-[15px] leading-relaxed text-slate-300 whitespace-pre-line max-w-[65ch]">{event.description}</p>
              </section>
            )}

            {event.galleryImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {event.galleryImages.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={img.publicId} src={img.url} alt="" className="w-full aspect-[4/3] object-cover rounded-lg border border-slate-800/70" />
                ))}
              </div>
            )}
          </div>

          <nav className="space-y-6 lg:sticky lg:top-6" aria-label="Event tools">
            {TOOL_GROUPS.map((group) => {
              const tools = group.tools.filter((tool) => isAdmin || !tool.adminOnly);
              if (tools.length === 0) return null;
              return (
                <div key={group.title}>
                  <h2 className="text-sm font-medium text-slate-500 mb-2">{group.title}</h2>
                  <ul className="rounded-2xl border border-slate-800/70 divide-y divide-slate-800/70 overflow-hidden">
                    {tools.map((tool) => (
                      <li key={tool.href}>
                        <a
                          href={`/dashboard/events/${event.id}/${tool.href}`}
                          className="group flex items-center justify-between gap-3 px-4 py-3 bg-panel hover:bg-raised transition-colors"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-white">{tool.label}</span>
                            <span className="block text-[13px] text-slate-500 truncate">{tool.hint}</span>
                          </span>
                          <ChevronRightIcon className="w-4 h-4 text-slate-600 group-hover:text-slate-300 shrink-0 transition-colors" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // EDIT MODE (admin only — mode is forced to 'view' for everyone else)
  // ===========================================================================
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMode('view')}
          className="text-[13px] text-slate-400 hover:text-white transition font-medium"
        >
          ← Back to Event
        </button>
        <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded border ${STATUS_STYLES[event.status]} font-medium`}>
          {event.status}
        </span>
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}
      {saveMessage && (
        <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">
          {saveMessage}
        </div>
      )}

      {/* Images */}
      <div className="p-5 bg-panel border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Images</h3>

        <div>
          <label className={labelClass}>Cover Image</label>
          <div className="mt-2">
            {event.coverImageUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.coverImageUrl} alt="Cover" className="w-40 h-28 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={handleDeleteCover}
                  disabled={deletingImage === 'cover'}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-[#fff] text-xs flex items-center justify-center hover:bg-rose-500 transition disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
                className="w-40 h-28 rounded-lg border border-dashed border-slate-700 text-[13px] text-slate-500 hover:text-white hover:border-slate-500 transition disabled:opacity-50 font-medium"
              >
                {uploadingCover ? 'Uploading...' : '+ Upload'}
              </button>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={handleCoverUpload}
              className="hidden"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Gallery</label>
          <div className="mt-2 flex flex-wrap gap-3">
            {event.galleryImages.map((img) => (
              <div key={img.publicId} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="w-24 h-24 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => handleDeleteGalleryImage(img.publicId)}
                  disabled={deletingImage === img.publicId}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-[#fff] text-xs flex items-center justify-center hover:bg-rose-500 transition disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploadingGallery}
              className="w-24 h-24 rounded-lg border border-dashed border-slate-700 text-[13px] text-slate-500 hover:text-white hover:border-slate-500 transition disabled:opacity-50 font-medium"
            >
              {uploadingGallery ? '...' : '+ Add'}
            </button>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleGalleryUpload}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* Core details */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="p-5 bg-panel border border-slate-800/80 rounded-xl space-y-4">
          <div>
            <label className={labelClass}>Title</label>
            <div className="mt-1">
              <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <div className="mt-1">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Category</label>
              <div className="mt-1">
                <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <div className="mt-1">
                <input type="text" required value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start Date &amp; Time</label>
              <div className="mt-1">
                <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>End Date &amp; Time (optional)</label>
              <div className="mt-1">
                <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 rounded-md text-sm font-medium bg-slate-800 border border-slate-700 hover:bg-slate-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>

      {/* Ticket tiers management */}
      <div className="p-5 bg-panel border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Ticket Tiers</h3>

        {event.ticketTiers.map((tier) => (
          <div key={tier.id} className="p-4 border border-slate-800 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    defaultValue={tier.name}
                    onBlur={(e) => e.target.value !== tier.name && handleUpdateTier(tier.id, { name: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Color</label>
                <div className="mt-1">
                  <input
                    type="color"
                    defaultValue={tier.tierColor}
                    onBlur={(e) => e.target.value !== tier.tierColor && handleUpdateTier(tier.id, { tierColor: e.target.value })}
                    className="h-10 w-full bg-ink border border-slate-800 rounded-lg p-1 cursor-pointer"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Price</label>
                <div className="mt-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={tier.price}
                    onBlur={(e) => Number(e.target.value) !== tier.price && handleUpdateTier(tier.id, { price: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Door Price</label>
                <div className="mt-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Same"
                    defaultValue={tier.doorPrice ?? ''}
                    onBlur={(e) => {
                      const next = e.target.value === '' ? null : Number(e.target.value);
                      if (next !== tier.doorPrice) handleUpdateTier(tier.id, { doorPrice: next });
                    }}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Capacity ({tier.sold} sold)</label>
                <div className="mt-1">
                  <input
                    type="number"
                    min={tier.sold}
                    defaultValue={tier.capacity}
                    onBlur={(e) => Number(e.target.value) !== tier.capacity && handleUpdateTier(tier.id, { capacity: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.06em] text-slate-400 font-medium">
                <input
                  type="checkbox"
                  defaultChecked={tier.isActive}
                  onChange={(e) => handleUpdateTier(tier.id, { isActive: e.target.checked })}
                />
                Active (visible for sale)
              </label>
              <button
                type="button"
                onClick={() => handleDeleteTier(tier.id)}
                disabled={tier.sold > 0}
                title={tier.sold > 0 ? 'Cannot delete a tier with sold tickets.' : undefined}
                className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
              >
                Delete Tier
              </button>
            </div>
          </div>
        ))}

        <div className="p-4 border border-dashed border-slate-800 rounded-lg space-y-3">
          <h4 className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">Add New Tier</h4>
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Tier name" value={newTier.name} onChange={(e) => setNewTier({ ...newTier, name: e.target.value })} className={inputClass} />
            <input type="color" value={newTier.tierColor} onChange={(e) => setNewTier({ ...newTier, tierColor: e.target.value })} className="h-10 w-full bg-ink border border-slate-800 rounded-lg p-1 cursor-pointer" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input type="number" min="0" step="0.01" placeholder="Price" value={newTier.price} onChange={(e) => setNewTier({ ...newTier, price: e.target.value })} className={inputClass} />
            <input type="number" min="0" step="0.01" placeholder="Door price (optional)" value={newTier.doorPrice} onChange={(e) => setNewTier({ ...newTier, doorPrice: e.target.value })} className={inputClass} />
            <input type="number" min="1" placeholder="Capacity" value={newTier.capacity} onChange={(e) => setNewTier({ ...newTier, capacity: e.target.value })} className={inputClass} />
          </div>
          <input type="text" placeholder="Description (optional)" value={newTier.description} onChange={(e) => setNewTier({ ...newTier, description: e.target.value })} className={inputClass} />
          <button
            type="button"
            onClick={handleAddTier}
            disabled={addingTier}
            className="px-3 py-1.5 text-[13px] border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-50 font-medium"
          >
            {addingTier ? 'Adding...' : '+ Add Tier'}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="p-5 bg-panel border border-rose-900/40 rounded-xl space-y-3">
        <h3 className="text-xs uppercase tracking-[0.08em] text-rose-400 font-medium">Danger Zone</h3>
        <p className="text-[11px] tabular-nums text-slate-500">
          {event._count.tickets > 0
            ? 'This event has issued tickets and cannot be deleted. Set its status to "cancelled" instead.'
            : 'Deleting an event is permanent and removes all its ticket tiers.'}
        </p>
        <button
          type="button"
          onClick={handleDeleteEvent}
          disabled={event._count.tickets > 0}
          className="px-3 py-1.5 text-[13px] border border-rose-900/50 rounded-md text-rose-400 hover:bg-rose-950/30 transition disabled:opacity-30 disabled:cursor-not-allowed font-medium"
        >
          Delete Event
        </button>
      </div>
    </div>
  );
}