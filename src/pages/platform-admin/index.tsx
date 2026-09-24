// pages/platform-admin/index.tsx
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

interface TenantBalance {
  id: string;
  businessName: string;
  slug: string;
  payoutMethod: 'mpesa' | 'bank' | null;
  payoutPhoneNumber: string | null;
  payoutBankName: string | null;
  payoutBankPaybill: string | null;
  payoutBankAccountName: string | null;
  payoutBankAccountNumber: string | null;
  isOnboarded: boolean;
  totalRevenue: number;
  platformFeePercent: number;
  totalPaidOrPending: number;
  outstandingBalance: number;
  totalPaidOut: number;
  pendingApprovalCount: number;
}

interface PayoutRequest {
  id: string;
  amount: number;
  feePercent: number | null;
  feeAmount: number | null;
  netAmount: number | null;
  method: string;
  status: string;
  destination: string | null;
  createdAt: string;
  tenant: { id: string; businessName: string; slug: string };
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
  const [tab, setTab] = useState<'requests' | 'tenants' | 'whatsapp'>('requests');

  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

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

  const loadRequests = async () => {
    setRequestsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/platform-admin/payout-requests?status=pending_approval');
      if (res.status === 401) {
        router.push('/platform-admin/login');
        return;
      }
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load payout requests.');
      setRequests(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRequestsLoading(false);
    }
  };

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
    loadRequests();
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async (id: string) => {
    setActioningId(id);
    setError('');
    try {
      const res = await fetch(`/api/platform-admin/payout-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to approve payout.');
      await loadRequests();
      await loadTenants();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActioningId(id);
    setError('');
    try {
      const res = await fetch(`/api/platform-admin/payout-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', note: rejectNote }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to reject payout.');
      setRejectingId(null);
      setRejectNote('');
      await loadRequests();
      await loadTenants();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActioningId(null);
    }
  };

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

  // --- WhatsApp connection (Baileys) ---
  const [waStatus, setWaStatus] = useState<{
    status: 'disconnected' | 'connecting' | 'qr_pending' | 'connected';
    qr: string | null;
    phoneNumber: string | null;
    lastError: string | null;
  } | null>(null);
  const [waActionLoading, setWaActionLoading] = useState(false);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWaStatus = async () => {
    try {
      const res = await fetch('/api/platform-admin/whatsapp/status');
      if (res.status === 401) return;
      const result = await res.json();
      if (res.ok) setWaStatus(result.data);
    } catch {
      // transient — next poll tick will retry
    }
  };

  useEffect(() => {
    if (tab !== 'whatsapp') return;
    loadWaStatus();
    waPollRef.current = setInterval(loadWaStatus, 3000);
    return () => {
      if (waPollRef.current) clearInterval(waPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleWaConnect = async () => {
    setWaActionLoading(true);
    try {
      await fetch('/api/platform-admin/whatsapp/connect', { method: 'POST' });
      await loadWaStatus();
    } finally {
      setWaActionLoading(false);
    }
  };

  const handleWaLogout = async () => {
    setWaActionLoading(true);
    try {
      await fetch('/api/platform-admin/whatsapp/logout', { method: 'POST' });
      await loadWaStatus();
    } finally {
      setWaActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-mono font-bold tracking-wider uppercase">
            Platform Admin
          </h1>
          <button
            onClick={handleLogout}
            className="text-xs font-mono uppercase tracking-wider text-slate-500 hover:text-white transition"
          >
            Log Out
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-800/80">
          <button
            onClick={() => setTab('requests')}
            className={`px-3 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition ${
              tab === 'requests' ? 'border-white text-white' : 'border-transparent text-slate-500 hover:text-white'
            }`}
          >
            Requests{requests.length > 0 ? ` (${requests.length})` : ''}
          </button>
          <button
            onClick={() => setTab('tenants')}
            className={`px-3 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition ${
              tab === 'tenants' ? 'border-white text-white' : 'border-transparent text-slate-500 hover:text-white'
            }`}
          >
            Tenants
          </button>
          <button
            onClick={() => setTab('whatsapp')}
            className={`px-3 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition ${
              tab === 'whatsapp' ? 'border-white text-white' : 'border-transparent text-slate-500 hover:text-white'
            }`}
          >
            WhatsApp
          </button>
        </div>

        {error && (
          <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
            {error}
          </div>
        )}

        {tab === 'requests' && (
          <div className="space-y-3">
            {requestsLoading ? (
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                Loading...
              </div>
            ) : requests.length === 0 ? (
              <div className="p-6 border border-dashed border-slate-800 rounded-xl text-center">
                <p className="text-sm text-slate-500">No payout requests awaiting review.</p>
              </div>
            ) : (
              requests.map((r) => (
                <div key={r.id} className="border border-slate-800/80 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{r.tenant.businessName}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{r.destination}</div>
                      <div className="text-xs text-slate-600 mt-1">
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-mono font-bold">
                        KES {r.amount.toLocaleString()}
                      </div>
                      {r.feeAmount != null && (
                        <div className="text-[11px] text-slate-500">
                          fee KES {r.feeAmount.toLocaleString()} &middot; net KES {(r.netAmount ?? r.amount).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {rejectingId === r.id ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Reason (optional)"
                        className={inputClass}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReject(r.id)}
                          disabled={actioningId === r.id}
                          className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-rose-950/40 border border-rose-800/50 text-rose-400 rounded-md hover:bg-rose-950/60 transition disabled:opacity-50"
                        >
                          {actioningId === r.id ? 'Rejecting...' : 'Confirm Reject'}
                        </button>
                        <button
                          onClick={() => setRejectingId(null)}
                          className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md hover:bg-slate-800 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(r.id)}
                        disabled={actioningId === r.id}
                        className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 rounded-md hover:bg-emerald-950/60 transition disabled:opacity-50"
                      >
                        {actioningId === r.id ? 'Sending...' : `Approve & Send ${r.method === 'mpesa' ? 'M-Pesa' : 'Bank'}`}
                      </button>
                      <button
                        onClick={() => setRejectingId(r.id)}
                        disabled={actioningId === r.id}
                        className="px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-slate-700 rounded-md hover:bg-slate-800 transition disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'tenants' &&
          (loading ? (
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
                          ? `${tenant.payoutBankName} (paybill ${tenant.payoutBankPaybill}) — ${tenant.payoutBankAccountName} (${tenant.payoutBankAccountNumber})`
                          : 'No payout method configured'}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Revenue: KES {tenant.totalRevenue.toLocaleString()} &middot; Fee: {tenant.platformFeePercent}% per withdrawal &middot; Paid out: KES {tenant.totalPaidOut.toLocaleString()}
                        {tenant.pendingApprovalCount > 0 && (
                          <> &middot; <span className="text-amber-400">{tenant.pendingApprovalCount} pending</span></>
                        )}
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
                      Mark as Paid Manually
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
                              {new Date(p.createdAt).toLocaleDateString()} &middot; {p.method} &middot; {p.status}
                              {p.reference && ` \u00b7 ${p.reference}`}
                            </div>
                            <div className="font-mono text-white">KES {p.amount.toLocaleString()}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {payingTenant?.id === tenant.id && (
                    <div className="border-t border-slate-800/80 p-4 space-y-3">
                      <p className="text-[11px] text-slate-500">
                        Use this only for a transfer you already sent outside the app (e.g. cash). It skips the
                        approval queue and platform fee entirely.
                      </p>
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
          ))}

        {tab === 'whatsapp' && (
          <div className="space-y-4 max-w-md mx-auto">
            <div className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
                  Ticket Delivery Number
                </span>
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded border ${
                    waStatus?.status === 'connected'
                      ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                      : waStatus?.status === 'qr_pending' || waStatus?.status === 'connecting'
                      ? 'bg-amber-950/40 text-amber-400 border-amber-800/50'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {waStatus?.status === 'connected'
                    ? 'Connected'
                    : waStatus?.status === 'qr_pending'
                    ? 'Scan QR'
                    : waStatus?.status === 'connecting'
                    ? 'Connecting'
                    : 'Disconnected'}
                </span>
              </div>

              <p className="text-[11px] text-slate-500">
                This is an unofficial WhatsApp connection (not Meta&apos;s Business API) — a convenience channel
                alongside email, not a replacement for it. It can disconnect without warning; switch to the
                official API once your business account is approved.
              </p>

              {waStatus?.lastError && (
                <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
                  {waStatus.lastError}
                </div>
              )}

              {waStatus?.status === 'connected' ? (
                <div className="space-y-3">
                  <div className="text-sm text-white font-mono">
                    +{waStatus.phoneNumber}
                  </div>
                  <button
                    onClick={handleWaLogout}
                    disabled={waActionLoading}
                    className="w-full py-2 rounded-md text-xs font-mono uppercase tracking-wider bg-rose-950/40 border border-rose-800/50 text-rose-400 hover:bg-rose-950/60 transition disabled:opacity-50"
                  >
                    {waActionLoading ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              ) : waStatus?.status === 'qr_pending' && waStatus.qr ? (
                <div className="space-y-3 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={waStatus.qr}
                    alt="WhatsApp QR code"
                    className="mx-auto rounded-lg border border-slate-800"
                    width={220}
                    height={220}
                  />
                  <p className="text-xs text-slate-500">
                    Open WhatsApp on the phone that should send tickets → Linked Devices → Link a Device, and scan
                    this code.
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleWaConnect}
                  disabled={waActionLoading || waStatus?.status === 'connecting'}
                  className="w-full py-2.5 rounded-md text-sm font-medium bg-emerald-950/40 border border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/60 transition disabled:opacity-50"
                >
                  {waActionLoading || waStatus?.status === 'connecting' ? 'Starting...' : 'Connect WhatsApp'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
