// pages/dashboard/events/[id].tsx
import { useEffect, useState, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';

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
}

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

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-slate-400';

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
    return <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">Loading event...</div>;
  }
  if (!event) {
    return (
      <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
        {error || 'Event not found.'}
      </div>
    );
  }

  const totalSold = event.ticketTiers.reduce((sum, t) => sum + t.sold, 0);
  const totalCapacity = event.ticketTiers.reduce((sum, t) => sum + t.capacity, 0);

  // ===========================================================================
  // VIEW MODE
  // ===========================================================================
  if (mode === 'view') {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        {error && (
          <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
            {error}
          </div>
        )}

        {/* Hero */}
        <div className="relative rounded-xl overflow-hidden border border-slate-800/80 bg-[#0E131F]">
          {event.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.coverImageUrl} alt={event.title} className="w-full h-56 object-cover" />
          ) : (
            <div className="w-full h-40 flex items-center justify-center text-xs font-mono text-slate-600 uppercase tracking-widest">
              No cover image
            </div>
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-white">{event.title}</h1>
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(event.date).toLocaleString()} &middot; {event.location}
                  {event.category && <> &middot; {event.category}</>}
                </p>
              </div>
              <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border shrink-0 ${STATUS_STYLES[event.status]}`}>
                {event.status}
              </span>
            </div>
          </div>
        </div>

        {/* Event tools */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/dashboard/events/${event.id}/checkin`}
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 transition"
          >
            Check-In
          </a>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setMode('edit')}
              className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition ml-auto"
            >
              Edit Event
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { href: 'attendees', label: 'Attendees', hint: 'Tickets & buyers', adminOnly: false },
            { href: 'gate', label: 'Gate', hint: 'Live arrivals', adminOnly: false },
            { href: 'spaces', label: 'Event Space', hint: 'Polls, Q&A, slides', adminOnly: false },
            { href: 'box-office', label: 'Box Office', hint: 'Sell at the gate', adminOnly: false },
            { href: 'promos', label: 'Promo Codes', hint: 'Discounts & promoters', adminOnly: true },
            { href: 'refunds', label: 'Refunds', hint: 'Buyer requests', adminOnly: true },
            { href: 'plan', label: 'Plan & Gear', hint: 'Rooms, scanners, staff', adminOnly: true },
            { href: 'installments', label: 'Lipa Pole Pole', hint: 'Pay in instalments', adminOnly: true },
            { href: 'feedback', label: 'Feedback', hint: 'Post-event survey', adminOnly: true },
            { href: 'certificates', label: 'Certificates', hint: 'Proof of attendance', adminOnly: true },
            { href: 'exhibitors', label: 'Exhibitors', hint: 'Sponsor lead scanning', adminOnly: true },
          ]
            .filter((tool) => isAdmin || !tool.adminOnly)
            .map((tool) => (
              <a
                key={tool.href}
                href={`/dashboard/events/${event.id}/${tool.href}`}
                className="p-3 bg-[#0E131F] border border-slate-800/80 rounded-lg hover:border-slate-600 transition"
              >
                <span className="block text-xs font-mono uppercase tracking-wider text-white">{tool.label}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">{tool.hint}</span>
              </a>
            ))}
        </div>

        {/* Status controls — admin only */}
        {isAdmin && (
          <div className="p-4 bg-[#0E131F] border border-slate-800/80 rounded-xl">
            <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-2">Status</div>
            <div className="flex flex-wrap gap-2">
              {['draft', 'published', 'cancelled', 'completed'].map((s) => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  disabled={event.status === s}
                  className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-md border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    event.status === s ? STATUS_STYLES[s] : 'border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Reminders</div>
                <p className="text-xs text-slate-400 mt-1">
                  Email + WhatsApp to ticket holders the day before and ~2 hours before, with directions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => patchEvent({ remindersEnabled: !event.remindersEnabled })}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-md border transition ${
                  event.remindersEnabled
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {event.remindersEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Re-entries per ticket</div>
                <p className="text-xs text-slate-400 mt-1">
                  0 = once in, stays in. Otherwise attendees scan out at the gate and can come back in this many times.
                </p>
              </div>
              <input
                type="number"
                min="0"
                max="20"
                key={`reentry-${event.reentryLimit}`}
                defaultValue={event.reentryLimit}
                onBlur={(e) => Number(e.target.value) !== event.reentryLimit && patchEvent({ reentryLimit: Number(e.target.value) })}
                className="w-20 bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-1.5 text-sm text-white text-center"
              />
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Booking fee</div>
                <p className="text-xs text-slate-400 mt-1">
                  {event.passFeeToBuyer
                    ? 'Buyers pay Tixflow’s fee on top of the ticket price — you receive the full price.'
                    : 'Tixflow’s fee comes out of your sales — buyers pay just the ticket price.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => patchEvent({ passFeeToBuyer: !event.passFeeToBuyer })}
                className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-md border transition ${
                  event.passFeeToBuyer
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                    : 'border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {event.passFeeToBuyer ? 'Buyer pays' : 'You pay'}
              </button>
            </div>
          </div>
        )}

        {/* Description */}
        {event.description && (
          <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl">
            <p className="text-sm text-slate-300 whitespace-pre-line">{event.description}</p>
          </div>
        )}

        {/* Gallery */}
        {event.galleryImages.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {event.galleryImages.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={img.publicId} src={img.url} alt="" className="w-full h-28 object-cover rounded-lg" />
            ))}
          </div>
        )}

        {/* Ticket tiers — read-only */}
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">Ticket Tiers</h3>
            <span className="text-xs font-mono text-slate-500">{totalSold} / {totalCapacity} sold</span>
          </div>
          {event.ticketTiers.map((tier) => (
            <div key={tier.id} className="flex items-center justify-between p-3 border border-slate-800 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tier.tierColor }} />
                <div>
                  <div className="text-sm text-white">{tier.name}</div>
                  <div className="text-xs text-slate-500">
                    {tier.price > 0 ? `KES ${tier.price.toLocaleString()}` : 'Free'}
                    {tier.doorPrice !== null && tier.doorPrice !== tier.price && ` · KES ${tier.doorPrice.toLocaleString()} at the door`}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono text-slate-400">{tier.sold} / {tier.capacity}</div>
                {!tier.isActive && <div className="text-[10px] text-slate-600 uppercase">inactive</div>}
              </div>
            </div>
          ))}
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
          className="text-xs font-mono uppercase tracking-wider text-slate-400 hover:text-white transition"
        >
          ← Back to Event
        </button>
        <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${STATUS_STYLES[event.status]}`}>
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
      <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">Images</h3>

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
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-white text-xs flex items-center justify-center hover:bg-rose-500 transition disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
                className="w-40 h-28 rounded-lg border border-dashed border-slate-700 text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white hover:border-slate-500 transition disabled:opacity-50"
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
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-white text-xs flex items-center justify-center hover:bg-rose-500 transition disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploadingGallery}
              className="w-24 h-24 rounded-lg border border-dashed border-slate-700 text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white hover:border-slate-500 transition disabled:opacity-50"
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
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
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
      <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">Ticket Tiers</h3>

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
                    className="h-9 w-full bg-[#0B0F17] border border-slate-800 rounded-md"
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
              <label className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate-400">
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
                className="text-[10px] font-mono uppercase text-rose-400 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Delete Tier
              </button>
            </div>
          </div>
        ))}

        <div className="p-4 border border-dashed border-slate-800 rounded-lg space-y-3">
          <h4 className="text-[11px] font-mono uppercase tracking-widest text-slate-500">Add New Tier</h4>
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Tier name" value={newTier.name} onChange={(e) => setNewTier({ ...newTier, name: e.target.value })} className={inputClass} />
            <input type="color" value={newTier.tierColor} onChange={(e) => setNewTier({ ...newTier, tierColor: e.target.value })} className="h-9 w-full bg-[#0B0F17] border border-slate-800 rounded-md" />
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
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
          >
            {addingTier ? 'Adding...' : '+ Add Tier'}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="p-5 bg-[#0E131F] border border-rose-900/40 rounded-xl space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-widest text-rose-400">Danger Zone</h3>
        <p className="text-[11px] font-mono text-slate-500">
          {event._count.tickets > 0
            ? 'This event has issued tickets and cannot be deleted. Set its status to "cancelled" instead.'
            : 'Deleting an event is permanent and removes all its ticket tiers.'}
        </p>
        <button
          type="button"
          onClick={handleDeleteEvent}
          disabled={event._count.tickets > 0}
          className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rose-900/50 rounded-md text-rose-400 hover:bg-rose-950/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Delete Event
        </button>
      </div>
    </div>
  );
}