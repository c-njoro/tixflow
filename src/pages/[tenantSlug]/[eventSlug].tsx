// pages/[tenantSlug]/[eventSlug].tsx
import { useEffect, useRef, useState } from 'react';
import { GetServerSideProps } from 'next';
import { getPublicEvent } from '@/lib/publicQueries';
import { captureRef, getRef } from '@/lib/referral';
import {
  MapPinIcon,
  CalendarIcon,
  MinusIcon,
  PlusIcon,
  TicketIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

interface Tier {
  id: string;
  name: string;
  price: number;
  description: string | null;
  tierColor: string;
  available: number;
}

interface Props {
  tenant: { businessName: string; slug: string; logoUrl: string | null };
  event: {
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    date: string;
    endDate: string | null;
    location: string;
    coverImageUrl: string | null;
    galleryImageUrls?: string[];
    galleryImages?: { url: string; publicId: string }[];
    ticketTiers: Tier[];
    // Lipa Pole Pole terms while new plans can be started, else null.
    installments: { minDepositPercent: number; dueAt: string } | null;
  };
}

export default function PublicEventPage({ tenant, event }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Checkout flow state
  const [showCheckoutForm, setShowCheckoutForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerWhatsapp, setBuyerWhatsapp] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutStage, setCheckoutStage] = useState<
    'idle' | 'submitting' | 'awaiting_pin' | 'completed' | 'failed'
  >('idle');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [purchasedTickets, setPurchasedTickets] = useState<{ ticketCode: string }[]>([]);
  const [failureReason, setFailureReason] = useState('');
  // Lipa Pole Pole
  const [payInInstalments, setPayInInstalments] = useState(false);
  const [deposit, setDeposit] = useState('');
  const [plan, setPlan] = useState<{ id: string; accessKey: string; paidAmount: number; totalAmount: number; dueAt: string } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);

  const setQuantity = (tierId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [tierId]: Math.max(0, qty) }));
  };

  const totalTickets = Object.values(quantities).reduce((sum, q) => sum + q, 0);
  const totalPrice = event.ticketTiers.reduce(
    (sum, tier) => sum + (quantities[tier.id] || 0) * tier.price,
    0
  );

  const minDeposit = event.installments ? Math.max(Math.ceil((totalPrice * event.installments.minDepositPercent) / 100), 1) : 0;
  const depositAmount = Math.round(Number(deposit) || minDeposit);
  const usingInstalments = !!event.installments && payInInstalments && depositAmount < totalPrice;
  const chargeNow = usingInstalments ? depositAmount : totalPrice;
  const dueDateLabel = event.installments
    ? new Date(event.installments.dueAt).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long' })
    : '';

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  // Promoter links (?ref=code) — remembered so the sale is credited to them.
  useEffect(() => captureRef(tenant.slug), [tenant.slug]);

  // Scroll to checkout when form opens
  useEffect(() => {
    if (showCheckoutForm && checkoutRef.current) {
      setTimeout(() => {
        checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [showCheckoutForm]);

  const pollOrderStatus = (id: string, accessKey: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/checkout/mpesa/status?orderId=${id}&key=${encodeURIComponent(accessKey)}`
        );
        const result = await res.json();
        if (!res.ok) return;

        if (result.data.status === 'completed') {
          stopPolling();
          setPurchasedTickets(result.data.tickets);
          if (result.data.installmentPlan) setPlan(result.data.installmentPlan);
          setCheckoutStage('completed');
        } else if (result.data.status === 'failed') {
          stopPolling();
          setFailureReason(result.data.failureReason || 'Payment was not completed.');
          setCheckoutStage('failed');
        }
      } catch {
        // transient network hiccup — next poll tick will retry
      }
    }, 3000);

    setTimeout(() => {
      stopPolling();
      setCheckoutStage((stage) => {
        if (stage === 'awaiting_pin') {
          setFailureReason('This took too long — please check your M-Pesa messages, or try again.');
          return 'failed';
        }
        return stage;
      });
    }, 120000);
  };

  const handleInitiateCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalTickets === 0) return;

    setCheckoutError('');
    setCheckoutStage('submitting');

    try {
      const res = await fetch('/api/checkout/mpesa/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          buyerName: `${firstName} ${lastName}`.trim(),
          buyerEmail,
          buyerWhatsapp: buyerWhatsapp.trim() || undefined,
          phoneNumber: buyerPhone,
          ref: getRef(tenant.slug),
          installment: usingInstalments ? { deposit: depositAmount } : undefined,
          items: event.ticketTiers
            .filter((tier) => (quantities[tier.id] || 0) > 0)
            .map((tier) => ({ ticketTierId: tier.id, quantity: quantities[tier.id] })),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to start payment.');

      setOrderId(result.data.orderId);
      setCheckoutStage('awaiting_pin');
      pollOrderStatus(result.data.orderId, result.data.accessKey);
    } catch (err: any) {
      setCheckoutError(err.message);
      setCheckoutStage('idle');
    }
  };

  const resetCheckout = () => {
    stopPolling();
    setShowCheckoutForm(false);
    setCheckoutStage('idle');
    setCheckoutError('');
    setFailureReason('');
    setOrderId(null);
    setPurchasedTickets([]);
    setPlan(null);
  };

  const eventDate = new Date(event.date);
  const isUpcoming = eventDate > new Date();

  // Compute gallery URLs from either format
  const galleryUrls =
    event.galleryImageUrls ||
    event.galleryImages?.map((img) => img.url) ||
    [];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white antialiased selection:bg-white/20">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-slate-800/40 bg-[#0B0F17]/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          {tenant.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logoUrl}
              alt={tenant.businessName}
              className="h-8 w-8 rounded-lg object-cover ring-1 ring-slate-700/50"
            />
          )}
          <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
            {tenant.businessName}
          </span>
        </div>
      </header>

      <main className="pt-16">
        {/* Hero */}
        <div className="relative">
          {event.coverImageUrl ? (
            <div className="relative h-72 sm:h-96 w-full overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.coverImageUrl}
                alt={event.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-[#0B0F17]/40 to-transparent" />
            </div>
          ) : (
            <div className="h-32 bg-[#0E131F]" />
          )}

          <div className="relative max-w-3xl mx-auto px-6 -mt-24 sm:-mt-32 pb-8">
            <div className="space-y-4">
              {event.category && (
                <div className="inline-flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-800/60 border border-slate-700/40 text-[10px] font-mono uppercase tracking-widest text-slate-400">
                    {event.category}
                  </span>
                  {isUpcoming && (
                    <span className="px-2.5 py-1 rounded-md bg-emerald-950/30 border border-emerald-800/30 text-[10px] font-mono uppercase tracking-widest text-emerald-400">
                      On Sale
                    </span>
                  )}
                </div>
              )}

              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
                {event.title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-slate-500" />
                  <span>
                    {eventDate.toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                    {event.endDate && (
                      <>
                        {' '}
                        —{' '}
                        {new Date(event.endDate).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                        })}
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPinIcon className="w-4 h-4 text-slate-500" />
                  <span>{event.location}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-6 space-y-10 pb-32">
          {/* Description */}
          {event.description && (
            <div className="prose prose-invert prose-sm max-w-none">
              <p className="text-slate-300 leading-relaxed whitespace-pre-line text-[15px]">
                {event.description}
              </p>
            </div>
          )}

          {/* Gallery */}
          {galleryUrls.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-mono uppercase tracking-widest text-slate-500">
                Gallery
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {galleryUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <div
                    key={i}
                    className="aspect-[4/3] overflow-hidden rounded-xl ring-1 ring-slate-800/50"
                  >
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ticket tiers */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-widest text-slate-500">
                Select Tickets
              </h3>
              {totalTickets > 0 && (
                <span className="text-xs text-slate-500">
                  {totalTickets} selected
                </span>
              )}
            </div>

            {event.ticketTiers.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-800 rounded-2xl">
                <TicketIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">
                  No tickets are available for this event yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {event.ticketTiers.map((tier) => {
                  const qty = quantities[tier.id] || 0;
                  const isSelected = qty > 0;
                  const isSoldOut = tier.available <= 0;

                  return (
                    <div
                      key={tier.id}
                      className={`group relative p-5 rounded-2xl border transition-all duration-200 ${
                        isSelected
                          ? 'bg-[#0E131F] border-slate-600/60 ring-1 ring-slate-600/20'
                          : 'bg-[#0E131F]/40 border-slate-800/50 hover:border-slate-700/50'
                      } ${isSoldOut ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0">
                          <div
                            className="w-3 h-3 rounded-full shrink-0 mt-1.5"
                            style={{ backgroundColor: tier.tierColor }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold">
                                {tier.name}
                              </span>
                              {isSoldOut && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-rose-950/30 text-rose-400 border border-rose-800/30">
                                  Sold Out
                                </span>
                              )}
                            </div>
                            {tier.description && (
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                {tier.description}
                              </p>
                            )}
                            <p className="text-xs text-slate-400 mt-2 font-mono">
                              KES {tier.price.toLocaleString()}
                              {tier.available > 0 && !isSoldOut && (
                                <span className="text-slate-600 ml-2">
                                  · {tier.available} left
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {!isSoldOut ? (
                          <div className="flex items-center gap-3 shrink-0">
                            <button
                              type="button"
                              onClick={() => setQuantity(tier.id, qty - 1)}
                              disabled={qty === 0}
                              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-700 bg-[#0B0F17] text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              <MinusIcon className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-medium tabular-nums">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setQuantity(
                                  tier.id,
                                  Math.min(tier.available, qty + 1)
                                )
                              }
                              disabled={qty >= tier.available}
                              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-700 bg-[#0B0F17] text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
                            >
                              <PlusIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Checkout Flow */}
          <div ref={checkoutRef} className="space-y-4">
            {checkoutStage === 'completed' && plan ? (
              <div className="p-8 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 text-center space-y-5">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center">
                  <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-emerald-400">Your seats are reserved</h2>
                  <p className="text-sm text-slate-400 max-w-md mx-auto">
                    KES {plan.paidAmount.toLocaleString()} paid of KES {plan.totalAmount.toLocaleString()}. Pay the rest — any
                    amount, any time — by {dueDateLabel}. Your tickets are sent the moment it&apos;s fully paid.
                  </p>
                </div>
                <a
                  href={`/plan/${plan.id}?key=${encodeURIComponent(plan.accessKey)}`}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium bg-white text-black hover:bg-slate-200 transition"
                >
                  Open my payment plan
                  <ChevronRightIcon className="w-4 h-4" />
                </a>
                <p className="text-xs text-slate-500">We&apos;ve also sent this link to your email{buyerWhatsapp ? ' and WhatsApp' : ''}.</p>
              </div>
            ) : checkoutStage === 'completed' ? (
              <div className="p-8 rounded-2xl bg-emerald-950/20 border border-emerald-800/30 text-center space-y-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/50 border border-emerald-800/30 flex items-center justify-center">
                  <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-emerald-400">
                    Payment Successful
                  </h2>
                  <p className="text-sm text-slate-400 max-w-md mx-auto">
                    Your {purchasedTickets.length === 1 ? 'ticket is' : 'tickets are'} confirmed. Screenshot the QR code{purchasedTickets.length === 1 ? '' : 's'} below — you'll need {purchasedTickets.length === 1 ? 'it' : 'them'} at the door.
                  </p>
                </div>

                <div className="space-y-3 max-w-sm mx-auto">
                  {purchasedTickets.map((t) => (
                    <div
                      key={t.ticketCode}
                      className="flex items-center gap-4 bg-[#0B0F17] border border-slate-800/60 rounded-xl p-4 text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/tickets/qr/${t.ticketCode}`}
                        alt={`QR code for ${t.ticketCode}`}
                        className="w-20 h-20 rounded-lg bg-white p-1.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">
                          Ticket Code
                        </div>
                        <span className="font-mono text-sm text-slate-200 truncate block">
                          {t.ticketCode}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={resetCheckout}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium border border-slate-700 hover:bg-slate-800/60 transition"
                >
                  <ArrowLeftIcon className="w-4 h-4" />
                  Back to Event
                </button>
              </div>
            ) : checkoutStage === 'failed' ? (
              <div className="p-8 rounded-2xl bg-rose-950/20 border border-rose-800/30 text-center space-y-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-rose-950/50 border border-rose-800/30 flex items-center justify-center">
                  <XCircleIcon className="w-8 h-8 text-rose-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-rose-400">
                    Payment Failed
                  </h2>
                  <p className="text-sm text-slate-400">{failureReason}</p>
                </div>
                <button
                  type="button"
                  onClick={resetCheckout}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium border border-slate-700 hover:bg-slate-800/60 transition"
                >
                  <ArrowLeftIcon className="w-4 h-4" />
                  Try Again
                </button>
              </div>
            ) : checkoutStage === 'awaiting_pin' ? (
              <div className="p-8 rounded-2xl bg-sky-950/20 border border-sky-800/30 text-center space-y-6">
                <div className="relative w-16 h-16 mx-auto">
                  <div className="absolute inset-0 rounded-full bg-sky-500/20 animate-ping" />
                  <div className="relative w-16 h-16 rounded-full bg-sky-950/50 border border-sky-800/30 flex items-center justify-center">
                    <ClockIcon className="w-8 h-8 text-sky-400 animate-pulse" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-sky-400">
                    Check Your Phone
                  </h2>
                  <p className="text-sm text-slate-400 max-w-sm mx-auto">
                    Enter your M-Pesa PIN on the prompt sent to{' '}
                    <span className="text-slate-300 font-mono">{buyerPhone}</span>{' '}
                    to complete payment of{' '}
                    <span className="text-slate-200 font-mono">
                      KES {chargeNow.toLocaleString()}
                    </span>
                    .
                  </p>
                </div>
                <div className="text-xs text-slate-600">
                  Waiting for confirmation... Do not close this page.
                </div>
              </div>
            ) : showCheckoutForm ? (
              <div className="p-6 sm:p-8 bg-[#0E131F] border border-slate-800/60 rounded-2xl space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold">Checkout</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Complete your purchase securely
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCheckoutForm(false)}
                    className="p-2 rounded-lg hover:bg-slate-800/60 text-slate-500 hover:text-slate-300 transition"
                  >
                    <ArrowLeftIcon className="w-4 h-4" />
                  </button>
                </div>

                {checkoutError && (
                  <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/30 text-rose-400 text-sm">
                    {checkoutError}
                  </div>
                )}

                <form onSubmit={handleInitiateCheckout} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                        First Name
                      </label>
                      <input
                        type="text"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="John"
                        className="block w-full bg-[#0B0F17] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 transition"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                        Last Name
                      </label>
                      <input
                        type="text"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Doe"
                        className="block w-full bg-[#0B0F17] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 transition"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="block w-full bg-[#0B0F17] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 transition"
                    />
                    <p className="text-[11px] text-slate-600">
                      Your tickets always go here — keep this safe
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                      WhatsApp Number <span className="text-slate-600 normal-case">(optional)</span>
                    </label>
                    <input
                      type="tel"
                      value={buyerWhatsapp}
                      onChange={(e) => setBuyerWhatsapp(e.target.value)}
                      placeholder="0712345678"
                      className="block w-full bg-[#0B0F17] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 transition"
                    />
                    <p className="text-[11px] text-slate-600">
                      We&apos;ll also send your tickets here — email is still what matters if this doesn&apos;t go through
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                      M-Pesa Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      placeholder="0712345678"
                      className="block w-full bg-[#0B0F17] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 focus:border-slate-600 transition"
                    />
                    <p className="text-[11px] text-slate-600">
                      You'll receive an STK push on this number
                    </p>
                  </div>

                  {event.installments && totalPrice > 0 && (
                    <div className="p-4 rounded-xl border border-slate-800 bg-[#0B0F17] space-y-3">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={payInInstalments}
                          onChange={(e) => setPayInInstalments(e.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          <span className="block text-sm font-medium text-white">Lipa Pole Pole — pay in instalments</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            Pay a deposit now to reserve your seats, then the rest in any amounts by {dueDateLabel}.
                          </span>
                        </span>
                      </label>
                      {payInInstalments && (
                        <div className="space-y-1.5 pl-7">
                          <label className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                            Deposit today (min KES {minDeposit.toLocaleString()})
                          </label>
                          <input
                            type="number"
                            min={minDeposit}
                            max={totalPrice}
                            step="1"
                            value={deposit}
                            onChange={(e) => setDeposit(e.target.value)}
                            placeholder={String(minDeposit)}
                            className="block w-full bg-[#0E131F] border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 transition"
                          />
                          <p className="text-[11px] text-slate-600">
                            KES {Math.max(totalPrice - chargeNow, 0).toLocaleString()}{' '}left to pay after today. If it
                            isn&apos;t paid by {dueDateLabel}, the seats are released.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={checkoutStage === 'submitting' || (usingInstalments && depositAmount < minDeposit)}
                      className="w-full py-3.5 rounded-xl text-sm font-medium bg-white text-black hover:bg-slate-200 transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {checkoutStage === 'submitting' ? (
                        <>
                          <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          {usingInstalments ? `Pay deposit KES ${chargeNow.toLocaleString()}` : `Pay KES ${totalPrice.toLocaleString()}`}
                          <ChevronRightIcon className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {/* Sticky Checkout Bar */}
      {totalTickets > 0 && checkoutStage === 'idle' && !showCheckoutForm && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-800/60 bg-[#0B0F17]/90 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500 font-mono uppercase tracking-wider">
                {totalTickets} ticket{totalTickets === 1 ? '' : 's'} selected
              </div>
              <div className="text-lg font-bold font-mono">
                KES {totalPrice.toLocaleString()}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCheckoutForm(true)}
              className="px-8 py-3 rounded-xl text-sm font-medium bg-white text-black hover:bg-slate-200 transition flex items-center gap-2 shrink-0"
            >
              Checkout
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const { tenantSlug, eventSlug } = context.params as { tenantSlug: string; eventSlug: string };

  const result = await getPublicEvent(tenantSlug, eventSlug);
  if (!result) {
    return { notFound: true };
  }

  return {
    props: JSON.parse(JSON.stringify(result)),
  };
};