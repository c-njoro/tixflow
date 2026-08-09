// pages/dashboard/events/[id].tsx
import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/router";

interface TicketTier {
  id: string;
  name: string;
  price: number;
  capacity: number;
  sold: number;
  tierColor: string;
  description: string | null;
  isActive: boolean;
}

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  date: string;
  endDate: string | null;
  location: string;
  status: "draft" | "published" | "cancelled" | "completed";
  coverImageUrl: string | null;
  galleryImageUrls: string[];
  ticketTiers: TicketTier[];
  _count: { tickets: number };
}

const toLocalInputValue = (iso: string) => {
  // datetime-local inputs need "YYYY-MM-DDTHH:mm" in local time
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const inputClass =
  "block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition";
const labelClass =
  "block text-xs font-medium uppercase tracking-wider text-slate-400";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-800 text-slate-300 border-slate-700",
  published: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
  cancelled: "bg-rose-950/40 text-rose-400 border-rose-800/50",
  completed: "bg-slate-800/60 text-slate-400 border-slate-700",
};

export default function EditEventPage() {
  const router = useRouter();
  const { id } = router.query;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Editable field state, populated once the event loads
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>([]);

  // New tier draft
  const [newTier, setNewTier] = useState({
    name: "",
    price: "",
    capacity: "",
    tierColor: "#000000",
    description: "",
  });
  const [addingTier, setAddingTier] = useState(false);

  const loadEvent = async () => {
    if (typeof id !== "string") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/events/${id}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to load event.");

      const e: EventDetail = result.data;
      setEvent(e);
      setTitle(e.title);
      setDescription(e.description || "");
      setCategory(e.category || "");
      setDate(toLocalInputValue(e.date));
      setEndDate(e.endDate ? toLocalInputValue(e.endDate) : "");
      setLocation(e.location);
      setCoverImageUrl(e.coverImageUrl || "");
      setGalleryImageUrls(e.galleryImageUrls || []);
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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (typeof id !== "string") return;
    setSaving(true);
    setError("");
    setSaveMessage("");

    const payload = {
      title,
      description: description || null,
      category: category || null,
      date,
      endDate: endDate || null,
      location,
      coverImageUrl: coverImageUrl || null,
      galleryImageUrls: galleryImageUrls.filter((u) => u.trim() !== ""),
    };

    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save changes.");

      setEvent(result.data);
      setSaveMessage("Saved.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (typeof id !== "string") return;
    setError("");
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to update status.");
      setEvent(result.data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteEvent = async () => {
    if (typeof id !== "string") return;
    if (!confirm("Delete this event permanently? This cannot be undone."))
      return;
    setError("");
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to delete event.");
      router.push("/dashboard/events");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddTier = async () => {
    if (typeof id !== "string") return;
    if (!newTier.name || !newTier.price || !newTier.capacity) {
      setError("Tier name, price, and capacity are required.");
      return;
    }
    setAddingTier(true);
    setError("");
    try {
      const res = await fetch(`/api/events/${id}/tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTier.name,
          price: Number(newTier.price),
          capacity: Number(newTier.capacity),
          tierColor: newTier.tierColor,
          description: newTier.description || undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to add tier.");

      setEvent((prev) =>
        prev
          ? { ...prev, ticketTiers: [...prev.ticketTiers, result.data] }
          : prev,
      );
      setNewTier({
        name: "",
        price: "",
        capacity: "",
        tierColor: "#000000",
        description: "",
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingTier(false);
    }
  };

  const handleUpdateTier = async (
    tierId: string,
    updates: Partial<TicketTier>,
  ) => {
    if (typeof id !== "string") return;
    setError("");
    try {
      const res = await fetch(`/api/events/${id}/tiers/${tierId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to update tier.");

      setEvent((prev) =>
        prev
          ? {
              ...prev,
              ticketTiers: prev.ticketTiers.map((t) =>
                t.id === tierId ? result.data : t,
              ),
            }
          : prev,
      );
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteTier = async (tierId: string) => {
    if (typeof id !== "string") return;
    if (!confirm("Delete this ticket tier?")) return;
    setError("");
    try {
      const res = await fetch(`/api/events/${id}/tiers/${tierId}`, {
        method: "DELETE",
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to delete tier.");

      setEvent((prev) =>
        prev
          ? {
              ...prev,
              ticketTiers: prev.ticketTiers.filter((t) => t.id !== tierId),
            }
          : prev,
      );
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addGalleryUrl = () => setGalleryImageUrls((prev) => [...prev, ""]);
  const updateGalleryUrl = (index: number, value: string) =>
    setGalleryImageUrls((prev) =>
      prev.map((u, i) => (i === index ? value : u)),
    );
  const removeGalleryUrl = (index: number) =>
    setGalleryImageUrls((prev) => prev.filter((_, i) => i !== index));

  if (loading) {
    return (
      <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
        Loading event...
      </div>
    );
  }

  if (!event) {
    return (
      <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
        {error || "Event not found."}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
            {event.title}
          </h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            Manage event details, tiers, and status
          </p>
        </div>
        <span
          className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border shrink-0 ${STATUS_STYLES[event.status]}`}
        >
          {event.status}
        </span>
      </div>

      <div className="flex gap-3">
        <a
          href={`/dashboard/events/${event.id}/attendees`}
          className="inline-block px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition"
        >
          View Attendees
        </a>
        <a
          href={`/dashboard/events/${event.id}/checkin`}
          className="inline-block px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition"
        >
          Check-In
        </a>
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

      {/* Status controls */}
      <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
          Status
        </h3>
        <div className="flex flex-wrap gap-2">
          {["draft", "published", "cancelled", "completed"].map((s) => (
            <button
              key={s}
              onClick={() => changeStatus(s)}
              disabled={event.status === s}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-md border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                event.status === s
                  ? STATUS_STYLES[s]
                  : "border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Core details form */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <div>
            <label className={labelClass}>Title</label>
            <div className="mt-1">
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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

        <button
          type="submit"
          disabled={saving}
          className="w-full flex justify-center py-2.5 px-4 border border-slate-700 rounded-md text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>

      {/* Ticket Tiers */}
      <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs font-mono uppercase tracking-widest text-slate-400">
          Ticket Tiers
        </h3>

        {event.ticketTiers.map((tier) => (
          <div
            key={tier.id}
            className="p-4 border border-slate-800 rounded-lg space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    defaultValue={tier.name}
                    onBlur={(e) =>
                      e.target.value !== tier.name &&
                      handleUpdateTier(tier.id, { name: e.target.value })
                    }
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
                    onBlur={(e) =>
                      e.target.value !== tier.tierColor &&
                      handleUpdateTier(tier.id, { tierColor: e.target.value })
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
                    defaultValue={tier.price}
                    onBlur={(e) =>
                      Number(e.target.value) !== tier.price &&
                      handleUpdateTier(tier.id, {
                        price: Number(e.target.value),
                      })
                    }
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>
                  Capacity ({tier.sold} sold)
                </label>
                <div className="mt-1">
                  <input
                    type="number"
                    min={tier.sold}
                    defaultValue={tier.capacity}
                    onBlur={(e) =>
                      Number(e.target.value) !== tier.capacity &&
                      handleUpdateTier(tier.id, {
                        capacity: Number(e.target.value),
                      })
                    }
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
                  onChange={(e) =>
                    handleUpdateTier(tier.id, { isActive: e.target.checked })
                  }
                />
                Active (visible for sale)
              </label>

              <button
                type="button"
                onClick={() => handleDeleteTier(tier.id)}
                disabled={tier.sold > 0}
                title={
                  tier.sold > 0
                    ? "Cannot delete a tier with sold tickets."
                    : undefined
                }
                className="text-[10px] font-mono uppercase text-rose-400 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Delete Tier
              </button>
            </div>
          </div>
        ))}

        {/* Add new tier */}
        <div className="p-4 border border-dashed border-slate-800 rounded-lg space-y-3">
          <h4 className="text-[11px] font-mono uppercase tracking-widest text-slate-500">
            Add New Tier
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Tier name"
              value={newTier.name}
              onChange={(e) => setNewTier({ ...newTier, name: e.target.value })}
              className={inputClass}
            />
            <input
              type="color"
              value={newTier.tierColor}
              onChange={(e) =>
                setNewTier({ ...newTier, tierColor: e.target.value })
              }
              className="h-9 w-full bg-[#0B0F17] border border-slate-800 rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Price"
              value={newTier.price}
              onChange={(e) =>
                setNewTier({ ...newTier, price: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="number"
              min="1"
              placeholder="Capacity"
              value={newTier.capacity}
              onChange={(e) =>
                setNewTier({ ...newTier, capacity: e.target.value })
              }
              className={inputClass}
            />
          </div>
          <input
            type="text"
            placeholder="Description (optional)"
            value={newTier.description}
            onChange={(e) =>
              setNewTier({ ...newTier, description: e.target.value })
            }
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleAddTier}
            disabled={addingTier}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
          >
            {addingTier ? "Adding..." : "+ Add Tier"}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="p-5 bg-[#0E131F] border border-rose-900/40 rounded-xl space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-widest text-rose-400">
          Danger Zone
        </h3>
        <p className="text-[11px] font-mono text-slate-500">
          {(event._count?.tickets ?? 0) > 0
            ? 'This event has issued tickets and cannot be deleted. Set its status to "cancelled" instead.'
            : "Deleting an event is permanent and removes all its ticket tiers."}
        </p>
        <button
          type="button"
          onClick={handleDeleteEvent}
          disabled={(event._count?.tickets ?? 0) > 0}
          className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-rose-900/50 rounded-md text-rose-400 hover:bg-rose-950/30 transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Delete Event
        </button>
      </div>
    </div>
  );
}
