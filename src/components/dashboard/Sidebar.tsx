// components/dashboard/Sidebar.tsx
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Squares2X2Icon,
  CalendarDaysIcon,
  UserGroupIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/context/AuthContext';

interface SidebarProps {
  collapsed: boolean;
}

export default function Sidebar({ collapsed }: SidebarProps) {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const navItems = [
    { name: 'Overview', href: '/dashboard', icon: Squares2X2Icon, adminOnly: false },
    { name: 'Events Manager', href: '/dashboard/events', icon: CalendarDaysIcon, adminOnly: false },
    // Staff and Settings involve revenue, payouts, and teammate emails —
    // scanner_staff accounts don't see them at all, not even the nav link.
    { name: 'Staff', href: '/dashboard/staff', icon: UserGroupIcon, adminOnly: true },
    { name: 'Settings', href: '/dashboard/settings', icon: Cog6ToothIcon, adminOnly: true },
  ].filter((item) => !item.adminOnly || isAdmin);

  const isItemActive = (href: string) =>
    href === '/dashboard' ? router.pathname === '/dashboard' : router.pathname.startsWith(href);

  return (
    <aside className={`h-screen bg-[#0E131F] border-r border-slate-800/80 transition-all duration-300 flex flex-col justify-between ${collapsed ? 'w-20' : 'w-64'}`}>
      <div className="p-6">
        <div className={`font-mono text-sm font-semibold tracking-wider text-white ${collapsed ? 'text-center' : ''}`}>
          {collapsed ? 'T' : <>TIXFLOW<span className="text-slate-500">.OS</span></>}
        </div>

        <nav className="mt-10 space-y-2">
          {navItems.map((item) => {
            const isActive = isItemActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center rounded-lg transition-all duration-200 ${
                  collapsed ? 'justify-center p-3' : 'px-4 py-2.5 space-x-3'
                } ${isActive ? 'bg-slate-800 text-white border border-slate-700/60' : 'text-slate-400 hover:text-white hover:bg-slate-900/40'}`}
                title={item.name}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="text-xs font-mono uppercase tracking-wider font-medium">{item.name}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      {!collapsed && (
        <div className="p-4 border-t border-slate-800/80 bg-[#0B0F17]/30 text-center">
          <p className="text-[10px] font-mono text-slate-500 uppercase">System Active Context</p>
        </div>
      )}
    </aside>
  );
}