// components/QrCameraScanner.tsx
//
// Camera QR scanner (html5-qrcode), same lifecycle as the check-in page:
// starts on mount, always stops on unmount so the camera light goes off,
// and ignores the same code while it's still in frame.
import { useEffect, useId, useRef, useState } from 'react';

const DUPLICATE_SCAN_WINDOW_MS = 3000;

type Scanner = { start: (...args: unknown[]) => Promise<unknown>; stop: () => Promise<unknown>; clear: () => void };

export default function QrCameraScanner({ onScan }: { onScan: (code: string) => void }) {
  const elementId = `qr-reader-${useId().replace(/:/g, '')}`;
  const onScanRef = useRef(onScan);
  const [error, setError] = useState('');

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let cancelled = false;
    let scanner: Scanner | null = null;
    let last: { code: string; time: number } | null = null;

    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (cancelled) return;
      scanner = new Html5Qrcode(elementId) as unknown as Scanner;
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (decodedText: string) => {
            const now = Date.now();
            if (last && last.code === decodedText && now - last.time < DUPLICATE_SCAN_WINDOW_MS) return;
            last = { code: decodedText, time: now };
            onScanRef.current(decodedText);
          },
          () => {
            // Per-frame "no QR found" — expected constantly while aiming.
          }
        )
        .catch(() => setError('Could not access the camera. Allow camera access for this site, or type the code instead.'));
    });

    return () => {
      cancelled = true;
      if (scanner) {
        const s = scanner;
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [elementId]);

  return (
    <div className="space-y-2">
      <div id={elementId} className="w-full overflow-hidden rounded-xl bg-[#000] min-h-[240px]" />
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  );
}
