// pages/certificate/[ticketCode].tsx
//
// An attendee's certificate of attendance — an A4 landscape page made for
// printing or "Save as PDF". The attendee can set the name it shows.
import { FormEvent, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

interface Certificate {
  name: string;
  certificateId: string;
  title: string;
  eventTitle: string;
  eventDate: string;
  eventEndDate: string | null;
  location: string;
  attendedAt: string | null;
  organiser: string;
  logoUrl: string | null;
  signatory: string | null;
  signatoryTitle: string | null;
  note: string | null;
}

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long', year: 'numeric' });

function dateRange(start: string, end: string | null) {
  if (!end || longDate(start) === longDate(end)) return longDate(start);
  return `${longDate(start)} – ${longDate(end)}`;
}

export default function CertificatePage() {
  const router = useRouter();
  const ticketCode = typeof router.query.ticketCode === 'string' ? router.query.ticketCode : undefined;
  const token = typeof router.query.t === 'string' ? router.query.t : undefined;
  const [cert, setCert] = useState<Certificate | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ticketCode || !token) return;
    fetch(`/api/certificates/${encodeURIComponent(ticketCode)}?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Certificate not found.');
        setCert(result.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Certificate not found.'));
  }, [ticketCode, token]);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!ticketCode) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/certificates/${encodeURIComponent(ticketCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, name }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not save the name.');
      setCert(result.data);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the name.');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <div className="min-h-screen bg-ink text-slate-400 flex items-center justify-center p-6 text-sm">{error}</div>;
  }
  if (!cert) {
    return (
      <div className="min-h-screen bg-ink text-slate-500 flex items-center justify-center text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="certificate-page min-h-screen bg-[#1c1f26] py-8 px-4">
      <Head>
        <title>{`${cert.title} · ${cert.name}`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .certificate-page { background: #fff !important; padding: 0 !important; }
          .sheet { box-shadow: none !important; margin: 0 !important; width: 297mm !important; height: 210mm !important; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print max-w-[297mm] mx-auto mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => window.print()} className="px-4 py-2 rounded-md bg-[#fff] text-[#000] text-sm font-medium">
          Download / print (Save as PDF)
        </button>
        {editing ? (
          <form onSubmit={saveName} className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="bg-ink border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
            />
            <button type="submit" disabled={saving} className="px-3 py-2 rounded-md border border-slate-600 text-sm text-slate-200">
              {saving ? 'Saving…' : 'Save name'}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setName(cert.name);
              setEditing(true);
            }}
            className="px-3 py-2 rounded-md border border-slate-600 text-sm text-slate-300"
          >
            Change the name shown
          </button>
        )}
      </div>

      {/* The sheet itself: fixed A4 landscape proportions, scrolls on small screens. */}
      <div className="overflow-x-auto">
        <div
          className="sheet mx-auto bg-[#fff] text-[#1f2933] shadow-2xl relative"
          style={{ width: '297mm', height: '210mm', fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          <div className="absolute inset-[10mm] border-[3px] border-[#0b3a5c]" />
          <div className="absolute inset-[13mm] border border-[#0b3a5c]/40" />
          <div className="relative h-full flex flex-col items-center justify-between text-center px-[28mm] py-[24mm]">
            <div className="flex flex-col items-center gap-3">
              {cert.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cert.logoUrl} alt="" className="h-[18mm] w-auto object-contain" />
              )}
              <p style={{ fontFamily: '"Geist Variable", Arial, sans-serif' }} className="text-[11pt] tracking-[0.3em] uppercase text-[#0b3a5c]">
                {cert.organiser}
              </p>
            </div>

            <div className="space-y-[6mm]">
              <h1 className="text-[34pt] leading-tight text-[#0b3a5c]">{cert.title}</h1>
              <p className="text-[13pt] italic text-slate-500">This is to certify that</p>
              <p className="text-[30pt] font-bold leading-tight border-b border-slate-300 pb-[3mm] px-[10mm]">{cert.name}</p>
              <p className="text-[13pt] text-slate-600 max-w-[200mm] mx-auto">
                attended <span className="font-semibold text-[#1f2933]">{cert.eventTitle}</span>
                <br />
                {dateRange(cert.eventDate, cert.eventEndDate)} · {cert.location}
              </p>
              {cert.note && <p className="text-[12pt] text-[#0b3a5c] font-semibold">{cert.note}</p>}
            </div>

            <div className="w-full flex items-end justify-between" style={{ fontFamily: '"Geist Variable", Arial, sans-serif' }}>
              <div className="text-left text-[8pt] text-slate-400 leading-relaxed">
                Certificate ID: {cert.certificateId}
                {cert.attendedAt && (
                  <>
                    <br />
                    Checked in {longDate(cert.attendedAt)}
                  </>
                )}
                <br />
                Issued via Tixflow
              </div>
              {cert.signatory && (
                <div className="text-center min-w-[70mm]">
                  <div className="border-t border-slate-400 pt-[2mm] text-[11pt] text-[#1f2933]">{cert.signatory}</div>
                  {cert.signatoryTitle && <div className="text-[9pt] text-slate-500">{cert.signatoryTitle}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
