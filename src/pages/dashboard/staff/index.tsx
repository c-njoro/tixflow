// pages/dashboard/staff/index.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { AdminsOnly } from '@/components/site/StatusPage';
import { inputClass, labelClass } from '@/lib/ui';

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'scanner_staff';
  createdAt: string;
}


export default function StaffPage() {
  const { user } = useAuth();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'scanner_staff' });
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadStaff = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/staff');
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load staff.');
      setStaff(result.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') loadStaff();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleCreate = async () => {
    if (!newStaff.name || !newStaff.email || !newStaff.password) {
      setError('Name, email, and password are all required.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStaff),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to add staff member.');

      setStaff((prev) => [...prev, result.data]);
      setNewStaff({ name: '', email: '', password: '', role: 'scanner_staff' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (id: string, role: string) => {
    setUpdatingId(id);
    setError('');
    try {
      const res = await fetch(`/api/staff/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update role.');

      setStaff((prev) => prev.map((s) => (s.id === id ? result.data : s)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this staff member? They will lose access immediately.')) return;
    setError('');
    try {
      const res = await fetch(`/api/staff/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to remove staff member.');

      setStaff((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <AdminsOnly what="manage staff" />
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="font-display tracking-tight text-2xl font-semibold text-white">
          Staff
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage who can access this workspace
        </p>
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">
          {error}
        </div>
      )}

      {/* Add staff */}
      <div className="p-5 bg-panel border border-slate-800/80 rounded-xl space-y-4">
        <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">
          Add Staff Member
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className={labelClass}>Name</label>
            <div className="mt-1">
              <input
                type="text"
                value={newStaff.name}
                onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                placeholder="John Kamau"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <div className="mt-1">
              <input
                type="email"
                value={newStaff.email}
                onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                placeholder="john@example.com"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Password</label>
            <div className="mt-1">
              <input
                type="password"
                value={newStaff.password}
                onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                placeholder="min. 8 characters"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <div className="mt-1">
              <select
                value={newStaff.role}
                onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                className={inputClass}
              >
                <option value="scanner_staff">Scanner Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-2 text-[13px] bg-slate-800 border border-slate-700 rounded-md text-white hover:bg-slate-700 transition disabled:opacity-50 font-medium"
        >
          {creating ? 'Adding...' : '+ Add Staff Member'}
        </button>
      </div>

      {/* Staff list */}
      {loading ? (
        <div className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">
          Loading staff...
        </div>
      ) : (
        <div className="border border-slate-800/80 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left">
              <tr>
                <th className="p-3 text-xs uppercase tracking-[0.06em] text-slate-500 font-medium">Name</th>
                <th className="p-3 text-xs uppercase tracking-[0.06em] text-slate-500 font-medium">Email</th>
                <th className="p-3 text-xs uppercase tracking-[0.06em] text-slate-500 font-medium">Role</th>
                <th className="p-3 text-xs uppercase tracking-[0.06em] text-slate-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => {
                const isSelf = user?.id === member.id;
                return (
                  <tr key={member.id} className="border-t border-slate-800/80">
                    <td className="p-3 text-white">
                      {member.name} {isSelf && <span className="text-slate-500">(you)</span>}
                    </td>
                    <td className="p-3 text-slate-400">{member.email}</td>
                    <td className="p-3">
                      <select
                        value={member.role}
                        disabled={isSelf || updatingId === member.id}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        className={`${inputClass} w-auto py-1 disabled:opacity-50`}
                      >
                        <option value="scanner_staff">Scanner Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => handleRemove(member.id)}
                        disabled={isSelf}
                        className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}