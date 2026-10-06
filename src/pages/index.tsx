// pages/index.tsx
//
// The front door for ticket buyers: what's on, search, categories, and
// finding tickets you already have. Organisers get a band pointing to
// /organisers (what Tixflow offers them) and sign-up.
import { useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ArrowRightIcon, CheckIcon, MagnifyingGlassIcon, TicketIcon } from "@heroicons/react/24/outline";
import { listUpcomingCategories, listUpcomingEvents } from "@/lib/publicQueries";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

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

const NAIROBI = { timeZone: "Africa/Nairobi" } as const;
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-KE", { ...NAIROBI, weekday: "short", day: "numeric", month: "short" });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-KE", { ...NAIROBI, hour: "2-digit", minute: "2-digit", hour12: false });

const priceLabel = (e: EventCard) =>
  e.soldOut ? "Sold out" : e.fromPrice === null ? "" : e.fromPrice === 0 ? "Free" : `From KES ${e.fromPrice.toLocaleString()}`;

function Cover({ event, className = "" }: { event: EventCard; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[#131924] ${className}`}>
      {event.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.coverImageUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <TicketIcon className="w-10 h-10 text-slate-700" />
        </div>
      )}
    </div>
  );
}

function Meta({ event }: { event: EventCard }) {
  return (
    <p className="text-sm text-slate-400">
      <span className="text-slate-200">{dayLabel(event.date)}</span>
      <span className="text-slate-600"> · </span>
      {timeLabel(event.date)}
      <span className="text-slate-600"> · </span>
      {event.location}
    </p>
  );
}

function Price({ event }: { event: EventCard }) {
  const label = priceLabel(event);
  if (!label) return null;
  return <span className={`text-sm font-medium tabular-nums ${event.soldOut ? "text-rose-400" : "text-slate-100"}`}>{label}</span>;
}

function FeaturedEvent({ event }: { event: EventCard }) {
  return (
    <Link
      href={`/${event.tenant.slug}/${event.slug}`}
      className="group grid md:grid-cols-[1.35fr_1fr] rounded-2xl overflow-hidden border border-slate-800/70 bg-[#0E131F] hover:border-slate-700 transition-colors"
    >
      <Cover event={event} className="aspect-[16/10] md:aspect-auto md:min-h-[340px]" />
      <div className="p-6 sm:p-8 flex flex-col">
        {event.category && <span className="text-sm text-slate-500">{event.category}</span>}
        <h3 className="mt-2 font-display text-3xl sm:text-[2.5rem] leading-[1.05] font-semibold text-white">{event.title}</h3>
        <div className="mt-4">
          <Meta event={event} />
        </div>
        <p className="mt-1 text-sm text-slate-500">by {event.tenant.businessName}</p>
        <div className="mt-auto pt-8 flex items-center justify-between gap-4">
          <Price event={event} />
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white">
            Get tickets
            <ArrowRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function EventTile({ event }: { event: EventCard }) {
  return (
    <Link href={`/${event.tenant.slug}/${event.slug}`} className="group block">
      <Cover event={event} className="aspect-[16/10] rounded-xl border border-slate-800/70" />
      <div className="pt-4 space-y-1.5">
        <h3 className="font-display text-xl leading-snug font-semibold text-white group-hover:text-slate-200 line-clamp-2">
          {event.title}
        </h3>
        <Meta event={event} />
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-slate-500 truncate">{event.tenant.businessName}</span>
          <Price event={event} />
        </div>
      </div>
    </Link>
  );
}

export default function Home({ events, categories, category }: Props) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [featured, ...rest] = events;

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (term.trim()) router.push(`/search?q=${encodeURIComponent(term.trim())}`);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <Head>
        <title>Tixflow — events and tickets in Kenya</title>
        <meta name="description" content="Find concerts, conferences, parties and more. Pay with M-Pesa or card and get your ticket instantly." />
      </Head>

      <SiteHeader />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-10">
        <h1 className="font-display text-[3.25rem] sm:text-7xl lg:text-[5.5rem] leading-[0.95] font-semibold max-w-4xl">
          What&apos;s on. <span className="text-slate-500">Get in.</span>
        </h1>
        <p className="mt-6 text-lg text-slate-400 max-w-xl">
          Concerts, conferences, parties and more. Pay with M-Pesa or card — your ticket arrives instantly by email,
          WhatsApp or SMS.
        </p>

        <form onSubmit={search} className="mt-10 max-w-2xl" role="search">
          <label htmlFor="event-search" className="sr-only">
            Search events
          </label>
          <div className="flex items-center gap-2 h-14 pl-5 pr-2 rounded-2xl bg-[#0E131F] border border-slate-800 focus-within:border-slate-500 transition-colors">
            <MagnifyingGlassIcon className="w-5 h-5 text-slate-500 shrink-0" />
            <input
              id="event-search"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search events, venues, organisers"
              className="flex-1 min-w-0 bg-transparent text-base text-white focus:outline-none"
            />
            <button type="submit" className="h-10 px-5 rounded-xl text-sm font-medium bg-slate-100 text-[#0B0F17] hover:bg-white transition-colors">
              Search
            </button>
          </div>
        </form>

        {categories.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Categories">
            {[null, ...categories].map((c) => {
              const active = c === null ? !category : category?.toLowerCase() === c.toLowerCase();
              return (
                <Link
                  key={c ?? "all"}
                  href={c === null ? "/" : `/?category=${encodeURIComponent(c)}`}
                  aria-current={active ? "page" : undefined}
                  className={`h-9 px-4 inline-flex items-center rounded-full text-sm transition-colors ${
                    active
                      ? "bg-slate-100 text-[#0B0F17] font-medium"
                      : "border border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white"
                  }`}
                >
                  {c ?? "All events"}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" aria-labelledby="upcoming">
        <div className="flex items-baseline justify-between gap-4 mb-6">
          <h2 id="upcoming" className="font-display text-2xl font-semibold">
            {category ? `${category}` : "Coming up"}
          </h2>
          <span className="text-sm text-slate-500 tabular-nums">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>

        {!featured ? (
          <div className="py-20 rounded-2xl border border-dashed border-slate-800 text-center">
            <p className="text-slate-300">{category ? "Nothing in this category right now." : "No upcoming events yet."}</p>
            <p className="mt-1 text-sm text-slate-500">
              {category ? (
                <Link href="/" className="underline hover:text-white">
                  See all events
                </Link>
              ) : (
                "Check back soon — new events are added every week."
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            <FeaturedEvent event={featured} />
            {rest.length > 0 && (
              <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((e) => (
                  <EventTile key={`${e.tenant.slug}/${e.slug}`} event={e} />
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-14 text-sm text-slate-500">
          Already bought a ticket?{" "}
          <Link href="/lookup" className="text-slate-200 underline hover:text-white">
            Find it with your email
          </Link>
          .
        </p>
      </section>

      <section className="border-t border-slate-800/60 bg-[#080A10]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid gap-12 lg:grid-cols-[1.1fr_1fr] items-center">
          <div>
            <h2 className="font-display text-4xl sm:text-5xl leading-[1.02] font-semibold">Running an event? Sell on Tixflow.</h2>
            <p className="mt-5 text-lg text-slate-400 max-w-lg">
              Your own event page, M-Pesa and card payments, promo codes and promoters, a box office and fast gate
              scanning with re-entry — plus scanners and staff to hire for the day. No monthly fee.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/auth"
                className="h-12 px-6 inline-flex items-center gap-2 rounded-xl text-sm font-medium bg-slate-100 text-[#0B0F17] hover:bg-white transition-colors"
              >
                Create your event
                <ArrowRightIcon className="w-4 h-4" />
              </Link>
              <Link
                href="/organisers"
                className="h-12 px-6 inline-flex items-center rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800/50 transition-colors"
              >
                Features &amp; pricing
              </Link>
            </div>
          </div>
          <ul className="divide-y divide-slate-800/70 border-y border-slate-800/70">
            {[
              ["Live in minutes", "Create the event, set ticket types and door prices, share the link."],
              ["Paid instantly", "Buyers pay by M-Pesa or card; withdraw to M-Pesa or bank."],
              ["A gate that keeps up", "Scan in and out, catch copied tickets, keep going offline."],
            ].map(([title, text]) => (
              <li key={title} className="py-5 flex gap-4">
                <CheckIcon className="w-5 h-5 mt-0.5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-medium text-white">{title}</div>
                  <div className="mt-1 text-sm text-slate-400">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooter />
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
