// components/TicketCard.tsx
//
// The designed ticket image (/api/tickets/<code>/image) with a download
// button. Falls back to a plain QR if the card can't be loaded.
import { useState } from 'react';

export default function TicketCard({ ticketCode, label }: { ticketCode: string; label?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = `/api/tickets/${encodeURIComponent(ticketCode)}/image`;

  return (
    <div className="w-full max-w-[320px] mx-auto space-y-2">
      {failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/tickets/qr/${ticketCode}`} alt={`QR code for ${ticketCode}`} className="w-full rounded-xl bg-[#fff] p-3" />
      ) : (
        <div className="relative w-full rounded-2xl overflow-hidden shadow-2xl bg-slate-900" style={{ aspectRatio: '2 / 3' }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.08em] text-slate-500 animate-pulse font-medium">
              Preparing ticket…
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Ticket ${ticketCode}${label ? ` — ${label}` : ''}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
      )}
      <a
        href={`${src}?download=1`}
        className="block w-full text-center py-2.5 rounded-lg text-sm font-medium bg-white text-black hover:bg-slate-200 transition"
      >
        Download ticket
      </a>
    </div>
  );
}
