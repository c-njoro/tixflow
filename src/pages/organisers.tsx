// pages/organisers.tsx
//
// For event organisers: what Tixflow does, what it costs, and the gate
// gear we rent out. (Buyers land on / — the events listing.)
import Link from "next/link";
import Head from "next/head";
import type { GetStaticProps } from "next";
import { ArrowRightIcon, CheckIcon, PlusIcon } from "@heroicons/react/24/outline";
import { FEE_PERCENT, FREE_EVENT_PLANS, MIN_TICKET_FEE, PAID_EVENT_ROOMS, RENTAL_RATES } from "@/lib/plans";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

interface Pricing {
  feePercent: number;
  minFee: number;
  paidRooms: number;
  plans: { id: string; label: string; price: number; registrations: number | null; rooms: number; roomCapacity: number | null; extras: boolean }[];
  rental: { devicePerDay: number; staffPerDay: number };
}

// What organisers get, grouped by the job it does for them.
const CAPABILITIES: { heading: string; summary: string; items: { title: string; text: string }[] }[] = [
  {
    heading: "Sell",
    summary: "Everything between “we're doing an event” and a sold-out list.",
    items: [
      { title: "Ticket tiers", text: "Early Bird, VIP, tables — each with its own price, capacity and door price." },
      { title: "A page worth sharing", text: "Your event page with cover, gallery and checkout, ready for socials and WhatsApp." },
      { title: "Promo codes & promoters", text: "Codes like MUKURU for a set amount or % off, tied to promoters who earn commission." },
      { title: "M-Pesa, cards & Lipa Pole Pole", text: "STK push for locals, Visa/Mastercard for corporates and the diaspora, instalments to sell out earlier." },
    ],
  },
  {
    heading: "Run the gate",
    summary: "Fast, honest check-in, even when the network isn't.",
    items: [
      { title: "Scan in seconds", text: "Phone camera or handheld scanner. Valid, used or fake — you know instantly." },
      { title: "Re-entry control", text: "Scan out, scan back in. You set how many re-entries a ticket gets; copied tickets are caught." },
      { title: "Box office", text: "Sell walk-ins at the door price for cash or M-Pesa, then print or SMS the ticket." },
      { title: "Staff access", text: "Gate staff get scanner-only accounts — never your admin login or payouts." },
    ],
  },
  {
    heading: "Get paid",
    summary: "Your money, your schedule, every shilling accounted for.",
    items: [
      { title: "Payouts on request", text: "Withdraw to your M-Pesa or bank whenever you're ready." },
      { title: "Live sales", text: "Tickets sold, revenue and arrivals the moment they happen — not the morning after." },
      { title: "Refunds handled", text: "Approve a buyer's request; the seats go back on sale and we send the refund." },
    ],
  },
];

const STEPS = [
  { title: "Register your business", text: "Create your workspace in a couple of minutes — no paperwork, no approval wait." },
  { title: "Build your event", text: "Details, images, ticket types, door prices and re-entry rules." },
  { title: "Share your link", text: "Socials, posters, WhatsApp, promoters — every sale is tracked." },
  { title: "Sell, scan, get paid", text: "Check people in with a scan and request a payout whenever you're ready." },
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

const kes = (n: number) => `KES ${n.toLocaleString()}`;

export default function OrganisersPage({ pricing }: { pricing: Pricing }) {
  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <Head>
        <title>Tixflow for organisers — sell tickets, run the gate, get paid</title>
        <meta
          name="description"
          content="Ticketing for Kenyan events: M-Pesa and card checkout, promo codes, box office, re-entry scanning and payouts. No monthly fee."
        />
      </Head>

      <SiteHeader cta="buyer" />

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20">
        <h1 className="font-display text-[3.25rem] sm:text-7xl lg:text-[5.75rem] leading-[0.94] font-semibold max-w-5xl">
          Sell tickets. <span className="text-slate-500">Run the gate.</span> Get paid.
        </h1>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <p className="text-lg sm:text-xl text-slate-400 max-w-2xl leading-relaxed">
            Tixflow is everything you need to run ticketed events in Kenya — your own event page, M-Pesa and card
            checkout, promo codes, a box office and gate scanning — without spreadsheets, printed lists or a payment
            middleman.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/auth"
              className="h-12 px-6 inline-flex items-center gap-2 rounded-xl text-sm font-medium bg-slate-100 text-[#0B0F17] hover:bg-white transition-colors"
            >
              Start selling — free to set up
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
            <Link
              href="#pricing"
              className="h-12 px-6 inline-flex items-center rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800/50 transition-colors"
            >
              See pricing
            </Link>
          </div>
        </div>
        <p className="mt-6 text-sm text-slate-500">No monthly fee. We only make money when you do.</p>
      </section>

      {/* Capabilities */}
      <section className="border-t border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {CAPABILITIES.map((group) => (
            <div key={group.heading} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] py-16 border-b border-slate-800/60 last:border-b-0">
              <div className="lg:sticky lg:top-24 self-start">
                <h2 className="font-display text-4xl font-semibold">{group.heading}</h2>
                <p className="mt-3 text-slate-400 max-w-xs">{group.summary}</p>
              </div>
              <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
                {group.items.map((item) => (
                  <div key={item.title} className="border-t border-slate-800/70 pt-5">
                    <dt className="font-medium text-white">{item.title}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-slate-400">{item.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-800/60 bg-[#080A10]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className="font-display text-4xl sm:text-5xl font-semibold max-w-xl leading-[1.02]">From sign-up to sold out</h2>
          <ol className="mt-12 grid gap-px bg-slate-800/70 rounded-2xl overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="bg-[#080A10] p-6">
                <span className="text-sm text-slate-500 tabular-nums">Step {i + 1}</span>
                <div className="mt-6 font-medium text-white">{step.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-slate-800/60 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-4xl sm:text-5xl font-semibold leading-[1.02]">Simple, honest pricing</h2>
            <p className="mt-4 text-lg text-slate-400">
              No setup fee. No subscription. Paid events pay per ticket sold; free events are free up to a generous limit.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
            <div className="rounded-2xl border border-slate-700/70 bg-[#0E131F] p-8 flex flex-col">
              <h3 className="text-sm font-medium text-slate-400">Paid events</h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-6xl font-semibold tabular-nums">{pricing.feePercent}%</span>
                <span className="text-slate-400">per ticket</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">Minimum {kes(pricing.minFee)} a ticket.</p>
              <p className="mt-4 text-sm text-slate-500 leading-relaxed">
                Pass it to buyers as a booking fee, or absorb it. Box-office cash sales too — deducted from your payout.
                Free tickets and comps on a paid event count towards the free-event plans below (the first{' '}
                {pricing.plans[0].registrations?.toLocaleString()} are included).
              </p>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  "Unlimited events, ticket types and promo codes",
                  `${pricing.paidRooms} Event Space rooms (polls, Q&A, slides)`,
                  "Certificates and exhibitor lead scanning",
                  "Gate scanning with re-entry, box office, offline mode",
                  "M-Pesa, cards and Lipa Pole Pole",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-slate-300">
                    <CheckIcon className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-800/70 p-8">
              <h3 className="text-sm font-medium text-slate-400">Free events</h3>
              <p className="mt-4 text-slate-300">
                Free to run up to the limits below. Need more? Buy a plan for that event by M-Pesa or card.
              </p>
              <table className="mt-6 w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="font-normal pb-3">Plan</th>
                    <th className="font-normal pb-3">People</th>
                    <th className="font-normal pb-3">Rooms</th>
                    <th className="font-normal pb-3 text-right">Per event</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 border-t border-slate-800/70">
                  {pricing.plans.map((p) => (
                    <tr key={p.id}>
                      <td className="py-4 font-medium text-white">{p.label}</td>
                      <td className="py-4 text-slate-300 tabular-nums">
                        {p.registrations === null ? "Unlimited" : p.registrations.toLocaleString()}
                      </td>
                      <td className="py-4 text-slate-300 tabular-nums">
                        {p.rooms}
                        {p.roomCapacity && <span className="text-slate-500"> × {p.roomCapacity}</span>}
                      </td>
                      <td className="py-4 text-right font-medium tabular-nums">{p.price === 0 ? "Free" : kes(p.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-xs text-slate-500">
                Plus and Pro add certificates and exhibitor lead scanning. Room size is people in a room at once.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-800/70 bg-[#080A10] p-8 grid gap-6 md:grid-cols-[1.6fr_1fr] md:items-center">
            <div>
              <h3 className="font-display text-2xl font-semibold">Rent our gate scanners and staff</h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed max-w-xl">
                Handheld scanners with a built-in barcode reader and receipt printer — instant scans, offline mode,
                printed box-office tickets. Add trained Tixflow staff to run your gates.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-4 md:text-right">
              <div>
                <dt className="text-xs text-slate-500">Scanner</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {kes(pricing.rental.devicePerDay)}
                  <span className="text-slate-500 font-normal"> / day</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Staff member</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {kes(pricing.rental.staffPerDay)}
                  <span className="text-slate-500 font-normal"> / day</span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid gap-10 lg:grid-cols-[1fr_2fr]">
          <h2 className="font-display text-4xl font-semibold">Questions, answered</h2>
          <div className="divide-y divide-slate-800/70 border-y border-slate-800/70">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group py-5">
                <summary className="flex items-center justify-between gap-6 cursor-pointer list-none font-medium text-white [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <PlusIcon className="w-4 h-4 text-slate-500 shrink-0 transition-transform group-open:rotate-45" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-400 max-w-2xl">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-slate-800/60 bg-[#080A10]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24">
          <h2 className="font-display text-4xl sm:text-6xl font-semibold leading-[1] max-w-3xl">
            Your next event deserves better than a group chat and a cash box.
          </h2>
          <Link
            href="/auth"
            className="mt-10 h-12 px-6 inline-flex items-center gap-2 rounded-xl text-sm font-medium bg-slate-100 text-[#0B0F17] hover:bg-white transition-colors"
          >
            Start selling tickets
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <SiteFooter />
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
