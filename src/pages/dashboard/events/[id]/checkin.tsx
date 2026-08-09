// pages/dashboard/events/[id]/checkin.tsx
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";

interface EventSummary {
  id: string;
  title: string;
}

interface ScanResult {
  result: string;
  message: string;
  data?: {
    buyerName?: string;
    tierName?: string;
    eventTitle?: string;
    scannedAt?: string;
  };
}

interface HistoryEntry extends ScanResult {
  code: string;
  timestamp: number;
}

const RESULT_STYLES: Record<string, string> = {
  admitted: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
  already_scanned: "bg-amber-950/40 text-amber-400 border-amber-800/50",
  cancelled: "bg-rose-950/40 text-rose-400 border-rose-800/50",
  refunded: "bg-rose-950/40 text-rose-400 border-rose-800/50",
  pending: "bg-rose-950/40 text-rose-400 border-rose-800/50",
  not_found: "bg-rose-950/40 text-rose-400 border-rose-800/50",
  wrong_event: "bg-rose-950/40 text-rose-400 border-rose-800/50",
};

const inputClass =
  "block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-4 py-3 text-lg text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition font-mono";

// Ignore a repeat scan of the same code within this window — the camera
// keeps decoding every frame while the QR is in view, so without this a
// single ticket would get submitted dozens of times per second.
const DUPLICATE_SCAN_WINDOW_MS = 4000;

export default function CheckInPage() {
  const router = useRouter();
  const { id } = router.query;

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [mode, setMode] = useState<"manual" | "camera">("manual");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [admittedCount, setAdmittedCount] = useState(0);
  const [cameraError, setCameraError] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false); // mirrors `submitting` but readable inside the camera callback closure
  const lastCameraScanRef = useRef<{ code: string; time: number } | null>(null);
  const html5QrCodeRef = useRef<any>(null);

  const loadEvent = async () => {
    if (typeof id !== "string") return;
    const res = await fetch(`/api/events/${id}`);
    const result = await res.json();
    if (res.ok) setEvent(result.data);
  };

  useEffect(() => {
    loadEvent();
    if (mode === "manual") inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const submitScan = async (rawCode: string) => {
    const scannedCode = rawCode.trim();
    if (!scannedCode || typeof id !== "string" || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);

    try {
      const res = await fetch("/api/tickets/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketCode: scannedCode, eventId: id }),
      });
      const result = await res.json();

      const entry: ScanResult = {
        result: result.result || "not_found",
        message: result.error || "Admitted.",
        data: result.data,
      };

      setLastResult(entry);
      setHistory((prev) =>
        [{ ...entry, code: scannedCode, timestamp: Date.now() }, ...prev].slice(
          0,
          20,
        ),
      );

      if (entry.result === "admitted") {
        setAdmittedCount((prev) => prev + 1);
      }
    } catch {
      setLastResult({
        result: "not_found",
        message: "Network error — please try again.",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      if (mode === "manual") inputRef.current?.focus();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const toSubmit = code;
    setCode("");
    submitScan(toSubmit);
  };

  // Camera lifecycle — only touches the DOM/camera when mode === 'camera',
  // and always tears down cleanly on mode switch or unmount so the camera
  // light actually turns off.
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
            if (
              last &&
              last.code === decodedText &&
              now - last.time < DUPLICATE_SCAN_WINDOW_MS
            ) {
              return; // same code still in frame — ignore
            }
            lastCameraScanRef.current = { code: decodedText, time: now };
            submitScan(decodedText);
          },
          () => {
            // Per-frame "no QR found" callback — expected constantly while
            // aiming the camera, intentionally not treated as an error.
          },
        )
        .catch((err: any) => {
          setCameraError(
            "Could not access the camera. Check camera permissions for this site, or use manual entry instead.",
          );
          console.error("CRITICAL_QR_CAMERA_START_ERROR:", err);
        });
    });

    return () => {
      cancelled = true;
      const scanner = html5QrCodeRef.current;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {
            /* already stopped — nothing to clean up */
          });
        html5QrCodeRef.current = null;
      }
    };
  }, [mode]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
            Check-In
          </h1>
          <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
            {event ? event.title : "Loading event..."}
          </p>
        </div>
        {typeof id === "string" && (
          <Link
            href={`/dashboard/events/${id}`}
            className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            Back to Event
          </Link>
        )}
      </div>

      <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl">
        <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-1">
          Admitted this session
        </div>
        <div className="text-3xl font-mono font-bold text-white">
          {admittedCount}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
            mode === "manual"
              ? "bg-slate-800 border-slate-600 text-white"
              : "border-slate-800 text-slate-500 hover:text-white"
          }`}
        >
          Manual / Scanner Device
        </button>
        <button
          type="button"
          onClick={() => setMode("camera")}
          className={`flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
            mode === "camera"
              ? "bg-slate-800 border-slate-600 text-white"
              : "border-slate-800 text-slate-500 hover:text-white"
          }`}
        >
          Camera
        </button>
      </div>

      {mode === "manual" ? (
        // Works with a USB/Bluetooth barcode scanner (acts as a keyboard +
        // Enter) or manual typing followed by Enter/submit.
        <form onSubmit={handleManualSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan or type ticket code..."
            disabled={submitting}
            autoFocus
            className={inputClass}
          />
        </form>
      ) : (
        <div className="space-y-2">
          {cameraError && (
            <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
              {cameraError}
            </div>
          )}
          <div
            id="qr-camera-reader"
            className="w-full rounded-xl overflow-hidden border border-slate-800/80 bg-black"
          />
          <p className="text-xs text-slate-500 text-center">
            Point the camera at the attendee&apos;s QR code.
          </p>
        </div>
      )}

      {/* Last scan result — large and color-coded for quick door-side reading */}
      {lastResult && (
        <div
          className={`p-6 border rounded-xl text-center ${RESULT_STYLES[lastResult.result] || RESULT_STYLES.not_found}`}
        >
          <div className="text-lg font-mono font-bold uppercase tracking-widest">
            {lastResult.result === "admitted"
              ? "Admitted"
              : lastResult.result.replace("_", " ")}
          </div>
          <div className="text-sm mt-2">{lastResult.message}</div>
          {lastResult.data?.buyerName && (
            <div className="text-xs mt-3 opacity-80">
              {lastResult.data.buyerName} &middot; {lastResult.data.tierName}
            </div>
          )}
        </div>
      )}

      {/* Recent scan history */}
      {history.length > 0 && (
        <div className="border border-slate-800/80 rounded-xl overflow-hidden">
          <div className="p-3 bg-[#0E131F] text-xs font-mono uppercase tracking-wider text-slate-500">
            Recent Scans
          </div>
          <div className="divide-y divide-slate-800/80">
            {history.map((entry, i) => (
              <div
                key={i}
                className="p-3 flex items-center justify-between text-sm"
              >
                <div>
                  <div className="font-mono text-xs text-slate-400">
                    {entry.code}
                  </div>
                  {entry.data?.buyerName && (
                    <div className="text-white text-xs">
                      {entry.data.buyerName}
                    </div>
                  )}
                </div>
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${RESULT_STYLES[entry.result] || RESULT_STYLES.not_found}`}
                >
                  {entry.result.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
