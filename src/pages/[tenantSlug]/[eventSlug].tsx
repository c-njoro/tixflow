// pages/[tenantSlug]/[eventSlug].tsx
import { useEffect, useRef, useState } from 'react';
import { GetServerSideProps } from 'next';
import { getPublicEvent } from '@/lib/publicQueries';
import { cardPaymentsEnabled } from '@/lib/intasend';
import { captureRef, getRef } from '@/lib/referral';
import TicketCard from '@/components/TicketCard';
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

interface Quote {
  promoCode: string | null;
  subtotal: number;
  discount: number;
  bookingFee: number;
  total: number;
}

const kes = (n: number) => `KES ${n.toLocaleString()}`;

interface Props {
  cardPayments: boolean;
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

export default function PublicEventPage({ tenant, event, cardPayments }: Props) {
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
    'idle' | 'submitting' | 'awaiting_pin' | 'confirming_card' | 'completed' | 'failed'
  >('idle');
  const [payMethod, setPayMethod] = useState<'mpesa' | 'card'>('mpesa');
  // Promo code + the server's price for the current selection.
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState('');
  const [promoError, setPromoError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [wasFree, setWasFree] = useState(false);
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

  // What the order really comes to (promo, booking fee) — from the server
  // once it has answered for this selection.
  const orderTotal = quote ? quote.total : totalPrice;
  const isFree = totalTickets > 0 && orderTotal === 0;
  const minDeposit = event.installments ? Math.max(Math.ceil((orderTotal * event.installments.minDepositPercent) / 100), 1) : 0;
  const depositAmount = Math.round(Number(deposit) || minDeposit);
  const usingInstalments = !!event.installments && payInInstalments && payMethod === 'mpesa' && depositAmount < orderTotal;
  const chargeNow = usingInstalments ? depositAmount : orderTotal;
  const selectedItems = event.ticketTiers
    .filter((tier) => (quantities[tier.id] || 0) > 0)
    .map((tier) => ({ ticketTierId: tier.id, quantity: quantities[tier.id] }));
  const selectionKey = JSON.stringify(selectedItems);
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

  // Price the selection on the server whenever it (or the promo) changes.
  useEffect(() => {
    if (totalTickets === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/checkout/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: event.id, items: selectedItems, promoCode: appliedPromo || undefined }),
        });
        const result = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setQuote(result.data);
        } else if (result.promoInvalid) {
          setPromoError(result.error);
          setAppliedPromo('');
        }
      } catch {
        // keep the last quote; checkout re-prices anyway
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, appliedPromo, event.id]);

  const applyPromo = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    setPromoError('');
    setAppliedPromo(promoInput.trim().toUpperCase());
  };

  // Back from the card processor (?order=&key=): show the result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    const key = params.get('key');
    if (!order || !key) return;
    window.history.replaceState(null, '', window.location.pathname);
    setOrderId(order);
    setCheckoutStage('confirming_card');
    pollOrderStatus(order, key, 5 * 60_000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const pollOrderStatus = (id: string, accessKey: string, timeoutMs = 120000) => {
    stopPolling();
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
        if (stage === 'awaiting_pin' || stage === 'confirming_card') {
          setFailureReason(
            stage === 'awaiting_pin'
              ? 'This took too long — please check your M-Pesa messages, or try again.'
              : 'We haven’t had confirmation from the card processor yet. If you were charged, your tickets will be emailed as soon as it arrives.'
          );
          return 'failed';
        }
        return stage;
      });
    }, timeoutMs);
  };

  const handleInitiateCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalTickets === 0) return;

    setCheckoutError('');
    setCheckoutStage('submitting');

    try {
      const method = isFree ? 'mpesa' : payMethod;
      const res = await fetch(method === 'card' ? '/api/checkout/card/initiate' : '/api/checkout/mpesa/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          buyerName: `${firstName} ${lastName}`.trim(),
          buyerEmail,
          buyerWhatsapp: buyerWhatsapp.trim() || undefined,
          phoneNumber: !isFree && method === 'mpesa' ? buyerPhone : undefined,
          ref: getRef(tenant.slug),
          promoCode: appliedPromo || undefined,
          installment: usingInstalments ? { deposit: depositAmount } : undefined,
          items: selectedItems,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to start payment.');

      setOrderId(result.data.orderId);
      if (result.data.free) {
        // Already issued — fetch the tickets straight away.
        setWasFree(true);
        const status = await fetch(
          `/api/checkout/mpesa/status?orderId=${result.data.orderId}&key=${encodeURIComponent(result.data.accessKey)}`
        ).then((r) => r.json());
        setPurchasedTickets(status.data?.tickets || []);
        setCheckoutStage('completed');
        return;
      }
      if (result.data.redirectUrl) {
        window.location.href = result.data.redirectUrl;
        return;
      }
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
    setWasFree(false);
  };

  const eventDate = new Date(event.date);
  const isUpcoming = eventDate > new Date();

  // Compute gallery URLs from either format
  const galleryUrls =
    event.galleryImageUrls ||
    event.galleryImages?.map((img) => img.url) ||
    [];

  const nairobi = { timeZone: 'Africa/Nairobi' } as const;
  const dateLine = eventDate.toLocaleDateString('en-KE', { ...nairobi, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeLine = eventDate.toLocaleTimeString('en-KE', { ...nairobi, hour: '2-digit', minute: '2-digit', hour12: false });
  const endLine = event.endDate
    ? new Date(event.endDate).toLocaleDateString('en-KE', { ...nairobi, weekday: 'short', day: 'numeric', month: 'short' })
    : null;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;

  return (
    <div className="min-h-screen bg-ink text-white">
      <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-ink/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <a href={`/${tenant.slug}`} className="flex items-center gap-3 min-w-0">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover ring-1 ring-slate-700/50" />
            ) : (
              <span className="grid place-items-center h-8 w-8 rounded-lg bg-slate-800 text-sm font-semibold text-slate-200">
                {tenant.businessName.slice(0, 1)}
              </span>
            )}
            <span className="text-sm font-medium text-slate-200 truncate">{tenant.businessName}</span>
          </a>
          <a href="/lookup" className="px-3 h-9 inline-flex items-center rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors">
            My tickets
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-40 lg:pb-24">
        {event.coverImageUrl && (
          <div className="relative overflow-hidden rounded-2xl border border-slate-800/70 bg-raised aspect-[16/9] sm:aspect-[21/9]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={event.coverImageUrl} alt={event.title} className="absolute inset-0 w-full h-full object-cover" />
          </div>
        )}

        <div className="mt-8 sm:mt-10 grid gap-10 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {event.category && <span className="text-slate-400">{event.category}</span>}
              {event.category && isUpcoming && <span className="text-slate-700">·</span>}
              {isUpcoming && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  On sale
                </span>
              )}
            </div>

            <h1 className="mt-3 font-display text-[2.5rem] sm:text-6xl leading-[1] font-semibold">{event.title}</h1>

            <dl className="mt-8 grid gap-4 sm:grid-cols-2 border-y border-slate-800/70 py-6">
              <div className="flex gap-3">
                <CalendarIcon className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <dt className="sr-only">Date</dt>
                  <dd className="text-slate-100">{dateLine}</dd>
                  <dd className="text-sm text-slate-400 tabular-nums">
                    {timeLine}
                    {endLine && ` — until ${endLine}`}
                  </dd>
                </div>
              </div>
              <div className="flex gap-3">
                <MapPinIcon className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <dt className="sr-only">Venue</dt>
                  <dd className="text-slate-100">{event.location}</dd>
                  <dd>
                    <a href={mapUrl} target="_blank" rel="noreferrer" className="text-sm text-slate-400 underline hover:text-white">
                      Open in Maps
                    </a>
                  </dd>
                </div>
              </div>
            </dl>

            {event.description && (
              <div className="mt-8">
                <h2 className="text-sm font-medium text-slate-400">About this event</h2>
                <p className="mt-3 text-[17px] leading-[1.7] text-slate-300 whitespace-pre-line max-w-[65ch]">{event.description}</p>
              </div>
            )}

            {galleryUrls.length > 0 && (
              <div className="mt-10">
                <h2 className="text-sm font-medium text-slate-400">Gallery</h2>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {galleryUrls.map((url, i) => (
                    <div key={i} className="aspect-[4/3] overflow-hidden rounded-xl border border-slate-800/70 bg-raised">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 space-y-4">
          {/* Ticket tiers */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold">Tickets</h2>
              {totalTickets > 0 && (
                <span className="text-sm text-slate-400 tabular-nums">
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
                      className={`relative p-4 rounded-xl border transition-colors ${
                        isSelected ? 'bg-panel border-slate-500/70' : 'bg-panel/50 border-slate-800/70 hover:border-slate-700'
                      } ${isSoldOut ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 min-w-0">
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0 mt-[7px]"
                            style={{ backgroundColor: tier.tierColor }}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-white">
                                {tier.name}
                              </span>
                              {isSoldOut && (
                                <span className="px-2 py-0.5 rounded text-[11px] uppercase tracking-[0.06em] bg-rose-950/30 text-rose-400 border border-rose-800/30 font-medium">
                                  Sold Out
                                </span>
                              )}
                            </div>
                            {tier.description && (
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                {tier.description}
                              </p>
                            )}
                            <p className="mt-1 text-sm tabular-nums">
                              <span className="text-slate-100">{tier.price > 0 ? kes(tier.price) : 'Free'}</span>
                              {tier.available > 0 && !isSoldOut && tier.available <= 20 && (
                                <span className="text-amber-400/90 ml-2">{tier.available} left</span>
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
                              className="w-9 h-9 grid place-items-center rounded-lg border border-slate-700 bg-ink text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                              className="w-9 h-9 grid place-items-center rounded-lg border border-slate-700 bg-ink text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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

          {totalTickets > 0 && checkoutStage === 'idle' && !showCheckoutForm && (
            <div className="hidden lg:flex items-center justify-between gap-4 p-4 rounded-xl border border-slate-800/70 bg-deep">
              <div>
                <div className="text-sm text-slate-400 tabular-nums">
                  {totalTickets} ticket{totalTickets === 1 ? '' : 's'}
                </div>
                <div className="text-xl font-semibold tabular-nums">{isFree ? 'Free' : kes(orderTotal)}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowCheckoutForm(true)}
                className="h-11 px-6 rounded-xl text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors inline-flex items-center gap-2"
              >
                Checkout
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          )}

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
                    {wasFree ? 'You’re registered' : 'Payment Successful'}
                  </h2>
                  <p className="text-sm text-slate-400 max-w-md mx-auto">
                    Your {purchasedTickets.length === 1 ? 'ticket is' : 'tickets are'} confirmed and on {purchasedTickets.length === 1 ? 'its' : 'their'} way to your email. Download {purchasedTickets.length === 1 ? 'it' : 'them'} now too — you&apos;ll show the QR code at the door.
                  </p>
                </div>

                <div className="space-y-8">
                  {purchasedTickets.map((t) => (
                    <TicketCard key={t.ticketCode} ticketCode={t.ticketCode} />
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
            ) : checkoutStage === 'confirming_card' ? (
              <div className="p-8 rounded-2xl bg-sky-950/20 border border-sky-800/30 text-center space-y-4">
                <div className="w-10 h-10 mx-auto border-2 border-sky-800 border-t-sky-400 rounded-full animate-spin" />
                <h2 className="text-xl font-bold text-sky-400">Confirming your payment</h2>
                <p className="text-sm text-slate-400 max-w-sm mx-auto">
                  This usually takes a few seconds. Your tickets will appear here and in your email.
                </p>
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
                    <span className="text-slate-300 tabular-nums">{buyerPhone}</span>{' '}
                    to complete payment of{' '}
                    <span className="text-slate-200 tabular-nums">
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
              <div className="p-6 sm:p-8 bg-panel border border-slate-800/60 rounded-2xl space-y-6">
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
                      <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                        First Name
                      </label>
                      <input
                        type="text"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="John"
                        className="block w-full bg-ink border border-slate-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                        Last Name
                      </label>
                      <input
                        type="text"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Doe"
                        className="block w-full bg-ink border border-slate-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      placeholder="john@example.com"
                      className="block w-full bg-ink border border-slate-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                    />
                    <p className="text-[11px] text-slate-600">
                      Your tickets always go here — keep this safe
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                      WhatsApp Number <span className="text-slate-600 normal-case">(optional)</span>
                    </label>
                    <input
                      type="tel"
                      value={buyerWhatsapp}
                      onChange={(e) => setBuyerWhatsapp(e.target.value)}
                      placeholder="0712345678"
                      className="block w-full bg-ink border border-slate-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                    />
                    <p className="text-[11px] text-slate-600">
                      We&apos;ll also send your tickets here — email is still what matters if this doesn&apos;t go through
                    </p>
                  </div>

                  {!isFree && cardPayments && (
                    <div className="grid grid-cols-2 gap-2">
                      {(['mpesa', 'card'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPayMethod(m)}
                          className={`px-4 py-3 rounded-xl border text-sm text-left transition ${
                            payMethod === m
                              ? 'border-slate-500 bg-slate-800/60 text-white'
                              : 'border-slate-800 bg-ink text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <span className="block font-medium">{m === 'mpesa' ? 'M-Pesa' : 'Card'}</span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            {m === 'mpesa' ? 'STK push to your phone' : 'Visa, Mastercard, Apple / Google Pay'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!isFree && payMethod === 'mpesa' && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                      M-Pesa Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      placeholder="0712345678"
                      className="block w-full bg-ink border border-slate-800 rounded-xl px-4 py-3 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 transition-colors"
                    />
                    <p className="text-[11px] text-slate-600">
                      You&apos;ll receive an STK push on this number
                    </p>
                  </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                      Promo Code <span className="text-slate-600 normal-case">(optional)</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && applyPromo(e)}
                        placeholder="e.g. MUKURU"
                        className="block w-full bg-ink border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 transition font-medium"
                      />
                      {appliedPromo && quote?.promoCode ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAppliedPromo('');
                            setPromoInput('');
                          }}
                          className="px-4 rounded-xl text-sm border border-slate-700 text-slate-300 hover:bg-slate-800/60 transition"
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={applyPromo}
                          disabled={!promoInput.trim()}
                          className="px-4 rounded-xl text-sm border border-slate-700 text-slate-300 hover:bg-slate-800/60 transition disabled:opacity-40"
                        >
                          Apply
                        </button>
                      )}
                    </div>
                    {promoError && <p className="text-[11px] text-rose-400">{promoError}</p>}
                  </div>

                  {quote && (quote.discount > 0 || quote.bookingFee > 0) && (
                    <div className="p-4 rounded-xl border border-slate-800 bg-ink space-y-1.5 text-sm">
                      <div className="flex justify-between text-slate-400">
                        <span>Tickets</span>
                        <span className="tabular-nums">{kes(quote.subtotal)}</span>
                      </div>
                      {quote.discount > 0 && (
                        <div className="flex justify-between text-emerald-400">
                          <span>Promo {quote.promoCode}</span>
                          <span className="tabular-nums">− {kes(quote.discount)}</span>
                        </div>
                      )}
                      {quote.bookingFee > 0 && (
                        <div className="flex justify-between text-slate-400">
                          <span>Booking fee</span>
                          <span className="tabular-nums">{kes(quote.bookingFee)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold pt-1.5 border-t border-slate-800">
                        <span>Total</span>
                        <span className="tabular-nums">{kes(quote.total)}</span>
                      </div>
                    </div>
                  )}

                  {event.installments && orderTotal > 0 && payMethod === 'mpesa' && (
                    <div className="p-4 rounded-xl border border-slate-800 bg-ink space-y-3">
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
                          <label className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">
                            Deposit today (min KES {minDeposit.toLocaleString()})
                          </label>
                          <input
                            type="number"
                            min={minDeposit}
                            max={orderTotal}
                            step="1"
                            value={deposit}
                            onChange={(e) => setDeposit(e.target.value)}
                            placeholder={String(minDeposit)}
                            className="block w-full bg-panel border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 transition"
                          />
                          <p className="text-[11px] text-slate-600">
                            KES {Math.max(orderTotal - chargeNow, 0).toLocaleString()}{' '}left to pay after today. If it
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
                          {isFree
                            ? 'Get my free ticket'
                            : usingInstalments
                              ? `Pay deposit ${kes(chargeNow)}`
                              : payMethod === 'card'
                                ? `Pay ${kes(orderTotal)} by card`
                                : `Pay ${kes(orderTotal)}`}
                          <ChevronRightIcon className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
          </aside>
        </div>
      </main>

      {/* Sticky Checkout Bar */}
      {totalTickets > 0 && checkoutStage === 'idle' && !showCheckoutForm && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-slate-800/60 bg-ink/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate-400 tabular-nums">
                {totalTickets} ticket{totalTickets === 1 ? '' : 's'}
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {isFree ? 'Free' : kes(orderTotal)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCheckoutForm(true)}
              className="h-12 px-7 rounded-xl text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors flex items-center gap-2 shrink-0"
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
    props: { ...JSON.parse(JSON.stringify(result)), cardPayments: cardPaymentsEnabled() },
  };
};