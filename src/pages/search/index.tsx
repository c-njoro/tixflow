// pages/search.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { SiteHeader } from "@/components/site/SiteChrome";

interface SearchResult {
  slug: string;
  title: string;
  date: string;
  location: string;
  category: string | null;
  coverImageUrl: string | null;
  tenant: { slug: string; businessName: string };
}

export default function SearchPage() {
  const router = useRouter();
  const initialQ = typeof router.query.q === 'string' ? router.query.q : '';

  const [term, setTerm] = useState(initialQ);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/public/search?q=${encodeURIComponent(q)}`);
      const result = await res.json();
      setResults(result.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQ) runSearch(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(term)}`, undefined, { shallow: true });
    runSearch(term);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <SiteHeader />

      <main className="max-w-2xl mx-auto p-6 space-y-6">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search events by name, category, or location..."
            className="flex-1 bg-[#0E131F] border border-slate-800 rounded-md px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition"
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded-md text-sm font-medium bg-white text-black hover:bg-slate-200 transition"
          >
            Search
          </button>
        </form>

        {loading ? (
          <div className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">
            Searching...
          </div>
        ) : searched && results.length === 0 ? (
          <p className="text-sm text-slate-500">
            No upcoming events match &ldquo;{initialQ || term}&rdquo;.
          </p>
        ) : (
          <div className="space-y-3">
            {results.map((event) => (
              <Link
                key={`${event.tenant.slug}-${event.slug}`}
                href={`/${event.tenant.slug}/${event.slug}`}
                className="flex gap-4 p-4 border border-slate-800/80 rounded-xl hover:border-slate-600 transition"
              >
                {event.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={event.coverImageUrl}
                    alt={event.title}
                    className="w-20 h-20 object-cover rounded-lg shrink-0"
                  />
                )}
                <div>
                  {event.category && (
                    <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500 mb-1 font-medium">
                      {event.category}
                    </div>
                  )}
                  <div className="text-sm font-semibold">{event.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {new Date(event.date).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} &middot; {event.location}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">by {event.tenant.businessName}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}