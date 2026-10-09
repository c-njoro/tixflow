// components/dashboard/DashboardLayout.tsx
import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Bars3Icon, XMarkIcon, ArrowLeftStartOnRectangleIcon } from "@heroicons/react/24/outline";
import Sidebar, { DASHBOARD_NAV, isNavActive, Wordmark } from "./Sidebar";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/site/ThemeToggle";

const COLLAPSE_KEY = "tixflow:sidebar-collapsed";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const nav = DASHBOARD_NAV.filter((item) => !item.adminOnly || isAdmin);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);

  // Close the mobile menu on navigation.
  useEffect(() => {
    const close = () => setMenuOpen(false);
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });

  return (
    <div className="h-dvh overflow-hidden bg-ink text-slate-100 flex w-full">
      <div className="hidden md:block h-full shrink-0">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>

      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden h-14 shrink-0 flex items-center justify-between px-4 border-b border-slate-800/70 bg-ink">
          <Link href="/dashboard" aria-label="Tixflow dashboard">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="w-10 h-10 -mr-2 grid place-items-center rounded-lg text-slate-300 hover:bg-slate-800/50"
            >
              {menuOpen ? <XMarkIcon className="w-5 h-5" /> : <Bars3Icon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-10 py-6 md:py-10">{children}</div>
        </main>
      </div>

      {/* Mobile menu sheet */}
      <div
        className={`md:hidden fixed inset-x-0 top-14 bottom-0 z-40 bg-ink border-t border-slate-800/70 flex flex-col transition-[opacity,transform] duration-200 ease-out ${
          menuOpen ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        <nav className="flex-1 px-4 py-4 space-y-1">
          {nav.map((item) => {
            const active = isNavActive(router.pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-3 h-12 rounded-lg text-base font-medium ${
                  active ? "bg-slate-800/70 text-white" : "text-slate-300"
                }`}
              >
                <Icon className="w-5 h-5 text-slate-500" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800/70 p-4 space-y-3">
          {user && (
            <div className="px-3">
              <div className="text-sm font-medium text-slate-200">{user.name}</div>
              <div className="text-xs text-slate-500">{user.email}</div>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-lg border border-slate-800 text-sm font-medium text-slate-300 hover:text-rose-300"
          >
            <ArrowLeftStartOnRectangleIcon className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
