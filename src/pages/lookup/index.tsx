// pages/lookup.tsx
import { useState, FormEvent } from "react";
import { SiteHeader } from "@/components/site/SiteChrome";

export default function LookupRequestPage() {
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/tickets/lookup/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, whatsapp: whatsapp.trim() || undefined }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Something went wrong.");

      setMessage(result.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-white">
      <SiteHeader />

      <main className="max-w-2xl mx-auto p-6 pt-16 space-y-6">
        <div className="text-center">
          <h1 className="font-display text-2xl font-semibold">Find your tickets</h1>
          <p className="text-sm text-slate-400 mt-2">
            Enter the email you used to buy tickets and we&apos;ll send you a
            link to view them.
          </p>
        </div>

        {error && (
          <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
            {error}
          </div>
        )}

        {message ? (
          <div className="p-4 text-sm border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50 text-center">
            {message}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="block w-full bg-panel border border-slate-800 rounded-md px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
            />
            <div>
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="WhatsApp number (optional)"
                className="block w-full bg-panel border border-slate-800 rounded-md px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
              />
              <p className="text-[11px] text-slate-600 mt-1.5">
                Use the WhatsApp number you gave at checkout and we&apos;ll send the link there too. The email link
                works either way.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-md text-sm font-medium bg-white text-black hover:bg-slate-200 transition disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send me the link"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
