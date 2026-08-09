// pages/dashboard/events/new.tsx
import { useState, FormEvent } from "react";
import { useRouter } from "next/router";

interface TierDraft {
  name: string;
  price: string;
  capacity: string;
  tierColor: string;
  description: string;
}

const emptyTier = (): TierDraft => ({
  name: "",
  price: "",
  capacity: "",
  tierColor: "#000000",
  description: "",
});

export default function NewEventPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>([]);
  const [tiers, setTiers] = useState<TierDraft[]>([emptyTier()]);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const updateTier = (index: number, field: keyof TierDraft, value: string) => {
    setTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    );
  };

  const addTier = () => setTiers((prev) => [...prev, emptyTier()]);
  const removeTier = (index: number) =>
    setTiers((prev) => prev.filter((_, i) => i !== index));

  const addGalleryUrl = () => setGalleryImageUrls((prev) => [...prev, ""]);
  const updateGalleryUrl = (index: number, value: string) =>
    setGalleryImageUrls((prev) =>
      prev.map((u, i) => (i === index ? value : u)),
    );
  const removeGalleryUrl = (index: number) =>
    setGalleryImageUrls((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");

    const payload = {
      title,
      description: description || undefined,
      category: category || undefined,
      date,
      endDate: endDate || undefined,
      location,
      coverImageUrl: coverImageUrl || undefined,
      galleryImageUrls: galleryImageUrls.filter((u) => u.trim() !== ""),
      ticketTiers: tiers.map((t) => ({
        name: t.name,
        price: Number(t.price),
        capacity: Number(t.capacity),
        tierColor: t.tierColor,
        description: t.description || undefined,
      })),
    };

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create event.");

      router.push(`/dashboard/events/${result.data.id}`);
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    "block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition";
  const labelClass =
    "block text-xs font-medium uppercase tracking-wider text-slate-400";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
          Create Event
        </h1>
        <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
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
              <label className={labelClass}>
                End Date &amp; Time (optional)
              </label>
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
          <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
            Images
          </h3>

          <div>
            <label className={labelClass}>Cover Image URL</label>
            <div className="mt-1">
              <input
                type="url"
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className={labelClass}>Gallery Image URLs</label>
            {galleryImageUrls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => updateGalleryUrl(index, e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => removeGalleryUrl(index)}
                  className="px-3 text-xs font-mono uppercase text-rose-400 border border-rose-900/50 rounded-md hover:bg-rose-950/30 transition"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addGalleryUrl}
              className="text-xs font-mono uppercase tracking-wider text-slate-400 hover:text-white transition"
            >
              + Add gallery image
            </button>
          </div>
        </div>

        {/* Ticket Tiers */}
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
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
                  className="absolute top-3 right-3 text-[10px] font-mono uppercase text-rose-400 hover:text-rose-300"
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
                      onChange={(e) =>
                        updateTier(index, "name", e.target.value)
                      }
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
                      onChange={(e) =>
                        updateTier(index, "tierColor", e.target.value)
                      }
                      className="h-9 w-full bg-[#0B0F17] border border-slate-800 rounded-md"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Price</label>
                  <div className="mt-1">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={tier.price}
                      onChange={(e) =>
                        updateTier(index, "price", e.target.value)
                      }
                      placeholder="1500"
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
                      onChange={(e) =>
                        updateTier(index, "capacity", e.target.value)
                      }
                      placeholder="100"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  Tier Description (optional)
                </label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={tier.description}
                    onChange={(e) =>
                      updateTier(index, "description", e.target.value)
                    }
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
            className="text-xs font-mono uppercase tracking-wider text-slate-400 hover:text-white transition"
          >
            + Add another tier
          </button>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full flex justify-center py-2.5 px-4 border border-slate-700 rounded-md text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? "Creating..." : "Create Event"}
        </button>
      </form>
    </div>
  );
}
