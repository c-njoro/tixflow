// pages/dashboard/settings/payments.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

interface StripeStatus {
  connected: boolean;
  isOnboarded: boolean;
  detailsSubmitted?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
}

export default function PaymentsSettingsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/status');
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load payout status.');
      setStatus(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();

    if (router.query.onboarding === 'return') {
      setNotice('Checking your onboarding status...');
    } else if (router.query.onboarding === 'refresh') {
      setNotice('That link expired — click below to try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.onboarding]);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/connect', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to start onboarding.');
      window.location.href = result.data.url;
    } catch (err: any) {
      setError(err.message);
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
          Payments
        </h1>
        <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
          Connect a payout account to start receiving ticket revenue
        </p>
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 text-xs font-medium border rounded-md bg-sky-950/30 text-sky-400 border-sky-800/50">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      ) : (
        <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
              Status
            </span>
            <span
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${
                status?.isOnboarded
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                  : status?.connected
                  ? 'bg-amber-950/40 text-amber-400 border-amber-800/50'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              {status?.isOnboarded ? 'Connected' : status?.connected ? 'Incomplete' : 'Not Connected'}
            </span>
          </div>

          {status?.connected && !status.isOnboarded && (
            <p className="text-xs text-slate-500">
              Your payout account exists but onboarding isn&apos;t finished yet —
              you won&apos;t be able to accept payments until it&apos;s complete.
            </p>
          )}

          {status?.isOnboarded && (
            <p className="text-xs text-slate-500">
              You&apos;re all set. Ticket payments will be sent directly to this account.
            </p>
          )}

          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="w-full py-2.5 px-4 rounded-md text-sm font-medium bg-slate-800 border border-slate-700 hover:bg-slate-700 transition disabled:opacity-50"
          >
            {connecting
              ? 'Redirecting to Stripe...'
              : status?.connected
              ? 'Continue Onboarding'
              : 'Connect Stripe'}
          </button>
        </div>
      )}
    </div>
  );
}