// pages/index.tsx
//
// The front door for ticket buyers: what's on, search, categories, and
// finding tickets you already have. Organisers get a section pointing to
// /organisers (what Tixflow offers them) and sign-up.
import { useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  ArrowRightIcon,
  CalendarIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  TicketIcon,
} from "@heroicons/react/24/outline";
import { listUpcomingCategories, listUpcomingEvents } from "@/lib/publicQueries";

interface EventCard {
  slug: string;
  title: string;
  date: string;
  location: string;
  category: string | null;
  coverImageUrl: string | null;
  tenant: { slug: string; businessName: string };
  fromPrice: number | null;
  soldOut: boolean;
}

interface Props {
  events: EventCard[];
  categories: string[];
  category: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const priceLabel = (e: EventCard) =>
  e.soldOut ? "Sold out" : e.fromPrice === null ? "" : e.fromPrice === 0 ? "Free" : `From KES ${e.fromPrice.toLocaleString()}`;

export default function Home({ events, categories, category }: Props) {
  const router = useRouter();
  const [term, setTerm] = useState("");

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (term.trim()) router.push(`/search?q=${encodeURIComponent(term.trim())}`);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white antialiased selection:bg-white/20">
      <Head>
        <title>Tixflow — events and tickets in Kenya</title>
        <meta name="description" content="Find concerts, conferences, parties and more. Pay with M-Pesa or card and get your ticket instantly." />
      </Head>

      <header className="sticky top-0 z-40 border-b border-slate-800/40 bg-[#0B0F17]/85 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-mono font-bold uppercase tracking-widest">
            Tixflow
          </Link>
          <nav className="flex items-center gap-4 sm:gap-6 text-xs font-mono uppercase tracking-wider text-slate-400">
            <Link href="/lookup" className="hover:text-white transition flex items-center gap-1.5">
              <TicketIcon className="w-4 h-4" />
              <span className="hidden sm:inline">My tickets</span>
            </Link>
            <Link href="/organisers" className="hover:text-white transition">
              For organisers
            </Link>
            <Link href="/auth" className="hidden sm:inline hover:text-white transition">
              Log in
            </Link>
          </nav>
        </div>
      </header>

      {/* Search */}
      <section className="relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-white/[0.02] rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-10 sm:pt-20">
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-3xl leading-[1.05]">
            What&apos;s on.
            <span className="text-slate-500"> Get in.</span>
          </h1>
          <p className="mt-4 text-slate-400 max-w-xl">
            Concerts, conferences, parties and more. Pay with M-Pesa or card — your ticket arrives instantly by email,
            WhatsApp or SMS.
          </p>
          <form onSubmit={search} className="mt-8 flex gap-2 max-w-xl">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="w-4 h-4 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search events, venues, organisers…"
                className="w-full bg-[#0E131F] border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 transition"
              />
            </div>
            <button type="submit" className="px-5 rounded-xl text-sm font-medium bg-white text-black hover:bg-slate-200 transition">
              Search
            </button>
          </form>

          {categories.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/"
                className={`px-3 py-1.5 rounded-full text-xs border transition ${
                  !category ? "bg-white text-black border-white" : "border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                All
              </Link>
              {categories.map((c) => (
                <Link
                  key={c}
                  href={`/?category=${encodeURIComponent(c)}`}
                  className={`px-3 py-1.5 rounded-full text-xs border transition ${
                    category?.toLowerCase() === c.toLowerCase()
                      ? "bg-white text-black border-white"
                      : "border-slate-700 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {c}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Events */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4">
          {category ? `${category} · upcoming` : "Upcoming events"}
        </h2>
        {events.length === 0 ? (
          <div className="p-10 border border-dashed border-slate-800 rounded-2xl text-center text-sm text-slate-500">
            {category ? "Nothing in this category right now." : "No upcoming events yet — check back soon."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <Link
                key={`${e.tenant.slug}/${e.slug}`}
                href={`/${e.tenant.slug}/${e.slug}`}
                className="group block rounded-2xl overflow-hidden bg-[#0E131F] border border-slate-800/60 hover:border-slate-600 transition"
              >
                <div className="relative aspect-[16/9] bg-slate-900">
                  {e.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={e.coverImageUrl}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <TicketIcon className="w-10 h-10 text-slate-700" />
                    </div>
                  )}
                  {priceLabel(e) && (
                    <span
                      className={`absolute top-3 right-3 px-2.5 py-1 rounded-md text-[11px] font-mono backdrop-blur ${
                        e.soldOut ? "bg-rose-950/80 text-rose-300" : "bg-black/70 text-white"
                      }`}
                    >
                      {priceLabel(e)}
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-1.5">
                  {e.category && (
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{e.category}</div>
                  )}
                  <div className="text-base font-semibold leading-snug line-clamp-2">{e.title}</div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                    {when(e.date)}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <MapPinIcon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{e.location}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 pt-1">by {e.tenant.businessName}</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 text-sm text-slate-500">
          Already bought a ticket?{" "}
          <Link href="/lookup" className="text-slate-300 underline underline-offset-2 hover:text-white">
            Find it here
          </Link>
          .
        </div>
      </section>

      {/* For organisers */}
      <section className="border-t border-slate-800/40 bg-[#080A10]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid gap-8 lg:grid-cols-2 items-center">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-slate-500">For organisers</div>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Running an event? Sell on Tixflow.</h2>
            <p className="mt-4 text-slate-400 max-w-lg">
              Your own event page, M-Pesa and card payments, promo codes and promoters, a box office and fast gate
              scanning with re-entry — plus scanners and staff to hire for the day. No monthly fee.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/auth"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium bg-white text-black hover:bg-slate-200 transition"
              >
                Create your event
                <ArrowRightIcon className="w-4 h-4" />
              </Link>
              <Link
                href="/organisers"
                className="px-6 py-3 rounded-lg text-sm font-medium border border-slate-700 hover:bg-slate-800/60 transition"
              >
                See features &amp; pricing
              </Link>
            </div>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              ["01", "Sign up", "Create your workspace in a couple of minutes."],
              ["02", "Create the event", "Ticket types, door prices, re-entry rules."],
              ["03", "Share the link", "Socials, posters, WhatsApp, promoters."],
              ["04", "Scan & get paid", "Check people in, withdraw to M-Pesa or bank."],
            ].map(([n, title, text]) => (
              <li key={n} className="p-5 rounded-2xl bg-[#0E131F] border border-slate-800/60">
                <div className="text-xs font-mono text-slate-600">{n}</div>
                <div className="mt-2 text-sm font-semibold">{title}</div>
                <div className="mt-1 text-xs text-slate-400">{text}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t border-slate-800/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs font-mono uppercase tracking-widest text-slate-600">&copy; {new Date().getFullYear()} Tixflow</span>
          <div className="flex gap-6 text-xs font-mono uppercase tracking-wider text-slate-500">
            <Link href="/lookup" className="hover:text-white transition">
              My tickets
            </Link>
            <Link href="/organisers" className="hover:text-white transition">
              For organisers
            </Link>
            <Link href="/auth" className="hover:text-white transition">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query, res }) => {
  const category = typeof query.category === "string" && query.category.trim() ? query.category.trim().slice(0, 60) : null;
  const [events, categories] = await Promise.all([
    listUpcomingEvents({ category: category ?? undefined }),
    listUpcomingCategories(),
  ]);
  // A short shared cache: the listing doesn't need to be to-the-second.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return { props: JSON.parse(JSON.stringify({ events, categories, category })) };
};
