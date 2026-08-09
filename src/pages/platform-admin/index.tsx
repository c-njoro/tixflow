// pages/platform-admin/index.tsx
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

interface TenantBalance {
  id: string;
  businessName: string;
  slug: string;
  payoutMethod: 'mpesa' | 'bank' | null;
  payoutPhoneNumber: string | null;
  payoutBankName: string | null;
  payoutBankAccountName: string | null;
  payoutBankAccountNumber: string | null;
  isOnboarded: boolean;
  totalRevenue: number;
  platformFeePercent: number;
  netPayable: number;
  totalPaidOut: number;
  outstandingBalance: number;
}

interface PayoutRecord {
  id: string;
  amount: number;
  method: string;
  status: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

const inputClass =
  'block w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition';

export default function PlatformAdminDashboard() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [payingTenant, setPayingTenant] = useState<TenantBalance | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutReference, setPayoutReference] = useState('');
  const [payoutNote, setPayoutNote] = useState('');
  const [recording, setRecording] = useState(false);

  const [historyTenantId, setHistoryTenantId] = useState<string | null>(null);
  const [history, setHistory] = useState<PayoutRecord[]>([]);

  const loadTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/platform-admin/tenants');
      if (res.status === 401) {
        router.push('/platform-admin/login');
        return;
      }
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load tenants.');
      setTenants(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPayoutForm = (tenant: TenantBalance) => {
    setPayingTenant(tenant);
    setPayoutAmount(tenant.outstandingBalance.toFixed(2));
    setPayoutReference('');
    setPayoutNote('');
  };

  const handleRecordPayout = async () => {
    if (!payingTenant) return;
    setRecording(true);
    setError('');
    try {
      const res = await fetch('/api/platform-admin/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: payingTenant.id,
          amount: payoutAmount,
          method: payingTenant.payoutMethod || 'mpesa',
          reference: payoutReference,
          note: payoutNote,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to record payout.');

      setPayingTenant(null);
      loadTenants();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRecording(false);
    }
  };

  const toggleHistory = async (tenantId: string) => {
    if (historyTenantId === tenantId) {
      setHistoryTenantId(null);
      return;
    }
    setHistoryTenantId(tenantId);
    const res = await fetch(`/api/platform-admin/payouts?tenantId=${tenantId}`);
    const result = await res.json();
    if (res.ok) setHistory(result.data);
  };

  const handleLogout = async () => {
    await fetch('/api/platform-admin/logout', { method: 'POST' });
    router.push('/platform-admin/login');
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-mono font-bold tracking-wider uppercase">
            Payouts
          </h1>
          <button
            onClick={handleLogout}
            className="text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white transition"
          >
            Log Out
          </button>
        </div>

        {error && (
          <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            Loading...
          </div>
        ) : (
          <div className="space-y-3">
            {tenants.map((tenant) => (
              <div key={tenant.id} className="border border-slate-800/80 rounded-xl overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">{tenant.businessName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {tenant.payoutMethod === 'mpesa'
                        ? `M-Pesa: ${tenant.payoutPhoneNumber}`
                        : tenant.payoutMethod === 'bank'
                        ? `${tenant.payoutBankName} — ${tenant.payoutBankAccountName} (${tenant.payoutBankAccountNumber})`
                        : 'No payout method configured'}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Revenue: KES {tenant.totalRevenue.toLocaleString()} &middot; Fee: {tenant.platformFeePercent}% &middot; Paid out: KES {tenant.totalPaidOut.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-mono font-bold">
                      KES {tenant.outstandingBalance.toLocaleString()}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                      outstanding
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-4 flex gap-2">
                  <button
                    onClick={() => openPayoutForm(tenant)}
                    disabled={tenant.outstandingBalance <= 0 || !tenant.payoutMethod}
                    className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Mark as Paid
                  </button>
                  <button
                    onClick={() => toggleHistory(tenant.id)}
                    className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md hover:bg-slate-800 transition"
                  >
                    {historyTenantId === tenant.id ? 'Hide History' : 'View History'}
                  </button>
                </div>

                {historyTenantId === tenant.id && (
                  <div className="border-t border-slate-800/80 p-4 space-y-2">
                    {history.length === 0 ? (
                      <p className="text-xs text-slate-600">No payouts recorded yet.</p>
                    ) : (
                      history.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <div className="text-slate-400">
                            {new Date(p.createdAt).toLocaleDateString()} &middot; {p.method}
                            {p.reference && ` \u00b7 ${p.reference}`}
                          </div>
                          <div className="font-mono text-white">KES {p.amount.toLocaleString()}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Payout form */}
                {payingTenant?.id === tenant.id && (
                  <div className="border-t border-slate-800/80 p-4 space-y-3">
                    <input
                      type="number"
                      step="0.01"
                      value={payoutAmount}
                      onChange={(e) => setPayoutAmount(e.target.value)}
                      placeholder="Amount"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      value={payoutReference}
                      onChange={(e) => setPayoutReference(e.target.value)}
                      placeholder="M-Pesa code or bank reference"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      value={payoutNote}
                      onChange={(e) => setPayoutNote(e.target.value)}
                      placeholder="Note (optional)"
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleRecordPayout}
                        disabled={recording}
                        className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 rounded-md hover:bg-emerald-950/60 transition disabled:opacity-50"
                      >
                        {recording ? 'Recording...' : 'Confirm Sent'}
                      </button>
                      <button
                        onClick={() => setPayingTenant(null)}
                        className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md hover:bg-slate-800 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}