// components/site/StatusPage.tsx
//
// What people see when something isn't there or doesn't work: the 404 / 403 /
// 500 pages (src/pages/404.tsx etc. and _error.tsx), the crash screen
// (ErrorBoundary), and the smaller in-page states (a link that's no longer
// valid, an admin-only screen). One look for all of them: the code written
// like a ticket code with the gate scanner's verdict next to it, a plain
// headline, what to do next.
import Head from "next/head";
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/dashboard/Sidebar";
import { ThemeToggle } from "@/components/site/ThemeToggle";

export interface StatusAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface StatusContent {
  verdict: string; // the pill, in the gate scanner's words
  tone: "rose" | "amber";
  title: string;
  message: string;
  actions: StatusAction[];
}

const HOME: StatusAction = { label: "Browse events", href: "/" };
const MY_TICKETS: StatusAction = { label: "Find my tickets", href: "/lookup" };

const CONTENT: Record<number, StatusContent> = {
  400: {
    verdict: "Bad request",
    tone: "amber",
    title: "That link doesn't look right.",
    message: "Part of the address is missing or damaged. If it came from an email or WhatsApp message, open it from there again.",
    actions: [HOME, MY_TICKETS],
  },
  401: {
    verdict: "Not signed in",
    tone: "amber",
    title: "Log in to continue.",
    message: "This page is part of an organiser's workspace. Log in and we'll take you there.",
    actions: [{ label: "Log in", href: "/auth" }, HOME],
  },
  403: {
    verdict: "No access",
    tone: "amber",
    title: "You don't have access to this.",
    message: "This area is for the account's admins. Ask the account owner to give you access, or log in with a different account.",
    actions: [{ label: "Go to dashboard", href: "/dashboard" }, { label: "Log in as someone else", href: "/auth" }],
  },
  404: {
    verdict: "Not found",
    tone: "rose",
    title: "This page isn't on the list.",
    message: "The link may be old or mistyped. Events that have been unpublished end up here too.",
    actions: [HOME, MY_TICKETS],
  },
  429: {
    verdict: "Slow down",
    tone: "amber",
    title: "Too many attempts.",
    message: "Wait a few minutes, then try again.",
    actions: [HOME],
  },
  500: {
    verdict: "Error",
    tone: "rose",
    title: "Something broke on our side.",
    message:
      "It's not you. Try again in a moment. If you were in the middle of paying, check for an M-Pesa message first: Find my tickets shows anything that went through.",
    actions: [{ label: "Try again" }, MY_TICKETS],
  },
  503: {
    verdict: "Unavailable",
    tone: "amber",
    title: "Tixflow is taking a short break.",
    message: "We're doing some work behind the scenes. Give it a minute and try again.",
    actions: [{ label: "Try again" }],
  },
};

// Anything without its own entry: client errors read as "not found"-ish, server errors as 500.
export function statusContent(code: number): StatusContent {
  if (CONTENT[code]) return CONTENT[code];
  return code >= 500 ? CONTENT[500] : { ...CONTENT[404], verdict: "Problem", title: "That didn't work." };
}

const TONES = {
  rose: "bg-rose-950/40 text-rose-400",
  amber: "bg-amber-950/40 text-amber-400",
};

function Verdict({ code, verdict, tone }: { code?: string; verdict: string; tone: "rose" | "amber" }) {
  return (
    <p className="inline-flex items-center gap-3">
      {code && <span className="font-mono text-sm text-slate-400">{code}</span>}
      <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded font-medium ${TONES[tone]}`}>{verdict}</span>
    </p>
  );
}

const reload = () => window.location.reload();

function Actions({ actions, align = "start" }: { actions: StatusAction[]; align?: "start" | "center" }) {
  if (actions.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-3 ${align === "center" ? "justify-center" : ""}`}>
      {actions.map((action, i) => {
        const className =
          i === 0
            ? "h-11 px-5 inline-flex items-center rounded-xl text-sm font-medium bg-slate-100 text-ink hover:bg-white transition-colors"
            : "h-11 px-5 inline-flex items-center rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800/50 transition-colors";
        return action.href ? (
          <Link key={action.label} href={action.href} className={className}>
            {action.label}
          </Link>
        ) : (
          // No href: retry by loading the page again.
          <button key={action.label} type="button" onClick={action.onClick ?? reload} className={className}>
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

// A whole page: 404, 403, 500, a crash.
export default function StatusPage({
  code,
  label,
  content,
}: {
  code?: number;
  label?: string; // shown instead of TIX-<code> when there's no HTTP code (e.g. a crash)
  content?: Partial<StatusContent>;
}) {
  const c = { ...statusContent(code ?? 500), ...content };
  return (
    <div className="min-h-dvh bg-ink text-white flex flex-col">
      <Head>
        <title>{`${c.title.replace(/\.$/, "")} · Tixflow`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <header className="max-w-6xl w-full mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" aria-label="Tixflow home">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 flex flex-col justify-center py-16">
        <Verdict code={label ?? `TIX-${code}`} verdict={c.verdict} tone={c.tone} />
        <h1 className="mt-6 font-display text-5xl sm:text-7xl leading-[0.98] font-semibold max-w-3xl">{c.title}</h1>
        <p className="mt-6 text-lg text-slate-400 max-w-xl leading-relaxed">{c.message}</p>
        <div className="mt-10">
          <Actions actions={c.actions} />
        </div>
      </main>
    </div>
  );
}

// The same thing at the size of a panel, for inside a page that already has
// its own header or sidebar.
export function StatusBlock({
  label,
  verdict,
  tone = "rose",
  title,
  message,
  actions = [],
  children,
}: {
  label?: string;
  verdict: string;
  tone?: "rose" | "amber";
  title: string;
  message?: ReactNode;
  actions?: StatusAction[];
  children?: ReactNode;
}) {
  return (
    <div className="max-w-md mx-auto text-center py-16 px-2">
      <Verdict code={label} verdict={verdict} tone={tone} />
      <h1 className="mt-4 font-display text-2xl font-semibold text-white">{title}</h1>
      {message && <p className="mt-2 text-sm text-slate-400 leading-relaxed">{message}</p>}
      {children}
      {actions.length > 0 && (
        <div className="mt-6">
          <Actions actions={actions} align="center" />
        </div>
      )}
    </div>
  );
}

// Dashboard screens only admins can open (gate staff accounts land here).
export function AdminsOnly({ what }: { what: string }) {
  return (
    <StatusBlock
      label="TIX-403"
      verdict="No access"
      tone="amber"
      title="Admins only"
      message={`Only this account's admins can ${what}. Ask the account owner if you need access.`}
      actions={[{ label: "Back to overview", href: "/dashboard" }]}
    />
  );
}
