// pages/dashboard/events/new.tsx
import { useState, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { inputClass, labelClass } from '@/lib/ui';

interface TierDraft {
  name: string;
  price: string;
  doorPrice: string;
  capacity: string;
  tierColor: string;
  description: string;
}

interface UploadedImage {
  url: string;
  publicId: string;
}

const emptyTier = (): TierDraft => ({
  name: '',
  price: '',
  doorPrice: '',
  capacity: '',
  tierColor: '#000000',
  description: '',
});

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function NewEventPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [coverImage, setCoverImage] = useState<UploadedImage | null>(null);
  const [galleryImages, setGalleryImages] = useState<UploadedImage[]>([]);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [tiers, setTiers] = useState<TierDraft[]>([emptyTier()]);
  const [reentryLimit, setReentryLimit] = useState('0');
  const [passFeeToBuyer, setPassFeeToBuyer] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const uploadFile = async (file: File): Promise<UploadedImage> => {
    const dataUrl = await fileToDataUrl(file);
    const res = await fetch('/api/uploads/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to upload image.');
    return result.data;
  };

  const deleteUploadedFile = async (publicId: string) => {
    try {
      await fetch('/api/uploads/image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId }),
      });
    } catch {
      // Best-effort cleanup — not worth blocking the UI over.
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    setErrorMessage('');
    try {
      const uploaded = await uploadFile(file);
      setCoverImage(uploaded);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleRemoveCover = async () => {
    if (coverImage) await deleteUploadedFile(coverImage.publicId);
    setCoverImage(null);
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingGallery(true);
    setErrorMessage('');
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file);
        setGalleryImages((prev) => [...prev, uploaded]);
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setUploadingGallery(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleRemoveGalleryImage = async (publicId: string) => {
    await deleteUploadedFile(publicId);
    setGalleryImages((prev) => prev.filter((img) => img.publicId !== publicId));
  };

  const updateTier = (index: number, field: keyof TierDraft, value: string) => {
    setTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  };

  const addTier = () => setTiers((prev) => [...prev, emptyTier()]);
  const removeTier = (index: number) =>
    setTiers((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    const payload = {
      title,
      description: description || undefined,
      category: category || undefined,
      date,
      endDate: endDate || undefined,
      location,
      coverImageUrl: coverImage?.url || undefined,
      coverImagePublicId: coverImage?.publicId || undefined,
      galleryImages,
      reentryLimit: Number(reentryLimit) || 0,
      passFeeToBuyer,
      ticketTiers: tiers.map((t) => ({
        name: t.name,
        price: Number(t.price),
        doorPrice: t.doorPrice === '' ? null : Number(t.doorPrice),
        capacity: Number(t.capacity),
        tierColor: t.tierColor,
        description: t.description || undefined,
      })),
    };

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to create event.');

      router.push(`/dashboard/events/${result.data.id}`);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };


  if (!isAdmin) {
    return (
      <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-[#0B0F17]/40 text-center">
        <p className="text-sm text-slate-400">Only admins can create events.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="font-display tracking-tight text-2xl font-semibold text-white">
          Create Event
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          New events are created as drafts — publish when ready
        </p>
      </div>

      {errorMessage && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <div>
            <label className={labelClass}>Title</label>
            <div className="mt-1">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Summer Tech Summit"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <div className="mt-1">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What's this event about?"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Category</label>
              <div className="mt-1">
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Conference"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <div className="mt-1">
                <input
                  type="text"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Nairobi, Kenya"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start Date &amp; Time</label>
              <div className="mt-1">
                <input
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>End Date &amp; Time (optional)</label>
              <div className="mt-1">
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Images */}
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">
            Images
          </h3>

          <div>
            <label className={labelClass}>Cover Image</label>
            <div className="mt-2">
              {coverImage ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverImage.url} alt="Cover" className="w-40 h-28 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={handleRemoveCover}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-white text-xs flex items-center justify-center hover:bg-rose-500 transition"
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
              {galleryImages.map((img) => (
                <div key={img.publicId} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-24 h-24 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={() => handleRemoveGalleryImage(img.publicId)}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-white text-xs flex items-center justify-center hover:bg-rose-500 transition"
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

        {/* Ticket Tiers */}
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">
            Ticket Tiers
          </h3>

          {tiers.map((tier, index) => (
            <div
              key={index}
              className="p-4 border border-slate-800 rounded-lg space-y-3 relative"
            >
              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTier(index)}
                  className="absolute top-3 right-3 text-xs text-rose-400 hover:text-rose-300 font-medium"
                >
                  Remove Tier
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Tier Name</label>
                  <div className="mt-1">
                    <input
                      type="text"
                      required
                      value={tier.name}
                      onChange={(e) => updateTier(index, 'name', e.target.value)}
                      placeholder="VIP"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Color</label>
                  <div className="mt-1">
                    <input
                      type="color"
                      value={tier.tierColor}
                      onChange={(e) => updateTier(index, 'tierColor', e.target.value)}
                      className="h-10 w-full bg-[#0B0F17] border border-slate-800 rounded-lg p-1 cursor-pointer"
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
                      required
                      value={tier.price}
                      onChange={(e) => updateTier(index, 'price', e.target.value)}
                      placeholder="1500"
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
                      value={tier.doorPrice}
                      onChange={(e) => updateTier(index, 'doorPrice', e.target.value)}
                      placeholder="Same"
                      title="Price at the gate (box office). Leave blank to use the online price."
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Capacity</label>
                  <div className="mt-1">
                    <input
                      type="number"
                      min="1"
                      required
                      value={tier.capacity}
                      onChange={(e) => updateTier(index, 'capacity', e.target.value)}
                      placeholder="100"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>Tier Description (optional)</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={tier.description}
                    onChange={(e) => updateTier(index, 'description', e.target.value)}
                    placeholder="Includes free drink"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addTier}
            className="text-[13px] text-slate-400 hover:text-white transition font-medium"
          >
            + Add another tier
          </button>
        </div>

        {/* Entry & fees */}
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Entry &amp; Fees</h3>
          <div>
            <label className={labelClass}>Re-entries allowed per ticket</label>
            <div className="mt-1 max-w-[10rem]">
              <input
                type="number"
                min="0"
                max="20"
                value={reentryLimit}
                onChange={(e) => setReentryLimit(e.target.value)}
                className={inputClass}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              0 = once in, stays in. Otherwise attendees scan out when leaving and can come back in this many times.
            </p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={passFeeToBuyer}
              onChange={(e) => setPassFeeToBuyer(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm text-white">Buyers pay the booking fee</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Tixflow&apos;s fee is added to the ticket price at checkout, so you receive the full ticket price. Off: the
                fee comes out of your sales.
              </span>
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-2.5 px-4 border border-slate-700 rounded-md text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? 'Creating...' : 'Create Event'}
        </button>
      </form>
    </div>
  );
}