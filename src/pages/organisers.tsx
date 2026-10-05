// pages/organisers.tsx
//
// For event organisers: what Tixflow does, what it costs, and the gate
// gear we rent out. (Buyers land on / — the events listing.)
import Link from "next/link";
import Head from "next/head";
import type { GetStaticProps } from "next";
import { useState } from "react";
import { useRouter } from "next/router";
import { FEE_PERCENT, FREE_EVENT_PLANS, MIN_TICKET_FEE, PAID_EVENT_ROOMS, RENTAL_RATES } from "@/lib/plans";
import {
  TicketIcon,
  QrCodeIcon,
  BanknotesIcon,
  UserGroupIcon,
  ChartBarIcon,
  PhotoIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  ArrowRightIcon,
  TagIcon,
  DevicePhoneMobileIcon,
  CreditCardIcon,
  ArrowsRightLeftIcon,
} from "@heroicons/react/24/outline";

interface Pricing {
  feePercent: number;
  minFee: number;
  paidRooms: number;
  plans: { id: string; label: string; price: number; registrations: number | null; rooms: number; roomCapacity: number | null; extras: boolean }[];
  rental: { devicePerDay: number; staffPerDay: number };
}

const FEATURES = [
  {
    icon: TicketIcon,
    title: "Flexible Ticket Tiers",
    description:
      "Set up VIP, Early Bird, or General Admission tiers with their own price and capacity — for as many events as you run.",
  },
  {
    icon: QrCodeIcon,
    title: "Fast Door Check-In",
    description:
      "Scan tickets at the door and know instantly if a code is valid, already used, or fake — no spreadsheets, no guest-list chaos.",
  },
  {
    icon: BanknotesIcon,
    title: "Simple M-Pesa Payouts",
    description:
      "Buyers pay by M-Pesa STK Push. Request a payout to your own M-Pesa or bank whenever you're ready — you're in control of when you get paid.",
  },
  {
    icon: UserGroupIcon,
    title: "Staff Access",
    description:
      "Add door staff with scanner-only access, without handing out your admin login or your business dashboard.",
  },
  {
    icon: ChartBarIcon,
    title: "Real-Time Sales Data",
    description:
      "See tickets sold, revenue, and attendance for every event the moment it happens — not the morning after.",
  },
  {
    icon: PhotoIcon,
    title: "A Storefront That Looks Good",
    description:
      "A branded event page with your cover image and gallery — something you'd actually want to share.",
  },
  {
    icon: TagIcon,
    title: "Promo Codes & Promoters",
    description:
      "Codes like MUKURU that knock a set amount or % off, tied to promoters who earn commission on every sale they bring.",
  },
  {
    icon: CreditCardIcon,
    title: "M-Pesa, Cards & Lipa Pole Pole",
    description:
      "M-Pesa for locals, Visa/Mastercard for corporates and the diaspora, and pay-in-instalments to sell out earlier.",
  },
  {
    icon: DevicePhoneMobileIcon,
    title: "Box Office at the Gate",
    description:
      "Sell walk-ins at a door price, take cash or M-Pesa, print the ticket or send it by SMS, WhatsApp or email.",
  },
  {
    icon: ArrowsRightLeftIcon,
    title: "Re-entry Control",
    description:
      "Scan out, scan back in — you set how many re-entries a ticket gets, and copied tickets are caught at the gate.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Register your business",
    description:
      "Create your workspace in a couple of minutes — no paperwork, no approval wait.",
  },
  {
    step: "02",
    title: "Build your event",
    description:
      "Add details, images, and ticket tiers with pricing and capacity you control.",
  },
  {
    step: "03",
    title: "Share your event link",
    description:
      "Every event gets its own page you can share anywhere — socials, posters, WhatsApp.",
  },
  {
    step: "04",
    title: "Sell tickets, scan at the door, get paid",
    description:
      "Attendees buy by M-Pesa. You check them in with a scan. Request a payout to your M-Pesa or bank whenever you're ready.",
  },
];

const FAQS = [
  {
    q: "How do I get paid?",
    a: "You add your M-Pesa number or bank details once — buyer payments come to us via M-Pesa and we pay you out directly, no separate account to set up.",
  },
  {
    q: "How much does Tixflow cost?",
    a: "There's no monthly fee. On paid events we take a small fee per ticket sold — you choose whether buyers pay it on top or it comes out of your sales. Free events are free up to a limit, with affordable plans for bigger ones.",
  },
  {
    q: "Can you help at the gate on the day?",
    a: "Yes — rent our handheld scanners (with built-in receipt printers for the box office) and trained scanning staff by the day. Request them from your event's Plan & Gear page.",
  },
  {
    q: "Can I run more than one event?",
    a: "Yes — there's no limit on the number of events or ticket tiers under your account.",
  },
  {
    q: "What happens if I need to refund someone?",
    a: "Buyers request refunds from their ticket page. You approve or decline; approved tickets are cancelled, the seats go back on sale, and we send the money to the buyer's M-Pesa from your balance.",
  },
  {
    q: "Can my staff check people in without full account access?",
    a: "Yes — you can add staff accounts limited to check-in scanning only, separate from admin access to your events and payouts.",
  },
];

export default function OrganisersPage({ pricing }: { pricing: Pricing }) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    router.push(`/search?q=${encodeURIComponent(searchTerm)}`);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white antialiased selection:bg-white/20">
      <Head>
        <title>Tixflow for organisers — sell tickets, run the gate, get paid</title>
      </Head>
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800/40 bg-[#0B0F17]/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-mono font-bold uppercase tracking-widest">
            Tixflow
          </Link>
          <div className="flex items-center gap-6">
            {/* Secondary actions: Lookup & Search */}
            <div className="hidden sm:flex items-center gap-4 text-xs font-mono uppercase tracking-wider text-slate-400">
              <Link
                href="/lookup"
                className="hover:text-white transition flex items-center gap-1.5"
              >
                <TicketIcon className="w-4 h-4" />
                Lookup Tickets
              </Link>
              <span className="h-4 w-px bg-slate-700/50" />
              <Link
                href="/search"
                className="hover:text-white transition flex items-center gap-1.5"
              >
                <MagnifyingGlassIcon className="w-4 h-4" />
                Find Event
              </Link>
            </div>

            {/* Auth actions */}
            <div className="flex items-center gap-3">
              <Link
                href="/auth"
                className="text-xs font-mono uppercase tracking-wider text-slate-400 hover:text-white transition"
              >
                Log In
              </Link>
              <Link
                href="/auth"
                className="px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider bg-white text-black hover:bg-slate-200 transition"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-24 sm:pt-40 sm:pb-32 overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-white/[0.015] rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          {/* <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/30 border border-slate-700/20 text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
            Now in public beta
          </div> */}

          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight max-w-4xl mx-auto leading-[1.05]">
            Sell tickets.
            <br />
            <span className="text-slate-500">Manage events.</span>
            <br />
            Get paid.
          </h1>

          <p className="mt-8 text-slate-400 max-w-2xl mx-auto text-lg sm:text-xl leading-relaxed">
            Tixflow is everything you need to run ticketed events — your own
            storefront, flexible pricing tiers, door check-in, and direct
            payouts — without spreadsheets, printed lists, or a payment
            middleman.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/auth"
              className="group px-8 py-4 rounded-lg text-sm font-medium bg-white text-black hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
            >
              Start Selling Tickets — Free to Set Up
              <ArrowRightIcon className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/auth"
              className="px-8 py-4 rounded-lg text-sm font-medium border border-slate-700 text-white hover:bg-slate-800/60 transition-all"
            >
              Log In
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-600">
            No monthly fee. We only make money when you do.
          </p>

          {/* Secondary path for someone here to find an event */}
          <div className="mt-20 max-w-md mx-auto">
            <p className="text-[11px] font-mono uppercase tracking-widest text-slate-600 mb-3">
              Looking for an event instead?
            </p>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search events..."
                className="flex-1 bg-[#0E131F] border border-slate-800/80 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 transition"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-lg text-sm font-medium border border-slate-700 hover:bg-slate-800/60 transition"
              >
                Search
              </button>
            </form>
          </div>

          <div className="mt-6 text-center text-xs text-slate-500">
            <span>Already have tickets? </span>
            <Link
              href="/lookup"
              className="text-slate-300 hover:text-white underline underline-offset-2 transition"
            >
              Look them up
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative border-t border-slate-800/40 bg-[#080A10]">
        <div className="max-w-6xl mx-auto px-6 py-28">
          <div className="max-w-2xl mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Everything ticketing needs,
              <br />
              <span className="text-slate-600">nothing it doesn&apos;t</span>
            </h2>
            <p className="mt-4 text-slate-400 text-base leading-relaxed max-w-lg">
              Built for organizers who want to run events properly — not
              duct-tape a payment link and a guest list together.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="group relative p-8 bg-[#0E131F]/50 border border-slate-800/50 rounded-2xl hover:bg-[#0E131F] hover:border-slate-700/70 transition-all duration-300"
              >
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl bg-slate-800/50 border border-slate-700/30 flex items-center justify-center mb-5">
                    <feature.icon className="w-5 h-5 text-slate-300" />
                  </div>
                  <h3 className="text-base font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative border-t border-slate-800/40">
        <div className="max-w-5xl mx-auto px-6 py-28">
          <div className="text-center mb-20">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              From sign-up to sold out
            </h2>
            <p className="mt-4 text-slate-500">Four steps. No friction.</p>
          </div>

          <div className="relative">
            {/* Connecting line */}
            <div className="hidden lg:block absolute top-8 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent" />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
              {STEPS.map((step) => (
                <div
                  key={step.step}
                  className="relative text-center lg:text-left"
                >
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#0E131F] border border-slate-800/60 text-xl font-mono font-bold text-slate-600 mb-6">
                    {step.step}
                  </div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative border-t border-slate-800/40 bg-[#080A10]">
        <div className="max-w-5xl mx-auto px-6 py-28">
          <div className="text-center max-w-lg mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Simple, honest pricing
            </h2>
            <p className="mt-4 text-slate-500">
              No setup fee. No monthly subscription. Paid events pay per ticket
              sold; free events are free up to a generous limit.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 max-w-4xl mx-auto">
            <div className="relative p-8 bg-[#0E131F] border border-slate-700/60 rounded-2xl">
              <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Paid events</div>
              <div className="mt-3 text-5xl font-bold tracking-tight">{pricing.feePercent}%</div>
              <div className="text-sm text-slate-400 mt-1">
                per ticket sold · minimum KES {pricing.minFee} per ticket
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Pass it to buyers as a booking fee, or absorb it. Box-office cash sales too — deducted from your payout.
              </p>
              <ul className="mt-6 space-y-3 text-left">
                {[
                  "Unlimited events, tiers and promo codes",
                  `${pricing.paidRooms} Event Space rooms included (polls, Q&A, slides)`,
                  "Certificates & exhibitor lead scanning included",
                  "Gate check-in with re-entry, box office, offline scanning",
                  "M-Pesa and card payments, Lipa Pole Pole",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-300">
                    <CheckIcon className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative p-8 bg-[#0E131F] border border-slate-800/60 rounded-2xl">
              <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Free events</div>
              <p className="mt-3 text-sm text-slate-400">Free to run up to the limits below. Need more? Buy a plan for that event by M-Pesa or card.</p>
              <div className="mt-5 space-y-3">
                {pricing.plans.map((p) => (
                  <div key={p.id} className="p-4 rounded-xl border border-slate-800 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{p.label}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        {p.registrations === null ? "Unlimited" : p.registrations.toLocaleString()} registrations · {p.rooms} room
                        {p.rooms === 1 ? "" : "s"}
                        {p.roomCapacity ? ` (${p.roomCapacity} people each)` : ""}
                        {p.extras ? " · certificates & exhibitors" : ""}
                      </div>
                    </div>
                    <div className="text-sm font-mono font-semibold whitespace-nowrap">
                      {p.price === 0 ? "Free" : `KES ${p.price.toLocaleString()}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 max-w-4xl mx-auto p-8 bg-[#0E131F]/60 border border-slate-800/60 rounded-2xl grid gap-6 sm:grid-cols-3 items-center">
            <div className="sm:col-span-2">
              <div className="text-xs font-mono uppercase tracking-widest text-slate-500">On the day</div>
              <h3 className="mt-2 text-lg font-semibold">Rent our gate scanners and staff</h3>
              <p className="mt-2 text-sm text-slate-400">
                Handheld scanners with a built-in barcode reader and receipt printer — instant scans, offline mode, printed
                box-office tickets. Add trained Tixflow staff to run your gates.
              </p>
            </div>
            <div className="text-sm space-y-1 sm:text-right">
              <div>
                <span className="font-mono font-semibold">KES {pricing.rental.devicePerDay.toLocaleString()}</span>
                <span className="text-slate-500"> / scanner / day</span>
              </div>
              <div>
                <span className="font-mono font-semibold">KES {pricing.rental.staffPerDay.toLocaleString()}</span>
                <span className="text-slate-500"> / staff / day</span>
              </div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Link
              href="/auth"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-lg text-sm font-medium bg-white text-black hover:bg-slate-200 transition"
            >
              Get Started
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative border-t border-slate-800/40">
        <div className="max-w-3xl mx-auto px-6 py-28">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-16">
            Questions, answered
          </h2>
          <div className="space-y-4">
            {FAQS.map((faq) => (
              <div
                key={faq.q}
                className="p-6 bg-[#0E131F]/40 border border-slate-800/40 rounded-2xl hover:border-slate-700/50 transition-colors"
              >
                <h3 className="text-sm font-semibold">{faq.q}</h3>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-t border-slate-800/40 bg-[#080A10] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-6 py-28 text-center">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto leading-tight">
            Your next event deserves better than a group chat and a cash box
          </h2>
          <Link
            href="/auth"
            className="mt-10 inline-flex items-center gap-2 px-8 py-4 rounded-lg text-sm font-medium bg-white text-black hover:bg-slate-200 transition"
          >
            Start Selling Tickets
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/40">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs font-mono uppercase tracking-widest text-slate-600">
            &copy; {new Date().getFullYear()} Tixflow
          </span>
          <div className="flex gap-6 text-xs font-mono uppercase tracking-wider text-slate-500">
            <Link href="/lookup" className="hover:text-white transition">
              Lookup Tickets
            </Link>
            <Link href="/search" className="hover:text-white transition">
              Find an Event
            </Link>
            <Link href="/auth" className="hover:text-white transition">
              Log In
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export const getStaticProps: GetStaticProps = async () => ({
  props: {
    pricing: {
      feePercent: FEE_PERCENT(),
      minFee: MIN_TICKET_FEE(),
      paidRooms: PAID_EVENT_ROOMS,
      plans: Object.entries(FREE_EVENT_PLANS).map(([id, p]) => ({ id, ...p })),
      rental: RENTAL_RATES,
    } satisfies Pricing,
  },
  revalidate: 3600,
});
