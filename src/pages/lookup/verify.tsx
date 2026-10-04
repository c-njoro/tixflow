// pages/lookup/verify.tsx
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import TicketCard from "@/components/TicketCard";

interface TicketResult {
  id: string;
  ticketCode: string;
  status: string;
  event: {
    title: string;
    date: string;
    location: string;
    coverImageUrl: string | null;
  };
  ticketTier: { name: string };
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-800 text-slate-300 border-slate-700",
  active: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
  scanned: "bg-sky-950/40 text-sky-400 border-sky-800/50",
  cancelled: "bg-rose-950/40 text-rose-400 border-rose-800/50",
  refunded: "bg-amber-950/40 text-amber-400 border-amber-800/50",
};

export default function LookupVerifyPage() {
  const router = useRouter();
  const { token } = router.query;

  const [tickets, setTickets] = useState<TicketResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof token !== "string") return;

    const verify = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/tickets/lookup/verify?token=${encodeURIComponent(token)}`,
        );
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to verify link.");
        setTickets(result.data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <header className="p-6 border-b border-slate-800/80">
        <Link
          href="/"
          className="text-sm font-mono font-bold uppercase tracking-widest"
        >
          Tixflow
        </Link>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold">Your Tickets</h1>

        {loading ? (
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            Verifying...
          </div>
        ) : error ? (
          <div className="p-4 text-sm border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50 space-y-3">
            <p>{error}</p>
            <Link href="/lookup" className="underline text-sm">
              Request a new link
            </Link>
          </div>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-slate-500">
            No tickets found for this email.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="p-4 border border-slate-800/80 rounded-xl space-y-4">
                {(ticket.status === 'active' || ticket.status === 'scanned') && (
                  <TicketCard ticketCode={ticket.ticketCode} label={ticket.ticketTier.name} />
                )}
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {ticket.event.title}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {new Date(ticket.event.date).toLocaleString()} &middot;{" "}
                    {ticket.event.location}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {ticket.ticketTier.name}
                  </div>
                  <div className="font-mono text-xs text-slate-400 mt-1">
                    {ticket.ticketCode}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border shrink-0 ${STATUS_STYLES[ticket.status] || STATUS_STYLES.pending}`}
                >
                  {ticket.status}
                </span>
              </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
