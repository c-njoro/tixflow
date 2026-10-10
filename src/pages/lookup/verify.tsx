// pages/lookup/verify.tsx
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import TicketCard from "@/components/TicketCard";
import { SiteHeader } from "@/components/site/SiteChrome";
import { StatusBlock } from "@/components/site/StatusPage";

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
  refund: { status: string; organiserNote: string | null } | null;
}

const REFUND_LABELS: Record<string, string> = {
  requested: "Refund requested — waiting for the organiser",
  approved: "Refund approved — being sent to your M-Pesa",
  processing: "Refund on its way to your M-Pesa",
  completed: "Refunded",
  rejected: "Refund declined",
  failed: "Refund couldn't be sent — the organiser will follow up",
};

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
  const [refundFor, setRefundFor] = useState<string | null>(null); // event title being refunded
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [refundPhone, setRefundPhone] = useState("");
  const [refundMessage, setRefundMessage] = useState("");
  const [refundError, setRefundError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitRefund = async () => {
    setRefundError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets/lookup/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ticketIds: selected, reason, refundPhone }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not send the request.");
      setRefundMessage(`Request sent — KES ${result.data.amount.toLocaleString()} once the organiser approves.`);
      setTickets((prev) =>
        prev.map((t) => (selected.includes(t.id) ? { ...t, refund: { status: "requested", organiserNote: null } } : t)),
      );
      setRefundFor(null);
      setSelected([]);
    } catch (err: any) {
      setRefundError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Tickets that can still be refunded, grouped by event.
  const refundable = (t: TicketResult) =>
    t.status === "active" &&
    new Date(t.event.date) > new Date() &&
    (!t.refund || ["rejected"].includes(t.refund.status));

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
    <div className="min-h-screen bg-ink text-white">
      <SiteHeader />

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="font-display text-2xl font-semibold">Your tickets</h1>
        {refundMessage && (
          <div className="p-3 text-sm border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">
            {refundMessage}
          </div>
        )}

        {loading ? (
          <div className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">
            Verifying...
          </div>
        ) : error ? (
          <StatusBlock
            label="TIX-LINK"
            verdict="Not valid"
            tone="amber"
            title="This tickets link didn't work"
            message={`${error} For your security, links only work for 15 minutes.`}
            actions={[{ label: "Send me a new link", href: "/lookup" }]}
          />
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
                    {new Date(ticket.event.date).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} &middot;{" "}
                    {ticket.event.location}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {ticket.ticketTier.name}
                  </div>
                  <div className="tabular-nums text-xs text-slate-400 mt-1">
                    {ticket.ticketCode}
                  </div>
                </div>
                <span
                  className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded border shrink-0 ${STATUS_STYLES[ticket.status] || STATUS_STYLES.pending} font-medium`}
                >
                  {ticket.status}
                </span>
              </div>
              {ticket.refund && (
                <div className="text-xs text-amber-400">
                  {REFUND_LABELS[ticket.refund.status] || ticket.refund.status}
                  {ticket.refund.organiserNote && (
                    <span className="text-slate-400"> — {ticket.refund.organiserNote}</span>
                  )}
                </div>
              )}
              {refundFor === null && refundable(ticket) && (
                <button
                  type="button"
                  onClick={() => {
                    setRefundFor(ticket.event.title);
                    setSelected([ticket.id]);
                    setRefundMessage("");
                  }}
                  className="text-xs text-slate-400 underline hover:text-white"
                >
                  Request a refund
                </button>
              )}
              {refundFor === ticket.event.title && selected[0] === ticket.id && (
                <div className="p-4 rounded-lg border border-slate-800 bg-panel space-y-3">
                  <div className="text-sm font-semibold">Refund request</div>
                  {tickets.filter((t) => t.event.title === ticket.event.title && refundable(t)).length > 1 && (
                    <div className="space-y-1">
                      <div className="text-xs text-slate-400">Tickets to refund</div>
                      {tickets
                        .filter((t) => t.event.title === ticket.event.title && refundable(t))
                        .map((t) => (
                          <label key={t.id} className="flex items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={selected.includes(t.id)}
                              onChange={(e) =>
                                setSelected((prev) =>
                                  e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id),
                                )
                              }
                            />
                            {t.ticketTier.name} · <span className="font-mono">{t.ticketCode}</span>
                          </label>
                        ))}
                    </div>
                  )}
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why do you need a refund?"
                    className="block w-full bg-ink border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                  />
                  <input
                    type="tel"
                    value={refundPhone}
                    onChange={(e) => setRefundPhone(e.target.value)}
                    placeholder="M-Pesa number for the refund, e.g. 0712345678"
                    className="block w-full bg-ink border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500">
                    The organiser decides on refunds. If approved, these tickets are cancelled and the ticket price is
                    sent to this number. Booking fees aren&apos;t refunded.
                  </p>
                  {refundError && <p className="text-xs text-rose-400">{refundError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting || selected.length === 0}
                      onClick={submitRefund}
                      className="px-4 py-2 rounded-md text-xs font-medium bg-white text-black disabled:opacity-50"
                    >
                      {submitting ? "Sending..." : "Send request"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundFor(null)}
                      className="px-4 py-2 rounded-md text-xs border border-slate-700 text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
