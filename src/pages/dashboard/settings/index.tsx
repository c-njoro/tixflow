// pages/dashboard/settings/index.tsx
import Link from 'next/link';
import { BanknotesIcon, CreditCardIcon } from '@heroicons/react/24/outline';

const SETTINGS_LINKS = [
  {
    href: '/dashboard/settings/payouts',
    icon: BanknotesIcon,
    title: 'Payouts',
    description: 'M-Pesa or bank details for receiving your ticket revenue.',
  },
  {
    href: '/dashboard/settings/payments',
    icon: CreditCardIcon,
    title: 'Payments (Stripe)',
    description: 'Optional card payments via Stripe Connect.',
  },
];

export default function SettingsIndexPage() {
  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-wider text-white uppercase">
          Settings
        </h1>
        <p className="text-xs font-mono text-slate-500 mt-1 uppercase tracking-wider">
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