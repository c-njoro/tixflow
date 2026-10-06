// pages/dashboard/events/[id]/certificates.tsx
//
// Certificates of attendance for scanned-in attendees: what they say, a
// preview, and sending them out.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

interface Settings {
  certificatesEnabled: boolean;
  certificateTitle: string | null;
  certificateSignatory: string | null;
  certificateSignatoryTitle: string | null;
  certificateNote: string | null;
  certificatesSentAt: string | null;
  eligible: number;
  previewUrl: string | null;
}


const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });

export default function CertificatesPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState({ certificateTitle: '', certificateSignatory: '', certificateSignatoryTitle: '', certificateNote: '' });
  const [eventTitle, setEventTitle] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (s: Settings) => {
    setSettings(s);
    setForm({
      certificateTitle: s.certificateTitle || '',
      certificateSignatory: s.certificateSignatory || '',
      certificateSignatoryTitle: s.certificateSignatoryTitle || '',
      certificateNote: s.certificateNote || '',
    });
  };

  const request = useCallback(
    async (method: string, body?: unknown) => {
      const res = await fetch(`/api/events/${id}/certificates`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      return result.data;
    },
    [id]
  );

  useEffect(() => {
    if (!id) return;
    request('GET')
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'));
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id, request]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Certificates</h1>
          <p className="text-sm text-slate-400 mt-1">{eventTitle || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}`} className={buttonClass}>
            Back to Event
          </Link>
        )}
      </div>

      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {notice && <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">{notice}</div>}

      {settings && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className={`${cardClass} space-y-4 lg:col-span-2`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-lg">
                <h2 className="text-sm font-semibold text-white">Certificates of attendance</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Everyone whose ticket was scanned in can download a certificate with their name, the event and the date —
                  useful for CPD points and professional bodies. They can fix the name it shows before printing.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => apply(await request('PATCH', { certificatesEnabled: !settings.certificatesEnabled })))}
                className={`px-4 py-2 text-[13px] rounded-md border ${
                  settings.certificatesEnabled ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50' : 'border-slate-700 text-slate-300'
                } font-medium`}
              >
                {settings.certificatesEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Title</label>
                <input value={form.certificateTitle} onChange={(e) => setForm({ ...form, certificateTitle: e.target.value })} placeholder="Certificate of Attendance" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label className={labelClass}>Note (optional)</label>
                <input value={form.certificateNote} onChange={(e) => setForm({ ...form, certificateNote: e.target.value })} placeholder="Awarded 6 CPD points" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label className={labelClass}>Signed by (optional)</label>
                <input value={form.certificateSignatory} onChange={(e) => setForm({ ...form, certificateSignatory: e.target.value })} placeholder="Jane Wambui" className={`${inputClass} mt-1`} />
              </div>
              <div>
                <label className={labelClass}>Their title</label>
                <input value={form.certificateSignatoryTitle} onChange={(e) => setForm({ ...form, certificateSignatoryTitle: e.target.value })} placeholder="Conference Chair" className={`${inputClass} mt-1`} />
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(async () => {
                apply(await request('PATCH', form));
                setNotice('Saved.');
              })}
              className={primaryButtonClass}
            >
              Save
            </button>
          </div>

          <div className={`${cardClass} space-y-4`}>
            <div>
              <p className={labelClass}>Attendees who qualify</p>
              <p className="text-3xl font-semibold text-white mt-2">{settings.eligible}</p>
              <p className="text-xs text-slate-500 mt-1">tickets scanned in</p>
            </div>
            {settings.previewUrl && (
              <a href={settings.previewUrl} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-block`}>
                Preview a certificate ↗
              </a>
            )}
            {settings.certificatesSentAt ? (
              <p className="text-sm text-slate-300">Sent {when(settings.certificatesSentAt)}.</p>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || !settings.certificatesEnabled || settings.eligible === 0}
                  onClick={() => {
                    if (confirm(`Email and WhatsApp certificates to ${settings.eligible} attendees now?`)) {
                      run(async () => {
                        await request('POST');
                        setNotice('Sending certificates — this takes a few seconds per person.');
                        apply(await request('GET'));
                      });
                    }
                  }}
                  className={primaryButtonClass}
                >
                  Send certificates
                </button>
                <p className="text-[11px] text-slate-500">
                  If a feedback survey is set up, certificates go out with it automatically instead.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
