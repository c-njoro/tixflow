// components/site/SiteChrome.tsx
//
// Header and footer for the public pages (events listing, organisers,
// search, ticket lookup).
import Link from "next/link";
import { Wordmark } from "@/components/dashboard/Sidebar";

export function SiteHeader({ cta = "organiser" }: { cta?: "organiser" | "buyer" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-[#0B0F17]/90 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" aria-label="Tixflow home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          <Link href="/lookup" className="px-3 h-9 inline-flex items-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors">
            My tickets
          </Link>
          {cta === "organiser" ? (
            <Link href="/organisers" className="hidden sm:inline-flex px-3 h-9 items-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors">
              For organisers
            </Link>
          ) : (
            <Link href="/" className="hidden sm:inline-flex px-3 h-9 items-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors">
              Browse events
            </Link>
          )}
          <Link href="/auth" className="hidden sm:inline-flex px-3 h-9 items-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/40 transition-colors">
            Log in
          </Link>
          <Link
            href="/auth"
            className="ml-1 px-4 h-9 inline-flex items-center rounded-lg bg-slate-100 text-[#0B0F17] font-medium hover:bg-white transition-colors"
          >
            Create event
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800/60">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-2">
          <Wordmark />
          <p className="text-sm text-slate-500">Tickets for events across Kenya. M-Pesa and card.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
          <Link href="/" className="hover:text-white transition-colors">Events</Link>
          <Link href="/lookup" className="hover:text-white transition-colors">My tickets</Link>
          <Link href="/organisers" className="hover:text-white transition-colors">For organisers</Link>
          <Link href="/auth" className="hover:text-white transition-colors">Log in</Link>
        </nav>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-8 text-xs text-slate-600">&copy; {new Date().getFullYear()} Tixflow</div>
    </footer>
  );
}
