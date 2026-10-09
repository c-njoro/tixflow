// pages/promoter/[token].tsx
//
// A promoter's own page: their selling links and what they've earned.
// Reached by the secret link the organiser shares — no account needed.
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { cardClass, labelClass } from '@/lib/ui';

interface PromoterPage {
  name: string;
  code: string;
  isActive: boolean;
  organiser: string;
  commission: { type: 'percent' | 'fixed'; value: number };
  stats: { tickets: number; sales: number; earned: number; paid: number; owed: number };
  links: { title: string; date: string; url: string }[];
  storefrontUrl: string | null;
  byEvent: { title: string; orders: number; commission: number }[];
  recent: { at: string; event: string; tickets: number; commission: number }[];
}

const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short' });


export default function PromoterStatsPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : undefined;
  const [data, setData] = useState<PromoterPage | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/promoters/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'This link is not valid.');
        setData(result.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'This link is not valid.'));
  }, [token]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(''), 2000);
    } catch {}
  };

  const share = (url: string, title: string) =>
    `https://wa.me/?text=${encodeURIComponent(`Get your tickets for ${title}: ${url}`)}`;

  return (
    <div className="min-h-screen bg-ink text-slate-100">
      <Head>
        <title>{data ? `${data.name} · Promoter` : 'Promoter · Tixflow'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="max-w-2xl mx-auto px-4 py-10 space-y-5">
        {error ? (
          <p className="text-center text-sm text-slate-400 pt-20">{error}</p>
        ) : !data ? (
          <p className="text-center text-xs uppercase tracking-[0.08em] text-slate-500 pt-20 font-medium">Loading...</p>
        ) : (
          <>
            <div>
              <p className={labelClass}>Promoter for {data.organiser}</p>
              <h1 className="font-display text-2xl font-semibold mt-1">{data.name}</h1>
              <p className="text-sm text-slate-400 mt-1">
                You earn {data.commission.type === 'percent' ? `${data.commission.value}% of every sale` : `${kes(data.commission.value)} per ticket`} made
                through your links.
              </p>
              {!data.isActive && (
                <p className="mt-3 p-3 rounded-md border border-amber-800/50 bg-amber-950/20 text-sm text-amber-300">
                  Your links are paused — new sales aren&apos;t being credited. Contact {data.organiser}.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={cardClass}>
                <p className={labelClass}>Tickets sold</p>
                <p className="text-3xl font-semibold mt-1">{data.stats.tickets}</p>
              </div>
              <div className={cardClass}>
                <p className={labelClass}>Earned</p>
                <p className="text-3xl font-semibold mt-1">{kes(data.stats.earned)}</p>
              </div>
              <div className={cardClass}>
                <p className={labelClass}>Paid to you</p>
                <p className="text-xl font-semibold mt-1">{kes(data.stats.paid)}</p>
              </div>
              <div className={cardClass}>
                <p className={labelClass}>Still owed</p>
                <p className="text-xl font-semibold mt-1">{kes(data.stats.owed)}</p>
              </div>
            </div>

            <div className={`${cardClass} space-y-3`}>
              <h2 className={labelClass}>Your links</h2>
              {data.storefrontUrl && (
                <LinkRow
                  title={`All ${data.organiser} events`}
                  url={data.storefrontUrl}
                  copied={copied === data.storefrontUrl}
                  onCopy={copy}
                  whatsapp={share(data.storefrontUrl, data.organiser)}
                />
              )}
              {data.links.length === 0 && !data.storefrontUrl ? (
                <p className="text-sm text-slate-500">No events on sale right now.</p>
              ) : (
                data.links.map((l) => (
                  <LinkRow
                    key={l.url}
                    title={`${l.title} · ${date(l.date)}`}
                    url={l.url}
                    copied={copied === l.url}
                    onCopy={copy}
                    whatsapp={share(l.url, l.title)}
                  />
                ))
              )}
            </div>

            {data.recent.length > 0 && (
              <div className={`${cardClass} space-y-2`}>
                <h2 className={labelClass}>Recent sales</h2>
                <table className="w-full text-sm">
                  <tbody>
                    {data.recent.map((r, i) => (
                      <tr key={i} className="border-t border-slate-800/80 first:border-0">
                        <td className="py-2 text-slate-400 tabular-nums">{date(r.at)}</td>
                        <td className="py-2 text-slate-200">{r.event}</td>
                        <td className="py-2 text-slate-400 text-right">
                          {r.tickets} {r.tickets === 1 ? 'ticket' : 'tickets'}
                        </td>
                        <td className="py-2 text-white text-right">{kes(r.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-600 text-center">Keep this page&apos;s link private — it shows your earnings.</p>
          </>
        )}
      </main>
    </div>
  );
}

function LinkRow({
  title,
  url,
  copied,
  onCopy,
  whatsapp,
}: {
  title: string;
  url: string;
  copied: boolean;
  onCopy: (url: string) => void;
  whatsapp: string;
}) {
  return (
    <div className="p-3 rounded-lg border border-slate-800 space-y-2">
      <p className="text-sm text-white">{title}</p>
      <code className="block text-xs text-slate-400 break-all">{url}</code>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onCopy(url)}
          className="px-3 py-1.5 text-[13px] border border-slate-700 rounded-md text-slate-300 hover:text-white font-medium"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 text-[13px] rounded-md bg-emerald-600 text-[#fff] hover:bg-emerald-500 font-medium"
        >
          Share on WhatsApp
        </a>
      </div>
    </div>
  );
}
