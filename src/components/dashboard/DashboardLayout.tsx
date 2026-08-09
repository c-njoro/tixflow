// components/dashboard/DashboardLayout.tsx
import { ReactNode, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import Header from "./Header";
import {
  Squares2X2Icon,
  CalendarDaysIcon,
  Bars2Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const mobileNavigation = [
    { name: "Home", href: "/dashboard", icon: Squares2X2Icon },
    { name: "Events", href: "/dashboard/events", icon: CalendarDaysIcon },
  ];

  return (
    <div className="h-screen overflow-hidden bg-[#0B0F17] text-slate-100 flex relative w-full">
      {/* SIDEBAR (DESKTOP ONLY) */}
      <div className="hidden md:block h-full shrink-0">
        <Sidebar collapsed={sidebarCollapsed} />
      </div>

      {/* MAIN WORKSPACE CONTENT CONTAINER */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        {/* Floating Centered Desktop Header */}
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Scrollable Page Content */}
        <main className="flex-1 overflow-y-auto p-5 md:p-8 pt-6 md:pt-24 pb-28 md:pb-8">
          <div className="max-w-7xl mx-auto w-full px-2 sm:px-4">
            {children}
          </div>
        </main>
      </div>

      {/* FLOATING MOBILE BOTTOM BAR */}
      <div className="fixed bottom-5 left-4 right-4 h-14 bg-[#131924]/75 backdrop-blur-xl border border-slate-800/90 shadow-[0_12px_40px_rgba(0,0,0,0.6)] rounded-xl z-50 flex md:hidden items-center justify-between px-6">
        {/* Mobile Quick Links */}
        <div className="flex items-center space-x-6">
          {mobileNavigation.map((item) => {
            const isActive = router.pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex flex-col items-center justify-center space-y-0.5 transition ${isActive ? "text-white" : "text-slate-500"}`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[9px] font-mono uppercase tracking-wider">
                  {item.name}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Center Logo */}
        <div className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase select-none">
          TIXFLOW
        </div>

        {/* Menu Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex flex-col items-center justify-center text-slate-400 hover:text-white transition"
        >
          {mobileMenuOpen ? (
            <XMarkIcon className="w-5 h-5 text-slate-200" />
          ) : (
            <Bars2Icon className="w-5 h-5" />
          )}
          <span className="text-[9px] font-mono uppercase tracking-wider mt-0.5">
            Menu
          </span>
        </button>
      </div>

      {/* MOBILE FULL SCREEN MENU DRAWER */}
      <div
        className={`fixed inset-x-0 bottom-0 top-0 bg-[#0B0F17]/98 backdrop-blur-2xl z-40 transition-all duration-300 ease-in-out md:hidden flex flex-col justify-between p-8 pt-20 ${
          mobileMenuOpen
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-full pointer-events-none"
        }`}
      >
        <div className="space-y-8">
          <div>
            <div className="font-mono text-base font-bold tracking-widest text-white">
              TIXFLOW
            </div>
            <div className="text-[10px] font-mono text-slate-500 mt-1 uppercase tracking-wider">
              Account Menu
            </div>
          </div>

          <nav className="flex flex-col space-y-3">
            {[
              { name: "Dashboard Overview", href: "/dashboard" },
              { name: "Events Manager", href: "/dashboard/events" },
              { name: "Ticket Ledgers", href: "/dashboard/tickets" },
              { name: "Settings", href: "/dashboard/settings" },
            ].map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`text-sm font-mono uppercase tracking-wider py-3 border-b border-slate-900 transition ${
                  router.pathname === item.href
                    ? "text-white border-slate-700/50"
                    : "text-slate-400"
                }`}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="border-t border-slate-900 pt-6">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="w-full text-center py-3 border border-slate-800 bg-[#131924]/60 text-xs font-mono uppercase tracking-widest text-slate-400 hover:text-white rounded-lg transition"
          >
            Close Menu
          </button>
        </div>
      </div>
    </div>
  );
}
