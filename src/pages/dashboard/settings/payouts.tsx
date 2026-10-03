// pages/dashboard/settings/payouts.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

interface PayoutSettings {
  isOnboarded: boolean;
  payoutMethod: 'mpesa' | 'bank' | null;
  payoutPhoneNumber: string | null;
  payoutBankName: string | null;
  payoutBankPaybill: string | null;
  payoutBankAccountName: string | null;
  payoutBankAccountNumber: string | null;
}

interface PayoutRecord {
  id: string;
  amount: number;
  feeAmount: number | null;
  netAmount: number | null;
  method: string;
  status: string;
  reference: string | null;
  failureReason: string | null;
  createdAt: string;
}

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';
const labelClass = 'block text-xs font-medium uppercase tracking-wider text-slate-400';

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-950/40 text-amber-400 border-amber-800/50',
  processing: 'bg-sky-950/40 text-sky-400 border-sky-800/50',
  completed: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  failed: 'bg-rose-950/40 text-rose-400 border-rose-800/50',
  rejected: 'bg-rose-950/40 text-rose-400 border-rose-800/50',
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Awaiting Approval',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
};

export default function PayoutSettingsPage() {
  const { user } = useAuth();
  const [method, setMethod] = useState<'mpesa' | 'bank'>('mpesa');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankPaybill, setBankPaybill] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');

  const [isOnboarded, setIsOnboarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // Changing details on an already-configured account needs an emailed code.
  const [settingsChallenge, setSettingsChallenge] = useState<{ challengeId: string; maskedEmail: string } | null>(null);
  const [settingsOtp, setSettingsOtp] = useState('');

  // Self-payout request state
  const [balance, setBalance] = useState<number | null>(null);
  const [feePercent, setFeePercent] = useState<number>(3);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [payoutStage, setPayoutStage] = useState<'idle' | 'otp' | 'submitted'>('idle');
  const [challengeId, setChallengeId] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [payoutError, setPayoutError] = useState('');
  const [otpSplit, setOtpSplit] = useState<{ amount: number; feeAmount: number; netAmount: number } | null>(null);

  const [history, setHistory] = useState<PayoutRecord[]>([]);

  const loadBalance = async () => {
    const res = await fetch('/api/tenant/payout-balance');
    const result = await res.json();
    if (res.ok) {
      setBalance(result.data.outstandingBalance);
      setFeePercent(result.data.platformFeePercent);
    }
  };

  const loadHistory = async () => {
    const res = await fetch('/api/tenant/payout/history');
    const result = await res.json();
    if (res.ok) setHistory(result.data);
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
      setBankName(data.payoutBankName || '');
      setBankPaybill(data.payoutBankPaybill || '');
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
    loadHistory();
  }, []);

  const handleRequestPayout = async () => {
    setPayoutError('');
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayoutError('Enter a valid amount to withdraw.');
      return;
    }
    try {
      const res = await fetch('/api/tenant/payout/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to request payout.');

      setChallengeId(result.data.challengeId);
      setMaskedEmail(result.data.maskedEmail);
      setOtpSplit({
        amount: result.data.amount,
        feeAmount: result.data.feeAmount,
        netAmount: result.data.netAmount,
      });
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
        body: JSON.stringify({ challengeId, otp: otpInput }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to confirm payout.');

      setPayoutStage('submitted');
      loadBalance();
      loadHistory();
    } catch (err: any) {
      setPayoutError(err.message);
    }
  };

  const resetPayoutFlow = () => {
    setPayoutStage('idle');
    setOtpInput('');
    setChallengeId('');
    setOtpSplit(null);
    setWithdrawAmount('');
    setPayoutError('');
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
          payoutBankName: bankName,
          payoutBankPaybill: bankPaybill,
          payoutBankAccountName: bankAccountName,
          payoutBankAccountNumber: bankAccountNumber,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to save payout settings.');

      if (result.requiresOtp) {
        setSettingsChallenge(result.data);
        setSettingsOtp('');
        return;
      }

      setIsOnboarded(result.data.isOnboarded);
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSettingsOtp = async () => {
    if (!settingsChallenge) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tenant/payout-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: settingsChallenge.challengeId, otp: settingsOtp }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to confirm payout details.');

      setSettingsChallenge(null);
      setSettingsOtp('');
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
    <div className="space-y-6 max-w-xl mx-auto">
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
              <p className="text-[11px] text-slate-500 -mt-2">
                A {feePercent}% platform fee applies to the amount you withdraw, not your full balance.
              </p>

              {payoutError && (
                <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
                  {payoutError}
                </div>
              )}

              {payoutStage === 'idle' && (
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>Amount to withdraw (KES)</label>
                    <div className="mt-1">
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder={balance ? balance.toFixed(2) : '0.00'}
                        className={inputClass}
                      />
                    </div>
                    {withdrawAmount && Number(withdrawAmount) > 0 && (
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        You&apos;ll receive approximately{' '}
                        <span className="text-slate-300">
                          KES {(Number(withdrawAmount) * (1 - feePercent / 100)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>{' '}
                        after the {feePercent}% platform fee.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestPayout}
                    disabled={!balance || balance <= 0}
                    className="w-full py-2.5 rounded-md text-sm font-medium bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Request Payout
                  </button>
                </div>
              )}

              {payoutStage === 'otp' && (
                <div className="space-y-3">
                  {otpSplit && (
                    <div className="p-3 rounded-md bg-[#0B0F17] border border-slate-800/80 text-xs space-y-1">
                      <div className="flex justify-between text-slate-400">
                        <span>Requested</span>
                        <span className="text-white">KES {otpSplit.amount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Platform fee ({feePercent}%)</span>
                        <span className="text-white">- KES {otpSplit.feeAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-slate-300 font-semibold pt-1 border-t border-slate-800/80">
                        <span>You&apos;ll receive</span>
                        <span>KES {otpSplit.netAmount.toLocaleString()}</span>
                      </div>
                    </div>
                  )}
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
                      Confirm Request
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

              {payoutStage === 'submitted' && (
                <div className="p-4 border rounded-md bg-amber-950/30 border-amber-800/50 text-center space-y-2">
                  <div className="text-sm font-mono uppercase tracking-widest text-amber-400">
                    Request Submitted
                  </div>
                  <p className="text-xs text-slate-400">
                    Your payout is awaiting admin review. You&apos;ll see it move to Processing once approved.
                  </p>
                  <button
                    type="button"
                    onClick={resetPayoutFlow}
                    className="text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white transition"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}

          {isOnboarded && history.length > 0 && (
            <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-3">
              <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
                Recent Requests
              </span>
              <div className="space-y-2">
                {history.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-md bg-[#0B0F17] border border-slate-800/60"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-white font-mono">
                        KES {p.amount.toLocaleString()}
                        {p.netAmount != null && p.netAmount !== p.amount && (
                          <span className="text-slate-500 text-xs"> (net KES {p.netAmount.toLocaleString()})</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {new Date(p.createdAt).toLocaleDateString()} &middot; {p.method}
                        {p.reference && ` \u00b7 ${p.reference}`}
                        {p.failureReason && ` \u00b7 ${p.failureReason}`}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${
                        STATUS_STYLES[p.status] || 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </div>
                ))}
              </div>
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
                <label className={labelClass}>Bank Name</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Equity Bank"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Bank M-Pesa Paybill Number</label>
                <div className="mt-1">
                  <input
                    type="text"
                    value={bankPaybill}
                    onChange={(e) => setBankPaybill(e.target.value)}
                    placeholder="e.g. 247247"
                    className={inputClass}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  The paybill number your bank uses for M-Pesa deposits — check your bank&apos;s app or ask them directly.
                </p>
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

          {settingsChallenge ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                For your security, we sent a code to {settingsChallenge.maskedEmail}. Enter it to confirm the new
                payout details.
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={settingsOtp}
                onChange={(e) => setSettingsOtp(e.target.value)}
                placeholder="6-digit code"
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirmSettingsOtp}
                  disabled={saving}
                  className="flex-1 py-2 rounded-md text-xs font-mono uppercase tracking-wider bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/60 transition disabled:opacity-50"
                >
                  {saving ? 'Confirming...' : 'Confirm Change'}
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsChallenge(null)}
                  className="px-4 py-2 rounded-md text-xs font-mono uppercase tracking-wider border border-slate-700 hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 px-4 rounded-md text-sm font-medium bg-slate-800 border border-slate-700 hover:bg-slate-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Payout Details'}
            </button>
          )}
        </div>
        </>
      )}
    </div>
  );
}
