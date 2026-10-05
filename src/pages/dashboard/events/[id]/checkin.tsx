// pages/dashboard/events/[id]/checkin.tsx
//
// The gate. Built for handheld scanners (e.g. Sunmi V2s, whose scanner
// types the code + Enter like a keyboard) as well as phone cameras and
// manual entry:
//  - IN / OUT: with re-entry on, attendees scan OUT when leaving and IN on
//    return (src/lib/gate.ts has the rules).
//  - Big colour flash + beep, readable at arm's length in a crowd.
//  - Offline: download the ticket list beforehand; with no signal the
//    device decides on its own, queues the scans, and syncs them when it's
//    back online.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";

interface EventSummary {
  id: string;
  title: string;
  reentryLimit: number;
}

interface ScanData {
  buyerName?: string;
  tierName?: string;
  scannedAt?: string | null;
  reentryCount?: number;
  reentriesLeft?: number;
}

interface ScanResult {
  result: string;
  success: boolean;
  message: string;
  offline?: boolean;
  data?: ScanData;
}

interface HistoryEntry extends ScanResult {
  code: string;
  direction: Direction;
  timestamp: number;
}

type Direction = "in" | "out";

// [code, name, tierId, used, inside, reentries]
type ManifestRow = [string, string, string, boolean, boolean, number];
interface Manifest {
  eventId: string;
  reentryLimit: number;
  tiers: { id: string; name: string }[];
  generatedAt: string;
  tickets: ManifestRow[];
}
interface QueuedScan {
  localId: string;
  ticketCode: string;
  direction: Direction;
  scannedAt: string;
}

const GOOD = new Set(["admitted", "reentry", "exit"]);
const TITLES: Record<string, string> = {
  admitted: "Admitted",
  reentry: "Re-entry",
  exit: "Scanned out",
  already_inside: "Already inside",
  already_scanned: "Already used",
  no_reentries_left: "No re-entries left",
  not_inside: "Not checked in",
  cancelled: "Cancelled",
  refunded: "Refunded",
  pending: "Not paid",
  not_found: "Not found",
  wrong_event: "Wrong event",
  error: "Error",
};

const flashClass = (r: ScanResult) =>
  r.result === "exit"
    ? "bg-sky-600 text-white"
    : GOOD.has(r.result)
      ? "bg-emerald-600 text-white"
      : r.result === "already_inside" || r.result === "already_scanned" || r.result === "no_reentries_left"
        ? "bg-amber-500 text-black"
        : "bg-rose-600 text-white";

// Ignore a repeat scan of the same code within this window — the camera
// keeps decoding every frame while the QR is in view.
const DUPLICATE_SCAN_WINDOW_MS = 4000;
const SYNC_INTERVAL_MS = 15_000;

// QR codes and scanners may hand us a URL or extra characters — pull out
// the ticket code itself.
const extractCode = (raw: string) => {
  const match = raw.toUpperCase().match(/TIX-[0-9A-F]{6,}/);
  return match ? match[0] : raw.trim().toUpperCase();
};

const storage = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

// Short tones: high for good, low buzz for a problem.
function beep(good: boolean) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = good ? "sine" : "square";
    osc.frequency.value = good ? 1200 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (good ? 0.12 : 0.45));
    osc.onended = () => ctx.close();
    navigator.vibrate?.(good ? 60 : [120, 60, 120]);
  } catch {}
}

// The same rules as src/lib/gate.ts, applied to the downloaded list.
function decideOffline(manifest: Manifest, code: string, direction: Direction): { outcome: ScanResult; row?: ManifestRow } {
  const row = manifest.tickets.find((t) => t[0] === code);
  if (!row) {
    return { outcome: { result: "not_found", success: false, offline: true, message: "Not on the downloaded list for this event." } };
  }
  const [, name, tierId, used, inside, reentries] = row;
  const limit = manifest.reentryLimit;
  const data = { buyerName: name, tierName: manifest.tiers.find((t) => t.id === tierId)?.name, reentryCount: reentries };
  const fail = (result: string, message: string) => ({ outcome: { result, success: false, offline: true, message, data } });

  if (direction === "out") {
    if (!used || !inside) return fail("not_inside", "This ticket isn’t checked in.");
    const next: ManifestRow = [row[0], name, tierId, true, false, reentries];
    const left = Math.max(limit - reentries, 0);
    return { outcome: { result: "exit", success: true, offline: true, message: `Scanned out. ${left} re-entr${left === 1 ? "y" : "ies"} left.`, data }, row: next };
  }
  if (!used) {
    return { outcome: { result: "admitted", success: true, offline: true, message: "Admitted.", data }, row: [row[0], name, tierId, true, true, reentries] };
  }
  if (inside) return fail(limit > 0 ? "already_inside" : "already_scanned", limit > 0 ? "Already inside — possible copied ticket." : "Already scanned.");
  if (limit === 0) return fail("already_scanned", "Already scanned. No re-entry at this event.");
  if (reentries >= limit) return fail("no_reentries_left", `All ${limit} re-entries used.`);
  return {
    outcome: { result: "reentry", success: true, offline: true, message: `Re-entry ${reentries + 1} of ${limit}.`, data: { ...data, reentryCount: reentries + 1 } },
    row: [row[0], name, tierId, true, true, reentries + 1],
  };
}

export default function CheckInPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : undefined;

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [mode, setMode] = useState<"scanner" | "camera">("scanner");
  const [direction, setDirection] = useState<Direction>("in");
  const [code, setCode] = useState("");
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [counts, setCounts] = useState({ in: 0, out: 0, rejected: 0 });
  const [insideNow, setInsideNow] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [online, setOnline] = useState(true);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [syncNote, setSyncNote] = useState("");
  const [downloading, setDownloading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const lastCameraScanRef = useRef<{ code: string; time: number } | null>(null);
  const html5QrCodeRef = useRef<any>(null);
  const manifestRef = useRef<Manifest | null>(null);
  const queueRef = useRef<QueuedScan[]>([]);
  const directionRef = useRef<Direction>("in");
  directionRef.current = direction;

  const manifestKey = id ? `tixflow:gate:${id}:manifest` : "";
  const queueKey = id ? `tixflow:gate:${id}:queue` : "";

  const saveManifest = (m: Manifest | null) => {
    manifestRef.current = m;
    setManifest(m);
    if (m) storage.set(manifestKey, m);
  };
  const saveQueue = (q: QueuedScan[]) => {
    queueRef.current = q;
    setQueue(q);
    storage.set(queueKey, q);
  };

  const refreshInside = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/events/${id}/gate`);
      const result = await res.json();
      if (res.ok && typeof result.data?.insideNow === "number") setInsideNow(result.data.insideNow);
    } catch {}
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEvent(result.data))
      .catch(() => {});
    const m = storage.get<Manifest>(`tixflow:gate:${id}:manifest`);
    if (m) {
      manifestRef.current = m;
      setManifest(m);
    }
    const q = storage.get<QueuedScan[]>(`tixflow:gate:${id}:queue`) || [];
    queueRef.current = q;
    setQueue(q);
    refreshInside();
  }, [id, refreshInside]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const downloadManifest = async () => {
    if (!id) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/events/${id}/scan-sync`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      saveManifest(result.data);
      setSyncNote(`Ticket list saved on this device (${result.data.tickets.length} tickets).`);
    } catch {
      setSyncNote("Could not download the ticket list — check your connection.");
    } finally {
      setDownloading(false);
    }
  };

  // Send queued offline scans; report any the server disagreed with.
  const sync = useCallback(async () => {
    if (!id || queueRef.current.length === 0 || !navigator.onLine) return;
    const batch = queueRef.current.slice(0, 200);
    try {
      const res = await fetch(`/api/events/${id}/scan-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scans: batch }),
      });
      const result = await res.json();
      if (!res.ok) return;
      const sent = new Set(batch.map((s) => s.localId));
      saveQueue(queueRef.current.filter((s) => !sent.has(s.localId)));
      const conflicts = (result.data.results as { success: boolean; ticketCode: string; error?: string }[]).filter((r) => !r.success);
      setSyncNote(
        conflicts.length === 0
          ? `Synced ${batch.length} offline scan${batch.length === 1 ? "" : "s"}.`
          : `Synced ${batch.length}. ${conflicts.length} flagged by the server: ${conflicts.map((c) => `${c.ticketCode} (${c.error})`).join("; ")}`
      );
      refreshInside();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, refreshInside]);

  useEffect(() => {
    const timer = setInterval(sync, SYNC_INTERVAL_MS);
    if (online) sync();
    return () => clearInterval(timer);
  }, [online, sync]);

  const show = (rawCode: string, dir: Direction, outcome: ScanResult) => {
    setLastResult(outcome);
    beep(outcome.success);
    setHistory((prev) => [{ ...outcome, code: rawCode, direction: dir, timestamp: Date.now() }, ...prev].slice(0, 30));
    setCounts((c) =>
      !outcome.success ? { ...c, rejected: c.rejected + 1 } : outcome.result === "exit" ? { ...c, out: c.out + 1 } : { ...c, in: c.in + 1 }
    );
    if (outcome.success) setInsideNow((n) => (n === null ? n : Math.max(n + (outcome.result === "exit" ? -1 : 1), 0)));
  };

  const scanOffline = (ticketCode: string, dir: Direction) => {
    const m = manifestRef.current;
    if (!m) {
      show(ticketCode, dir, {
        result: "error",
        success: false,
        message: "No connection and no downloaded ticket list. Download it while you have signal.",
      });
      return;
    }
    const { outcome, row } = decideOffline(m, ticketCode, dir);
    if (row) {
      saveManifest({ ...m, tickets: m.tickets.map((t) => (t[0] === ticketCode ? row : t)) });
      saveQueue([
        ...queueRef.current,
        { localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ticketCode, direction: dir, scannedAt: new Date().toISOString() },
      ]);
    }
    show(ticketCode, dir, outcome);
  };

  const submitScan = async (raw: string) => {
    const ticketCode = extractCode(raw);
    if (!ticketCode || !id || busyRef.current) return;
    busyRef.current = true;
    const dir = directionRef.current;
    try {
      // Offline scans must sync first, or the server would judge this one
      // against stale state.
      if (!navigator.onLine || queueRef.current.length > 0) {
        if (navigator.onLine) await sync();
        if (!navigator.onLine || queueRef.current.length > 0) {
          scanOffline(ticketCode, dir);
          return;
        }
      }
      const res = await fetch("/api/tickets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketCode, eventId: id, direction: dir }),
        signal: AbortSignal.timeout(6000),
      });
      const result = await res.json();
      if (res.status >= 500 || res.status === 401) throw new Error(result.error || "Server error");
      show(ticketCode, dir, {
        result: result.result || "error",
        success: !!result.success,
        message: result.error || result.message || "Admitted.",
        data: result.data,
      });
      // Keep the offline copy in step with live scans.
      const m = manifestRef.current;
      if (m && result.data) {
        saveManifest({
          ...m,
          tickets: m.tickets.map((t) =>
            t[0] === ticketCode ? [t[0], t[1], t[2], true, !!result.data.isInside, result.data.reentryCount ?? t[5]] : t
          ),
        });
      }
    } catch {
      // Lost signal mid-scan — fall back to the device's own list.
      scanOffline(ticketCode, dir);
    } finally {
      busyRef.current = false;
      if (mode === "scanner") inputRef.current?.focus();
    }
  };

  // Handheld scanners type like a keyboard: whatever has focus gets the
  // code. Send any keystroke made outside a form field to the scan box.
  useEffect(() => {
    if (mode !== "scanner") return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, event]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const toSubmit = code;
    setCode("");
    submitScan(toSubmit);
  };

  // Camera lifecycle — always tears down cleanly so the camera light goes off.
  useEffect(() => {
    if (mode !== "camera") return;
    let cancelled = false;
    setCameraError("");

    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const scanner = new Html5Qrcode("qr-camera-reader");
      html5QrCodeRef.current = scanner;
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            const now = Date.now();
            const last = lastCameraScanRef.current;
            if (last && last.code === decodedText && now - last.time < DUPLICATE_SCAN_WINDOW_MS) return;
            lastCameraScanRef.current = { code: decodedText, time: now };
            submitScan(decodedText);
          },
          () => {}
        )
        .catch((err: any) => {
          setCameraError("Could not access the camera. Check camera permissions for this site, or use the scanner / manual entry.");
          console.error("CRITICAL_QR_CAMERA_START_ERROR:", err);
        });
    });

    return () => {
      cancelled = true;
      const scanner = html5QrCodeRef.current;
      if (scanner) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
        html5QrCodeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const reentry = (event?.reentryLimit ?? 0) > 0;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">Gate</h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {event ? event.title : "Loading event..."}
            {event && (reentry ? ` · ${event.reentryLimit} re-entr${event.reentryLimit === 1 ? "y" : "ies"} per ticket` : " · no re-entry")}
          </p>
        </div>
        {id && (
          <Link
            href={`/dashboard/events/${id}`}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            Back
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 bg-[#0E131F] border border-slate-800/80 rounded-xl">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Inside now</div>
          <div className="text-2xl font-mono font-bold text-white">{insideNow ?? "—"}</div>
        </div>
        <div className="p-3 bg-[#0E131F] border border-slate-800/80 rounded-xl">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">This device</div>
          <div className="text-sm font-mono text-white mt-1">
            {counts.in} in{reentry && ` · ${counts.out} out`}
          </div>
          <div className="text-[11px] font-mono text-rose-400">{counts.rejected} rejected</div>
        </div>
        <div className="p-3 bg-[#0E131F] border border-slate-800/80 rounded-xl">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Connection</div>
          <div className={`text-sm font-mono mt-1 ${online ? "text-emerald-400" : "text-amber-400"}`}>{online ? "Online" : "Offline"}</div>
          <div className="text-[11px] font-mono text-slate-500">{queue.length > 0 ? `${queue.length} to sync` : "all synced"}</div>
        </div>
      </div>

      {reentry && (
        <div className="grid grid-cols-2 gap-2">
          {(["in", "out"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d);
                inputRef.current?.focus();
              }}
              className={`py-4 rounded-xl text-lg font-mono font-bold uppercase tracking-widest border-2 transition ${
                direction === d
                  ? d === "in"
                    ? "bg-emerald-600 border-emerald-400 text-white"
                    : "bg-sky-600 border-sky-400 text-white"
                  : "border-slate-800 text-slate-500"
              }`}
            >
              {d === "in" ? "Entry" : "Exit"}
            </button>
          ))}
        </div>
      )}

      {/* Result flash — big enough to read at arm's length */}
      {lastResult ? (
        <div className={`p-6 rounded-2xl text-center ${flashClass(lastResult)}`}>
          <div className="text-3xl font-mono font-black uppercase tracking-widest">{TITLES[lastResult.result] || lastResult.result}</div>
          <div className="text-base mt-2 font-medium">{lastResult.message}</div>
          {lastResult.data?.buyerName && (
            <div className="text-lg mt-3 font-semibold">
              {lastResult.data.buyerName}
              {lastResult.data.tierName && <span className="font-normal opacity-80"> · {lastResult.data.tierName}</span>}
            </div>
          )}
          {lastResult.offline && <div className="text-[11px] mt-2 font-mono uppercase opacity-80">Decided offline · will sync</div>}
        </div>
      ) : (
        <div className="p-6 rounded-2xl text-center border-2 border-dashed border-slate-800 text-slate-500 text-sm">
          {direction === "in" ? "Ready — scan a ticket to let them in" : "Ready — scan tickets of people leaving"}
        </div>
      )}

      <div className="flex gap-2">
        {(["scanner", "camera"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
              mode === m ? "bg-slate-800 border-slate-600 text-white" : "border-slate-800 text-slate-500 hover:text-white"
            }`}
          >
            {m === "scanner" ? "Scanner device / type" : "Phone camera"}
          </button>
        ))}
      </div>

      {mode === "scanner" ? (
        // The handheld's scanner types the code + Enter into this box. It
        // takes focus back whenever it loses it, so staff never need to tap.
        <form onSubmit={handleManualSubmit}>
          <input
            ref={inputRef}
            type="text"
            inputMode="none"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => setTimeout(() => mode === "scanner" && inputRef.current?.focus(), 300)}
            placeholder="Scan, or type a ticket code and press Enter"
            autoFocus
            className="block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-4 py-3 text-lg text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 transition font-mono"
          />
        </form>
      ) : (
        <div className="space-y-2">
          {cameraError && (
            <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{cameraError}</div>
          )}
          <div id="qr-camera-reader" className="w-full rounded-xl overflow-hidden border border-slate-800/80 bg-black" />
        </div>
      )}

      <div className="p-4 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Offline mode</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {manifest
                ? `Ticket list saved ${new Date(manifest.generatedAt).toLocaleTimeString()} (${manifest.tickets.length} tickets). Keeps scanning without signal.`
                : "Download the ticket list before the gates open so scanning keeps working if the network drops."}
            </p>
          </div>
          <button
            type="button"
            onClick={downloadManifest}
            disabled={downloading || !online}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition disabled:opacity-40"
          >
            {downloading ? "Downloading..." : manifest ? "Refresh list" : "Download list"}
          </button>
        </div>
        {syncNote && <p className="text-[11px] text-slate-400">{syncNote}</p>}
      </div>

      {history.length > 0 && (
        <div className="border border-slate-800/80 rounded-xl overflow-hidden">
          <div className="p-3 bg-[#0E131F] text-xs font-mono uppercase tracking-wider text-slate-500">Recent scans</div>
          <div className="divide-y divide-slate-800/80">
            {history.map((entry, i) => (
              <div key={i} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <div className="font-mono text-xs text-slate-400">
                    {entry.code} · {entry.direction.toUpperCase()}
                    {entry.offline && " · offline"}
                  </div>
                  {entry.data?.buyerName && <div className="text-white text-xs">{entry.data.buyerName}</div>}
                </div>
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded ${
                    entry.success ? "bg-emerald-950/40 text-emerald-400" : "bg-rose-950/40 text-rose-400"
                  }`}
                >
                  {TITLES[entry.result] || entry.result}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
