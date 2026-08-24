// pages/dashboard/settings/payouts.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

interface PayoutSettings {
  isOnboarded: boolean;
  payoutMethod: 'mpesa' | 'bank' | null;
  payoutPhoneNumber: string | null;
  payoutBankName: string | null;
  payoutBankCode: string | null;
  payoutBankAccountName: string | null;
  payoutBankAccountNumber: string | null;
}

// Kept in sync with src/lib/intasend.ts KENYA_BANK_CODES — duplicated here
// since this is a client component and shouldn't import server-side code.
const BANK_OPTIONS = [
  { name: 'KCB', code: '1' },
  { name: 'Standard Chartered Bank KE', code: '2' },
  { name: 'Barclays Bank', code: '3' },
  { name: 'NCBA', code: '7' },
  { name: 'Prime Bank', code: '10' },
  { name: 'Cooperative Bank', code: '11' },
  { name: 'National Bank', code: '12' },
  { name: 'Citibank', code: '16' },
  { name: 'Habib Bank AG Zurich', code: '17' },
  { name: 'Middle East Bank', code: '18' },
  { name: 'Bank of Africa', code: '19' },
  { name: 'Consolidated Bank', code: '23' },
  { name: 'Credit Bank Ltd', code: '25' },
  { name: 'Stanbic Bank', code: '31' },
  { name: 'ABC Bank', code: '35' },
  { name: 'Spire Bank', code: '49' },
  { name: 'Paramount Universal Bank', code: '50' },
  { name: 'Jamii Bora Bank', code: '51' },
  { name: 'Guaranty Bank', code: '53' },
  { name: 'Victoria Commercial Bank', code: '54' },
  { name: 'Guardian Bank', code: '55' },
  { name: 'I&M Bank', code: '57' },
  { name: 'Housing Finance Company Limited (HFCK)', code: '61' },
  { name: 'DTB', code: '63' },
  { name: 'Mayfair Bank Limited', code: '65' },
  { name: 'Sidian Bank', code: '66' },
  { name: 'Equity Bank', code: '68' },
  { name: 'Family Bank', code: '70' },
  { name: 'Gulf African Bank', code: '72' },
  { name: 'First Community Bank', code: '74' },
  { name: 'KWFT Bank', code: '78' },
];

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-slate-400';

export default function PayoutSettingsPage() {
  const { user } = useAuth();
  const [method, setMethod] = useState<'mpesa' | 'bank'>('mpesa');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');

  const [isOnboarded, setIsOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Self-payout (M-Pesa only) state
  const [balance, setBalance] = useState<number | null>(null);
  const [payoutStage, setPayoutStage] = useState<'idle' | 'otp' | 'processing' | 'completed' | 'failed'>('idle');
  const [otpToken, setOtpToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [payoutError, setPayoutError] = useState('');
  const [payoutId, setPayoutId] = useState<string | null>(null);
  const [payoutResult, setPayoutResult] = useState<{ reference?: string | null; failureReason?: string | null }>({});

  const loadBalance = async () => {
    const res = await fetch('/api/tenant/payout-balance');
    const result = await res.json();
    if (res.ok) setBalance(result.data.outstandingBalance);
  };

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/payout-settings');
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load payout settings.');

      const data: PayoutSettings = result.data;
      setIsOnboarded(data.isOnboarded);
      if (data.payoutMethod) setMethod(data.payoutMethod);
      setPhoneNumber(data.payoutPhoneNumber || '');
      setBankCode(data.payoutBankCode || '');
      setBankAccountName(data.payoutBankAccountName || '');
      setBankAccountNumber(data.payoutBankAccountNumber || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    loadBalance();
  }, []);

  const handleRequestPayout = async () => {
    setPayoutError('');
    try {
      const res = await fetch('/api/tenant/payout/request-otp', { method: 'POST' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to request payout.');

      setOtpToken(result.data.token);
      setMaskedEmail(result.data.maskedEmail);
      setPayoutStage('otp');
    } catch (err: any) {
      setPayoutError(err.message);
    }
  };

  const handleConfirmOtp = async () => {
    setPayoutError('');
    try {
      const res = await fetch('/api/tenant/payout/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: otpToken, otp: otpInput }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to confirm payout.');

      setPayoutId(result.data.payoutId);
      setPayoutStage('processing');
      pollPayoutStatus(result.data.payoutId);
    } catch (err: any) {
      setPayoutError(err.message);
    }
  };

  const pollPayoutStatus = (id: string) => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/tenant/payout/status?payoutId=${id}`);
      const result = await res.json();
      if (!res.ok) return;

      if (result.data.status === 'completed') {
        clearInterval(interval);
        setPayoutResult({ reference: result.data.reference });
        setPayoutStage('completed');
        loadBalance();
      } else if (result.data.status === 'failed') {
        clearInterval(interval);
        setPayoutResult({ failureReason: result.data.failureReason });
        setPayoutStage('failed');
      }
    }, 3000);

    setTimeout(() => clearInterval(interval), 120000);
  };

  const resetPayoutFlow = () => {
    setPayoutStage('idle');
    setOtpInput('');
    setOtpToken('');
    setPayoutError('');
    setPayoutId(null);
    setPayoutResult({});
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/tenant/payout-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payoutMethod: method,
          payoutPhoneNumber: phoneNumber,
          payoutBankCode: bankCode,
          payoutBankAccountName: bankAccountName,
          payoutBankAccountNumber: bankAccountNumber,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to save payout settings.');

      setIsOnboarded(result.data.isOnboarded);
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-[#0B0F17]/40 text-center">
        <p className="text-sm text-slate-400">Only admins can view payout settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
          Payouts
        </h1>
        <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
          Tell us where to send your ticket revenue
        </p>
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}
      {saved && (
        <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">
          Payout details saved.
        </div>
      )}

      {loading ? (
        <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      ) : (
        <>
          {/* Self-payout — M-Pesa only for now */}
          {isOnboarded && (
            <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
                  Outstanding Balance
                </span>
                <span className="text-lg font-mono font-bold text-white">
                  {balance !== null ? `KES ${balance.toLocaleString()}` : '...'}
                </span>
              </div>

              {payoutError && (
                <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
                  {payoutError}
                </div>
              )}

              {payoutStage === 'idle' && (
                <button
                  type="button"
                  onClick={handleRequestPayout}
                  disabled={!balance || balance <= 0}
                  className="w-full py-2.5 rounded-md text-sm font-medium bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Request Payout
                </button>
              )}

              {payoutStage === 'otp' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    We sent a code to {maskedEmail}. Enter it below to confirm.
                  </p>
                  <input
                    type="text"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="6-digit code"
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmOtp}
                      className="flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/60 transition"
                    >
                      Confirm Payout
                    </button>
                    <button
                      type="button"
                      onClick={resetPayoutFlow}
                      className="px-4 py-2 rounded-md text-xs font-mono uppercase tracking-wider border border-slate-700 hover:bg-slate-800 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {payoutStage === 'processing' && (
                <div className="p-4 border rounded-md bg-sky-950/30 border-sky-800/50 text-center">
                  <div className="text-sm font-mono uppercase tracking-widest text-sky-400">
                    Processing
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Sending KES {balance?.toLocaleString()} to your {method === 'mpesa' ? 'M-Pesa number' : 'bank account'}...
                  </p>
                </div>
              )}

              {payoutStage === 'completed' && (
                <div className="p-4 border rounded-md bg-emerald-950/30 border-emerald-800/50 text-center space-y-2">
                  <div className="text-sm font-mono uppercase tracking-widest text-emerald-400">
                    Payout Sent
                  </div>
                  {payoutResult.reference && (
                    <p className="text-xs text-slate-400">Reference: {payoutResult.reference}</p>
                  )}
                  <button
                    type="button"
                    onClick={resetPayoutFlow}
                    className="text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white transition"
                  >
                    Done
                  </button>
                </div>
              )}

              {payoutStage === 'failed' && (
                <div className="p-4 border rounded-md bg-rose-950/30 border-rose-800/50 text-center space-y-2">
                  <div className="text-sm font-mono uppercase tracking-widest text-rose-400">
                    Payout Failed
                  </div>
                  <p className="text-xs text-slate-400">{payoutResult.failureReason}</p>
                  <button
                    type="button"
                    onClick={resetPayoutFlow}
                    className="text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white transition"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
              Status
            </span>
            <span
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${
                isOnboarded
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              {isOnboarded ? 'Configured' : 'Not Configured'}
            </span>
          </div>

          <div>
            <label className={labelClass}>Payout Method</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setMethod('mpesa')}
                className={`flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
                  method === 'mpesa'
                    ? 'bg-slate-800 border-slate-600 text-white'
                    : 'border-slate-800 text-slate-500 hover:text-white'
                }`}
              >
                M-Pesa
              </button>
              <button
                type="button"
                onClick={() => setMethod('bank')}
                className={`flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
                  method === 'bank'
                    ? 'bg-slate-800 border-slate-600 text-white'
                    : 'border-slate-800 text-slate-500 hover:text-white'
                }`}
              >
                Bank
              </button>
            </div>
          </div>

          {method === 'mpesa' ? (
            <div>
              <label className={labelClass}>M-Pesa Phone Number</label>
              <div className="mt-1">
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="0712345678"
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Bank</label>
                <div className="mt-1">
                  <select
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select your bank</option>
                    {BANK_OPTIONS.map((bank) => (
                      <option key={bank.code} value={bank.code}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Account Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={bankAccountName}
                    onChange={(e) => setBankAccountName(e.target.value)}
                    placeholder="Summit Group Ltd"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Account Number</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    placeholder="0123456789"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 px-4 rounded-md text-sm font-medium bg-slate-800 border border-slate-700 hover:bg-slate-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Payout Details'}
          </button>
        </div>
        </>
      )}
    </div>
  );
}