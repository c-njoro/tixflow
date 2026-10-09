// pages/space/[code]/index.tsx
//
// The attendee's view of an Event Space. Opened from the QR code at the
// venue or the link sent to ticket holders — no login or app needed.
import { FormEvent, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import {
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  SignalIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowUpIcon,
  MegaphoneIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useSpaceState } from '@/components/space/useSpaceState';
import PollResults from '@/components/space/PollResults';
import DocumentPage from '@/components/space/DocumentPage';
import type { ParticipantState, PublicSpaceState, SpaceDocument } from '@/components/space/types';
import { cardClass, inputClass } from '@/lib/ui';

type Tab = 'live' | 'documents' | 'questions';

const NAME_STORAGE_KEY = 'tixflow_space_name';


const timeAgo = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again.');

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Try again.');
  return json;
}

export default function SpacePage() {
  const router = useRouter();
  const code = typeof router.query.code === 'string' ? router.query.code.toUpperCase() : undefined;
  const { state, me, notFound, offline, refresh } = useSpaceState(code);
  const [tab, setTab] = useState<Tab>('live');

  // Document viewer: by default you follow whatever the presenter shows;
  // flipping pages yourself detaches until you tap "Back to live".
  const [following, setFollowing] = useState(true);
  const [ownView, setOwnView] = useState<{ documentId: string; page: number } | null>(null);

  useEffect(() => {
    if (!code) return;
    post(`/api/space/${code}/join`, {})
      .catch(() => {})
      .finally(() => refresh(true));
  }, [code, refresh]);

  if (notFound) {
    return (
      <Shell>
        <div className="text-center pt-24 px-6">
          <h1 className="text-xl font-semibold">Space not found</h1>
          <p className="text-sm text-slate-400 mt-2">Check the link or scan the QR code at the venue again.</p>
        </div>
      </Shell>
    );
  }

  if (!state || !me) {
    return (
      <Shell>
        <div className="pt-32 text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">Joining...</div>
      </Shell>
    );
  }

  if (!state.isOpen) {
    return (
      <Shell title={state.title}>
        <Header state={state} />
        <div className={`${cardClass} m-4 text-center`}>
          <p className="text-sm text-slate-300">This space isn&apos;t open right now.</p>
          <p className="text-xs text-slate-500 mt-1">It&apos;ll update here automatically when the organiser opens it.</p>
        </div>
      </Shell>
    );
  }

  const presenting = state.live ? state.documents.find((d) => d.id === state.live!.documentId) : undefined;
  const view =
    following && state.live && presenting
      ? { doc: presenting, page: state.live.page, isLive: true }
      : (() => {
          const doc = state.documents.find((d) => d.id === ownView?.documentId);
          return doc ? { doc, page: Math.min(ownView!.page, doc.pageCount), isLive: false } : null;
        })();

  const openDocument = (doc: SpaceDocument) => {
    if (presenting && doc.id === presenting.id) {
      setFollowing(true);
    } else {
      setFollowing(false);
      setOwnView({ documentId: doc.id, page: 1 });
    }
    setTab('documents');
  };

  const flip = (delta: number) => {
    if (!view) return;
    const page = Math.min(Math.max(view.page + delta, 1), view.doc.pageCount);
    setFollowing(false);
    setOwnView({ documentId: view.doc.id, page });
  };

  const followLive = () => {
    setFollowing(true);
    setTab('documents');
  };

  return (
    <Shell title={state.title}>
      <Header state={state} offline={offline} />

      <main className="max-w-2xl mx-auto px-4 pb-28 space-y-4">
        {tab === 'live' && (
          // Keyed by poll so the answer form starts fresh when the organiser switches polls.
          <LiveTab
            key={state.poll?.id ?? 'no-poll'}
            state={state}
            me={me}
            code={code!}
            refresh={refresh}
            presenting={presenting}
            onFollow={followLive}
          />
        )}

        {tab === 'documents' && (
          <div className="space-y-4">
            {view ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFollowing(false);
                      setOwnView(null);
                    }}
                    className="text-[13px] text-slate-400 hover:text-white font-medium"
                  >
                    All documents
                  </button>
                  {view.isLive ? (
                    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-emerald-400 font-medium">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Following live
                    </span>
                  ) : (
                    presenting && (
                      <button
                        type="button"
                        onClick={followLive}
                        className="px-3 py-1.5 text-xs rounded-md bg-emerald-500 text-[#000] font-semibold"
                      >
                        Back to live · p.{state.live!.page}
                      </button>
                    )
                  )}
                </div>
                <h2 className="text-base font-semibold">{view.doc.title}</h2>
                <DocumentPage doc={view.doc} page={view.page} />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => flip(-1)}
                    disabled={view.page <= 1}
                    className="p-2.5 border border-slate-800 rounded-md disabled:opacity-30"
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon className="w-5 h-5" />
                  </button>
                  <span className="text-xs tabular-nums text-slate-400">
                    Page {view.page} of {view.doc.pageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => flip(1)}
                    disabled={view.page >= view.doc.pageCount}
                    className="p-2.5 border border-slate-800 rounded-md disabled:opacity-30"
                    aria-label="Next page"
                  >
                    <ChevronRightIcon className="w-5 h-5" />
                  </button>
                </div>
                {/* Free Cloudinary plans block direct PDF delivery (401) until it's
                    enabled in Security settings — the page images work either way. */}
                {(view.doc.format !== 'pdf' || process.env.NEXT_PUBLIC_ALLOW_PDF_DOWNLOAD === 'true') && (
                  <a
                    href={view.doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs text-slate-500 underline underline-offset-2"
                  >
                    Open the original file
                  </a>
                )}
              </div>
            ) : state.documents.length === 0 ? (
              <Empty text="No documents shared yet." />
            ) : (
              <div className="space-y-2">
                {state.documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => openDocument(doc)}
                    className={`${cardClass} w-full text-left flex items-center gap-3 hover:border-slate-600 transition`}
                  >
                    <DocumentTextIcon className="w-6 h-6 text-slate-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{doc.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                      </div>
                    </div>
                    {presenting?.id === doc.id && (
                      <span className="text-[11px] uppercase tracking-[0.08em] text-emerald-400 shrink-0 font-medium">Live</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'questions' && <QuestionsTab state={state} me={me} code={code!} refresh={refresh} />}
      </main>

      <nav className="fixed bottom-4 left-4 right-4 max-w-2xl mx-auto h-16 bg-raised/90 backdrop-blur-xl border border-slate-800 rounded-xl flex">
        <TabButton active={tab === 'live'} onClick={() => setTab('live')} label="Live" Icon={SignalIcon} dot={!!state.poll && state.poll.status === 'live' && !me.myResponse} />
        <TabButton active={tab === 'documents'} onClick={() => setTab('documents')} label="Documents" Icon={DocumentTextIcon} dot={!!presenting} />
        <TabButton active={tab === 'questions'} onClick={() => setTab('questions')} label="Q&A" Icon={ChatBubbleLeftRightIcon} />
      </nav>
    </Shell>
  );
}

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="min-h-screen bg-ink text-slate-100">
      <Head>
        <title>{title ? `${title} · Tixflow` : 'Event Space · Tixflow'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      {children}
    </div>
  );
}

function Header({ state, offline }: { state: PublicSpaceState; offline?: boolean }) {
  return (
    <header className="max-w-2xl mx-auto px-4 pt-6 pb-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500 truncate font-medium">{state.event.organiser}</span>
        {state.isOpen && (
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500 shrink-0 font-medium">
            {state.activeCount} here now
          </span>
        )}
      </div>
      <h1 className="text-xl font-bold mt-1">{state.title}</h1>
      {state.title !== state.event.title && <p className="text-xs text-slate-400 mt-0.5">{state.event.title}</p>}
      {state.otherRooms.length > 0 && (
        // Full page loads, not client-side navigation: each room's polling
        // state (version, cookie join) starts fresh.
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500 self-center shrink-0 font-medium">Other rooms</span>
          {state.otherRooms.map((room) => (
            <a
              key={room.joinCode}
              href={`/space/${room.joinCode}`}
              className="px-3 py-1 rounded-full border border-slate-700 text-xs text-slate-300 hover:text-white whitespace-nowrap"
            >
              {room.title}
            </a>
          ))}
        </div>
      )}
      {offline && (
        <p className="mt-2 text-[11px] text-amber-400">Connection lost — reconnecting. You&apos;re seeing the last update.</p>
      )}
    </header>
  );
}

function TabButton({
  active,
  onClick,
  label,
  Icon,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: typeof SignalIcon;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-1 relative transition ${active ? 'text-white' : 'text-slate-500'}`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[11px] uppercase tracking-[0.06em] font-medium">{label}</span>
      {dot && <span className="absolute top-2.5 right-[calc(50%-16px)] w-2 h-2 rounded-full bg-emerald-400" />}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">
      {text}
    </div>
  );
}

interface TabProps {
  state: PublicSpaceState;
  me: ParticipantState;
  code: string;
  refresh: (force?: boolean) => Promise<void>;
}

function LiveTab({
  state,
  me,
  code,
  refresh,
  presenting,
  onFollow,
}: TabProps & { presenting: SpaceDocument | undefined; onFollow: () => void }) {
  const poll = state.poll;
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!poll) return;
    setSubmitting(true);
    setError('');
    try {
      await post(`/api/space/${code}/respond`, poll.kind === 'choice' ? { pollId: poll.id, optionIndex: choice } : { pollId: poll.id, text });
      await refresh(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const latest = state.announcements[0];
  const answered = !!me.myResponse;
  const canAnswer = poll?.status === 'live' && !answered;

  return (
    <>
      {latest && (
        <div className="p-4 rounded-xl border border-amber-700/40 bg-amber-950/20 flex gap-3">
          <MegaphoneIcon className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm text-amber-100 whitespace-pre-wrap break-words">{latest.text}</p>
            <p className="text-[11px] uppercase tracking-[0.06em] text-amber-400/70 mt-1 font-medium">{timeAgo(latest.createdAt)}</p>
          </div>
        </div>
      )}

      {presenting && state.live && (
        <button
          type="button"
          onClick={onFollow}
          className="w-full p-4 rounded-xl border border-emerald-700/40 bg-emerald-950/20 flex items-center gap-3 text-left"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-sm text-emerald-100 flex-1 min-w-0">
            Now presenting: <span className="font-semibold">{presenting.title}</span> · page {state.live.page}
          </span>
          <ChevronRightIcon className="w-4 h-4 text-emerald-300 shrink-0" />
        </button>
      )}

      {poll ? (
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">
              {poll.status === 'live' ? 'Live poll' : 'Poll closed'}
            </span>
            <span className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">{poll.responseCount} answered</span>
          </div>
          <h2 className="text-lg font-semibold mb-4 break-words">{poll.question}</h2>

          {canAnswer ? (
            <form onSubmit={submit} className="space-y-3">
              {poll.kind === 'choice' ? (
                <div className="space-y-2">
                  {poll.options.map((option, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setChoice(i)}
                      className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition ${
                        choice === i ? 'border-sky-400 bg-sky-950/40 text-white' : 'border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={80}
                  placeholder="Type your answer"
                  className={inputClass}
                />
              )}
              {error && <p className="text-xs text-rose-400">{error}</p>}
              <button
                type="submit"
                disabled={submitting || (poll.kind === 'choice' ? choice === null : !text.trim())}
                className="w-full py-2.5 rounded-md text-sm font-medium bg-white text-black hover:bg-slate-200 transition disabled:opacity-40"
              >
                {submitting ? 'Sending...' : 'Submit'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {answered && (
                <p className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircleIcon className="w-4 h-4" />
                  {poll.kind === 'text' && me.myResponse?.text ? <>You answered &ldquo;{me.myResponse.text}&rdquo;</> : 'Answer received'}
                </p>
              )}
              {poll.showResults && poll.results ? (
                <PollResults options={poll.options} results={poll.results} myOptionIndex={me.myResponse?.optionIndex} />
              ) : (
                <p className="text-sm text-slate-400">Results will be shown on the main screen.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        !latest && !presenting && <Empty text="Nothing live yet — polls will appear here" />
      )}

      {state.welcomeMessage && (
        <div className={cardClass}>
          <p className="text-sm text-slate-300 whitespace-pre-wrap break-words">{state.welcomeMessage}</p>
        </div>
      )}

      {state.announcements.length > 1 && (
        <div className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">Earlier announcements</h3>
          {state.announcements.slice(1).map((a) => (
            <div key={a.createdAt} className="p-3 rounded-lg border border-slate-800/80 text-sm text-slate-300">
              <p className="whitespace-pre-wrap break-words">{a.text}</p>
              <p className="text-[11px] uppercase tracking-[0.06em] text-slate-600 mt-1 font-medium">{timeAgo(a.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function QuestionsTab({ state, me, code, refresh }: TabProps) {
  const [text, setText] = useState('');
  // Only ever rendered client-side (the page waits for router.query), so
  // reading localStorage during the first render is safe.
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sort, setSort] = useState<'top' | 'new'>('top');

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const result = await post(`/api/space/${code}/questions`, { text, authorName: name });
      try {
        localStorage.setItem(NAME_STORAGE_KEY, name);
      } catch {}
      setText('');
      setMessage(result.data.status === 'pending' ? 'Sent — it will appear once the organiser approves it.' : 'Question posted.');
      await refresh(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const vote = async (questionId: string) => {
    try {
      await post(`/api/space/${code}/vote`, { questionId });
      await refresh(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const voted = new Set(me.votedQuestionIds);
  const questions = [...state.questions].sort((a, b) =>
    sort === 'new' ? b.createdAt.localeCompare(a.createdAt) : b.upvotes - a.upvotes
  );

  return (
    <>
      <form onSubmit={ask} className={`${cardClass} space-y-3`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder="Ask the speakers a question"
          className={`${inputClass} resize-none`}
        />
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Your name (optional)"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={submitting || text.trim().length < 3}
            className="px-5 rounded-md text-sm font-medium bg-white text-black hover:bg-slate-200 transition disabled:opacity-40 shrink-0"
          >
            {submitting ? '...' : 'Ask'}
          </button>
        </div>
        {message && <p className="text-xs text-emerald-400">{message}</p>}
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </form>

      {me.myPendingQuestions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">Waiting for approval</h3>
          {me.myPendingQuestions.map((q) => (
            <div key={q.id} className="p-3 rounded-lg border border-dashed border-slate-700 text-sm text-slate-400 break-words">
              {q.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium">{state.questions.length} questions</h3>
        <div className="flex gap-1 text-[11px] uppercase tracking-[0.06em] font-medium">
          {(['top', 'new'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`px-2 py-1 rounded ${sort === s ? 'bg-slate-800 text-white' : 'text-slate-500'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {questions.length === 0 ? (
        <Empty text="No questions yet — be the first" />
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <div
              key={q.id}
              className={`p-4 rounded-xl border flex gap-3 ${
                state.spotlightQuestion?.id === q.id ? 'border-sky-500/60 bg-sky-950/20' : 'border-slate-800/80 bg-panel'
              }`}
            >
              <button
                type="button"
                onClick={() => vote(q.id)}
                className={`flex flex-col items-center justify-center w-12 shrink-0 rounded-lg border py-1.5 transition ${
                  voted.has(q.id) ? 'border-sky-400 text-sky-300 bg-sky-950/40' : 'border-slate-800 text-slate-400'
                }`}
                aria-label={voted.has(q.id) ? 'Remove upvote' : 'Upvote'}
              >
                <ArrowUpIcon className="w-4 h-4" />
                <span className="text-xs font-mono">{q.upvotes}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-100 break-words">{q.text}</p>
                <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 mt-1.5 font-medium">
                  {q.authorName || 'Anonymous'}
                  {q.status === 'answered' && <span className="text-emerald-400 ml-2">Answered</span>}
                  {state.spotlightQuestion?.id === q.id && <span className="text-sky-400 ml-2">On screen now</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
