// pages/dashboard/settings/index.tsx
import Link from 'next/link';
import { BanknotesIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';

const SETTINGS_LINKS = [
  {
    href: '/dashboard/settings/payouts',
    icon: BanknotesIcon,
    title: 'Payouts',
    description: 'M-Pesa or bank details for receiving your ticket revenue, and requesting withdrawals.',
  },
];

export default function SettingsIndexPage() {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return (
      <div className="p-6 border border-dashed border-slate-800 rounded-xl bg-[#0B0F17]/40 text-center">
        <p className="text-sm text-slate-400">Only admins can view settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h1 className="font-display tracking-tight text-2xl font-semibold text-white">
          Settings
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your workspace
        </p>
      </div>

      <div className="space-y-3">
        {SETTINGS_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-start gap-4 p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl hover:border-slate-600 transition"
          >
            <link.icon className="w-6 h-6 text-slate-400 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-white">{link.title}</div>
              <div className="text-xs text-slate-500 mt-1">{link.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}