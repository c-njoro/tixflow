// components/dashboard/Sidebar.tsx
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Squares2X2Icon,
  CalendarDaysIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  MegaphoneIcon,
  ArrowLeftStartOnRectangleIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const DASHBOARD_NAV = [
  { name: 'Overview', href: '/dashboard', icon: Squares2X2Icon, adminOnly: false },
  { name: 'Events', href: '/dashboard/events', icon: CalendarDaysIcon, adminOnly: false },
  // Promoters, Staff and Settings involve revenue, payouts and teammate
  // emails — scanner_staff accounts don't see them at all.
  { name: 'Promoters', href: '/dashboard/promoters', icon: MegaphoneIcon, adminOnly: true },
  { name: 'Staff', href: '/dashboard/staff', icon: UserGroupIcon, adminOnly: true },
  { name: 'Settings', href: '/dashboard/settings', icon: Cog6ToothIcon, adminOnly: true },
];

export const isNavActive = (pathname: string, href: string) =>
  href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <span
        aria-hidden
        className="grid place-items-center w-7 h-7 rounded-lg bg-slate-100 text-[#0B0F17] font-display text-[15px] font-bold leading-none"
      >
        t
      </span>
      {!compact && <span className="font-display text-[17px] font-semibold text-white">tixflow</span>}
    </span>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navItems = DASHBOARD_NAV.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={`h-screen bg-[#0E131F] border-r border-slate-800/70 transition-[width] duration-200 flex flex-col ${
        collapsed ? 'w-[72px]' : 'w-60'
      }`}
    >
      <div className={`h-[72px] flex items-center ${collapsed ? 'justify-center' : 'px-5'}`}>
        <Link href="/dashboard" aria-label="Tixflow dashboard">
          <Wordmark compact={collapsed} />
        </Link>
      </div>

      <nav className={`flex-1 space-y-0.5 ${collapsed ? 'px-3' : 'px-3'}`}>
        {navItems.map((item) => {
          const active = isNavActive(router.pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              title={collapsed ? item.name : undefined}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-3 rounded-lg text-sm transition-colors ${
                collapsed ? 'justify-center h-10' : 'px-3 h-9'
              } ${active ? 'bg-slate-800/70 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/30'}`}
            >
              <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`} />
              {!collapsed && <span className="font-medium">{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-slate-800/70 ${collapsed ? 'p-3' : 'p-3'}`}>
        {!collapsed && user && (
          <div className="px-3 pt-1 pb-2">
            <div className="text-sm font-medium text-slate-200 truncate">{user.name}</div>
            <div className="text-xs text-slate-500 truncate">
              {user.role === 'admin' ? 'Admin' : 'Gate staff'} · {user.email}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={logout}
          title="Sign out"
          className={`w-full flex items-center gap-3 rounded-lg text-sm text-slate-400 hover:text-rose-300 hover:bg-rose-950/20 transition-colors ${
            collapsed ? 'justify-center h-10' : 'px-3 h-9'
          }`}
        >
          <ArrowLeftStartOnRectangleIcon className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span className="font-medium">Sign out</span>}
        </button>
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`mt-0.5 w-full flex items-center gap-3 rounded-lg text-sm text-slate-500 hover:text-slate-200 hover:bg-slate-800/30 transition-colors ${
            collapsed ? 'justify-center h-10' : 'px-3 h-9'
          }`}
        >
          {collapsed ? (
            <ChevronDoubleRightIcon className="w-[18px] h-[18px] shrink-0" />
          ) : (
            <ChevronDoubleLeftIcon className="w-[18px] h-[18px] shrink-0" />
          )}
          {!collapsed && <span className="font-medium">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
