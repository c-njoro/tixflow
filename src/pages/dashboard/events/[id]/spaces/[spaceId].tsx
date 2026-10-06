// pages/dashboard/events/[id]/spaces/[spaceId].tsx
//
// Organiser control room for one room's live Event Space: QR code, polls,
// Q&A moderation, document presenting, announcements and the projector.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import JoinQr from '@/components/space/JoinQr';
import PollResults from '@/components/space/PollResults';
import DocumentPage from '@/components/space/DocumentPage';
import type { PollResults as Results, ScreenMode, SpaceDocument } from '@/components/space/types';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

interface AdminPoll {
  id: string;
  question: string;
  kind: 'choice' | 'text';
  options: string[];
  status: 'draft' | 'live' | 'closed';
  showResults: boolean;
  hiddenAnswers: string[];
  responseCount: number;
  results: Results | null;
}

interface AdminQuestion {
  id: string;
  text: string;
  authorName: string | null;
  status: 'pending' | 'visible' | 'answered' | 'hidden';
  upvotes: number;
  createdAt: string;
}

interface AdminSpace {
  id: string;
  joinCode: string;
  joinUrl: string;
  title: string;
  welcomeMessage: string | null;
  isOpen: boolean;
  moderateQuestions: boolean;
  livePollId: string | null;
  liveDocumentId: string | null;
  liveDocumentPage: number;
  spotlightQuestionId: string | null;
  screenMode: ScreenMode;
  announcements: { text: string; createdAt: string }[];
  inviteStatus: 'pending' | 'sending' | 'sent';
  invitesSentAt: string | null;
  inviteCount: number;
  inviteDueAt: string;
  ticketHolders: number;
  participantCount: number;
  activeCount: number;
  polls: AdminPoll[];
  questions: AdminQuestion[];
  documents: SpaceDocument[];
}

type Tab = 'polls' | 'questions' | 'documents' | 'announcements' | 'settings';

const REFRESH_MS = 4000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;


const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-800 text-slate-300 border-slate-700',
  live: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  closed: 'bg-slate-800/60 text-slate-400 border-slate-700',
  pending: 'bg-amber-950/40 text-amber-400 border-amber-800/50',
  visible: 'bg-sky-950/40 text-sky-400 border-sky-800/50',
  answered: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
  hidden: 'bg-rose-950/40 text-rose-400 border-rose-800/50',
};

const SCREEN_MODES: { value: ScreenMode; label: string }[] = [
  { value: 'join', label: 'Join QR' },
  { value: 'poll', label: 'Live poll' },
  { value: 'questions', label: 'Q&A' },
  { value: 'document', label: 'Document' },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function Badge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded border shrink-0 ${STATUS_STYLES[status]} font-medium`}>
      {status}
    </span>
  );
}

export default function EventSpacePage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const spaceId = typeof router.query.spaceId === 'string' ? router.query.spaceId : undefined;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [eventTitle, setEventTitle] = useState('');
  const [space, setSpace] = useState<AdminSpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('polls');

  const base = id && spaceId ? `/api/events/${id}/spaces/${spaceId}` : '';

  const load = useCallback(async () => {
    if (!base) return;
    try {
      const res = await fetch(base);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to load the Event Space.');
      setSpace(result.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    // Also refreshes while the page is open, so responses, new questions
    // and the people count keep ticking over.
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let first = true;
    const loop = async () => {
      if (first || !document.hidden) await load();
      first = false;
      if (!stopped) timer = setTimeout(loop, REFRESH_MS);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [load]);

  // Every mutation returns the full refreshed admin state.
  const call = useCallback(
    async (path: string, method: string, body?: unknown): Promise<boolean> => {
      setBusy(true);
      setError('');
      try {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Something went wrong.');
        if (result.data !== undefined) setSpace(result.data);
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [base]
  );

  const patch = (body: Record<string, unknown>) => call('', 'PATCH', body);
  const pendingCount = space?.questions.filter((q) => q.status === 'pending').length ?? 0;

  if (loading) {
    return <div className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">Loading Event Space...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display tracking-tight text-2xl font-semibold text-white">{space?.title || 'Event Space'}</h1>
          <p className="text-sm text-slate-400 mt-1">{eventTitle || 'Loading event...'}</p>
        </div>
        {id && (
          <Link href={`/dashboard/events/${id}/spaces`} className={buttonClass}>
            All rooms
          </Link>
        )}
      </div>

      {error && (
        <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>
      )}

      {!space ? (
        <div className={cardClass}>
          <p className="text-sm text-slate-400">This room doesn&apos;t exist any more.</p>
        </div>
      ) : (
        <>
          <Overview space={space} isAdmin={isAdmin} busy={busy} patch={patch} sendInvites={() => call('/invites', 'POST')} reload={load} />

          {isAdmin && (
            <>
              <div className={`${cardClass} space-y-3`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Projector shows</h3>
                  <a
                    href={`/space/${space.joinCode}/screen`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-sky-400 hover:text-sky-300 font-medium"
                  >
                    Open projector screen ↗
                  </a>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {SCREEN_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      disabled={busy}
                      onClick={() => patch({ screenMode: m.value })}
                      className={`py-2.5 text-[13px] rounded-md border transition ${
                        space.screenMode === m.value
                          ? 'bg-white text-black border-white'
                          : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      } font-medium`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-1 border-b border-slate-800 overflow-x-auto overflow-y-hidden">
                {(
                  [
                    ['polls', `Polls (${space.polls.length})`],
                    ['questions', pendingCount > 0 ? `Q&A (${pendingCount} pending)` : `Q&A (${space.questions.length})`],
                    ['documents', `Documents (${space.documents.length})`],
                    ['announcements', 'Announcements'],
                    ['settings', 'Settings'],
                  ] as [Tab, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`px-4 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px transition ${
                      tab === value ? 'border-white text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
                    } font-medium`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'polls' && <PollsTab space={space} busy={busy} call={call} patch={patch} />}
              {tab === 'questions' && <QuestionsTab space={space} busy={busy} call={call} patch={patch} />}
              {tab === 'documents' && <DocumentsTab space={space} busy={busy} call={call} patch={patch} />}
              {tab === 'announcements' && <AnnouncementsTab space={space} busy={busy} patch={patch} />}
              {tab === 'settings' && (
                <SettingsTab
                  space={space}
                  busy={busy}
                  patch={patch}
                  onDelete={async () => {
                    if (await call('', 'DELETE')) router.push(`/dashboard/events/${id}/spaces`);
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Overview({
  space,
  isAdmin,
  busy,
  patch,
  sendInvites,
  reload,
}: {
  space: AdminSpace;
  isAdmin: boolean;
  busy: boolean;
  patch: (body: Record<string, unknown>) => Promise<boolean>;
  sendInvites: () => Promise<boolean>;
  reload: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const attendeeUrl = typeof window !== 'undefined' ? `${window.location.origin}/space/${space.joinCode}` : space.joinUrl;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(attendeeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={`${cardClass} flex flex-col sm:flex-row lg:col-span-2 gap-5`}>
        <div className="shrink-0 flex flex-col items-center gap-2">
          <JoinQr joinCode={space.joinCode} size={168} className="p-2" downloadName={`event-space-${space.joinCode}.png`} />
          <span className="text-[11px] uppercase tracking-[0.06em] text-slate-500 font-medium">Click to download</span>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white truncate">{space.title}</h2>
            <Badge status={space.isOpen ? 'live' : 'closed'} />
          </div>
          <div>
            <p className={labelClass}>Join code</p>
            <p className="text-2xl tabular-nums font-bold tracking-[0.3em] text-white mt-1">{space.joinCode}</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="text-xs text-slate-400 truncate">{attendeeUrl}</code>
            <button type="button" onClick={copy} className={buttonClass}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={`/space/${space.joinCode}`} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              Preview as attendee ↗
            </a>
            {isAdmin && (
              <button type="button" disabled={busy} onClick={() => patch({ isOpen: !space.isOpen })} className={buttonClass}>
                {space.isOpen ? 'Close space' : 'Open space'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`${cardClass} space-y-4`}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelClass}>Here now</p>
            <p className="text-2xl font-bold text-white mt-1">{space.activeCount}</p>
          </div>
          <div>
            <p className={labelClass}>Joined</p>
            <p className="text-2xl font-bold text-white mt-1">{space.participantCount}</p>
          </div>
        </div>
        <div className="border-t border-slate-800 pt-4">
          <p className={labelClass}>Ticket holder invites</p>
          {space.inviteStatus === 'sent' ? (
            <p className="text-sm text-slate-300 mt-1">
              Sent to {space.inviteCount} {space.inviteCount === 1 ? 'person' : 'people'}
              {space.invitesSentAt && <> on {formatDate(space.invitesSentAt)}</>}. Later buyers get the link with their ticket.
            </p>
          ) : space.inviteStatus === 'sending' ? (
            <div className="mt-1 space-y-2">
              <p className="text-sm text-amber-300">Sending now — this takes a few seconds per person.</p>
              <button type="button" onClick={reload} className={buttonClass}>
                Refresh
              </button>
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              <p className="text-sm text-slate-300">
                Goes out automatically on {formatDate(space.inviteDueAt)} to holders of {space.ticketHolders}{' '}
                {space.ticketHolders === 1 ? 'ticket' : 'tickets'}.
              </p>
              {isAdmin && (
                <button
                  type="button"
                  disabled={busy || space.ticketHolders === 0}
                  onClick={() => {
                    if (confirm('Send the Event Space link to all ticket holders now? This only happens once.')) sendInvites();
                  }}
                  className={buttonClass}
                >
                  Send now instead
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  space: AdminSpace;
  busy: boolean;
  call: (path: string, method: string, body?: unknown) => Promise<boolean>;
  patch: (body: Record<string, unknown>) => Promise<boolean>;
}

function PollsTab({ space, busy, call, patch }: TabProps) {
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'choice' | 'text'>('choice');
  const [options, setOptions] = useState(['', '']);
  const [showResults, setShowResults] = useState(true);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await call('/polls', 'POST', {
      question,
      kind,
      options: options.filter((o) => o.trim()),
      showResults,
    });
    if (ok) {
      setQuestion('');
      setOptions(['', '']);
    }
  };

  const pollAction = (pollId: string, body: Record<string, unknown>) => call(`/polls/${pollId}`, 'PATCH', body);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <form onSubmit={create} className={`${cardClass} space-y-4 lg:col-span-2`}>
        <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">New poll</h3>
        <div>
          <label className={labelClass}>Question</label>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} className={`${inputClass} mt-1`} placeholder="What topic should we cover next?" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['choice', 'Multiple choice'],
              ['text', 'Open answer (word cloud)'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`py-2 px-2 text-xs rounded-md border transition ${
                kind === value ? 'bg-white text-black border-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              } font-medium`}
            >
              {label}
            </button>
          ))}
        </div>
        {kind === 'choice' ? (
          <div className="space-y-2">
            <label className={labelClass}>Options</label>
            {options.map((option, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={option}
                  onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
                  maxLength={100}
                  placeholder={`Option ${i + 1}`}
                  className={inputClass}
                />
                {options.length > 2 && (
                  <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-400 px-2">
                    ✕
                  </button>
                )}
              </div>
            ))}
            {options.length < 8 && (
              <button type="button" onClick={() => setOptions([...options, ''])} className={buttonClass}>
                + Add option
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Attendees type a short answer. Matching answers are grouped and ranked — the most common ones show biggest.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} />
          Show results on attendees&apos; phones after they answer
        </label>
        <button type="submit" disabled={busy || !question.trim()} className={primaryButtonClass}>
          Save as draft
        </button>
      </form>

      <div className="space-y-3 lg:col-span-3">
        {space.polls.length === 0 ? (
          <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">
            No polls yet — prepare them before the session
          </div>
        ) : (
          space.polls.map((poll) => {
            const isCurrent = space.livePollId === poll.id;
            return (
              <div key={poll.id} className={`${cardClass} space-y-4 ${isCurrent ? 'border-emerald-800/60' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white break-words">{poll.question}</p>
                    <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 mt-1 font-medium">
                      {poll.kind === 'choice' ? 'Multiple choice' : 'Word cloud'} · {poll.responseCount} responses
                      {isCurrent && <span className="text-emerald-400"> · on attendees&apos; phones</span>}
                    </p>
                  </div>
                  <Badge status={poll.status} />
                </div>

                <div className="flex flex-wrap gap-2">
                  {poll.status !== 'live' && (
                    <button type="button" disabled={busy} onClick={() => pollAction(poll.id, { action: 'go_live' })} className={primaryButtonClass}>
                      {poll.status === 'draft' ? 'Go live' : 'Reopen'}
                    </button>
                  )}
                  {poll.status === 'live' && (
                    <button type="button" disabled={busy} onClick={() => pollAction(poll.id, { action: 'close' })} className={buttonClass}>
                      Stop answers
                    </button>
                  )}
                  {isCurrent && (
                    <>
                      <button
                        type="button"
                        disabled={busy || space.screenMode === 'poll'}
                        onClick={() => patch({ screenMode: 'poll' })}
                        className={buttonClass}
                      >
                        {space.screenMode === 'poll' ? 'On projector' : 'Show on projector'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => pollAction(poll.id, { action: 'take_down' })} className={buttonClass}>
                        Remove from phones
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pollAction(poll.id, { showResults: !poll.showResults })}
                    className={buttonClass}
                  >
                    {poll.showResults ? 'Hide results on phones' : 'Show results on phones'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm('Delete this poll and all its responses?')) call(`/polls/${poll.id}`, 'DELETE');
                    }}
                    className="px-3 py-1.5 text-[13px] text-rose-400 hover:text-rose-300 disabled:opacity-40 font-medium"
                  >
                    Delete
                  </button>
                </div>

                {poll.kind === 'choice' && poll.status === 'draft' && (
                  <ul className="text-sm text-slate-400 list-disc pl-5">
                    {poll.options.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                )}

                {poll.results && (
                  <PollResults
                    options={poll.options}
                    results={
                      poll.results.kind === 'text'
                        ? {
                            ...poll.results,
                            answers: poll.results.answers.filter((a) => !poll.hiddenAnswers.includes(a.text)),
                          }
                        : poll.results
                    }
                    onHideAnswer={poll.kind === 'text' ? (text) => pollAction(poll.id, { hideAnswer: text }) : undefined}
                  />
                )}

                {poll.hiddenAnswers.length > 0 && (
                  <div className="text-xs text-slate-500">
                    Hidden:{' '}
                    {poll.hiddenAnswers.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => pollAction(poll.id, { unhideAnswer: a })}
                        className="inline-block mr-2 px-2 py-0.5 rounded border border-slate-800 hover:text-white"
                        title="Show again"
                      >
                        {a} ↺
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function QuestionsTab({ space, busy, call, patch }: TabProps) {
  const [filter, setFilter] = useState<'all' | AdminQuestion['status']>('all');
  const counts = space.questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.status] = (acc[q.status] || 0) + 1;
    return acc;
  }, {});
  const shown = space.questions.filter((q) => filter === 'all' || q.status === filter);
  const setStatus = (questionId: string, status: AdminQuestion['status']) =>
    call(`/questions/${questionId}`, 'PATCH', { status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(['all', 'pending', 'visible', 'answered', 'hidden'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-md transition ${
                filter === f ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
              } font-medium`}
            >
              {f} ({f === 'all' ? space.questions.length : counts[f] || 0})
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={space.moderateQuestions}
            disabled={busy}
            onChange={(e) => patch({ moderateQuestions: e.target.checked })}
          />
          Approve questions before they&apos;re shown
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">
          No questions here
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((q) => {
            const spotlit = space.spotlightQuestionId === q.id;
            return (
              <div key={q.id} className={`${cardClass} flex flex-col md:flex-row md:items-center gap-3 ${spotlit ? 'border-sky-700/60' : ''}`}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-10 text-center text-lg tabular-nums text-sky-300 shrink-0">▲{q.upvotes}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-white break-words">{q.text}</p>
                    <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 mt-1 font-medium">
                      {q.authorName || 'Anonymous'} · {formatDate(q.createdAt)}
                      {spotlit && <span className="text-sky-400"> · on projector</span>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Badge status={q.status} />
                  {q.status === 'pending' && (
                    <button type="button" disabled={busy} onClick={() => setStatus(q.id, 'visible')} className={primaryButtonClass}>
                      Approve
                    </button>
                  )}
                  {(q.status === 'visible' || q.status === 'answered') && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        patch(spotlit ? { spotlightQuestionId: null } : { spotlightQuestionId: q.id, screenMode: 'questions' })
                      }
                      className={buttonClass}
                    >
                      {spotlit ? 'Off projector' : 'Put on projector'}
                    </button>
                  )}
                  {q.status === 'visible' && (
                    <button type="button" disabled={busy} onClick={() => setStatus(q.id, 'answered')} className={buttonClass}>
                      Answered
                    </button>
                  )}
                  {q.status === 'hidden' || q.status === 'answered' ? (
                    <button type="button" disabled={busy} onClick={() => setStatus(q.id, 'visible')} className={buttonClass}>
                      Restore
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setStatus(q.id, 'hidden')} className={buttonClass}>
                      Hide
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirm('Delete this question?')) call(`/questions/${q.id}`, 'DELETE');
                    }}
                    className="px-2 text-[13px] text-rose-400 hover:text-rose-300 disabled:opacity-40 font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DocumentsTab({ space, busy, call, patch }: TabProps) {
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const presenting = space.documents.find((d) => d.id === space.liveDocumentId);
  const page = presenting ? Math.min(space.liveDocumentPage, presenting.pageCount) : 1;

  const goTo = useCallback(
    (target: number) => {
      if (!presenting) return;
      const clamped = Math.min(Math.max(target, 1), presenting.pageCount);
      if (clamped !== page) patch({ liveDocumentPage: clamped });
    },
    [presenting, page, patch]
  );

  // Arrow keys / clicker remotes (which send PageUp/PageDown) flip pages.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(page + 1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, page, goTo]);

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    setFileError('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError('Files must be 10 MB or smaller.');
      return;
    }
    setUploading(true);
    const ok = await call('/documents', 'POST', { title: title || file.name.replace(/\.[^.]+$/, ''), file: await fileToDataUrl(file) });
    setUploading(false);
    if (ok) {
      setTitle('');
      setFile(null);
      setInputKey((k) => k + 1);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
      <div className="space-y-4 lg:col-span-2">
        <form onSubmit={upload} className={`${cardClass} space-y-4`}>
          <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Share a document</h3>
          <div>
            <label className={labelClass}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Programme" className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>File (PDF or image, up to 10 MB)</label>
            <input
              key={inputKey}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-[13px] file: file: file:bg-slate-800 file:text-slate-200 font-medium"
            />
          </div>
          {fileError && <p className="text-xs text-rose-400">{fileError}</p>}
          <button type="submit" disabled={busy || uploading || !file} className={primaryButtonClass}>
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </form>

        {space.documents.length === 0 ? (
          <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">
            No documents yet
          </div>
        ) : (
          <div className="space-y-2">
            {space.documents.map((doc) => (
              <div key={doc.id} className={`${cardClass} flex items-center gap-3 ${presenting?.id === doc.id ? 'border-emerald-800/60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{doc.title}</p>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 mt-0.5 font-medium">
                    {doc.format} · {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                  </p>
                </div>
                {presenting?.id === doc.id ? (
                  <button type="button" disabled={busy} onClick={() => patch({ liveDocumentId: null })} className={buttonClass}>
                    Stop
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => patch({ liveDocumentId: doc.id })} className={buttonClass}>
                    Present
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete "${doc.title}"?`)) call(`/documents/${doc.id}`, 'DELETE');
                  }}
                  className="text-[13px] text-rose-400 hover:text-rose-300 disabled:opacity-40 font-medium"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${cardClass} lg:col-span-3 space-y-4`}>
        {presenting ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-emerald-400 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Presenting
                </p>
                <p className="text-sm font-semibold text-white mt-1">{presenting.title}</p>
              </div>
              <button
                type="button"
                disabled={busy || space.screenMode === 'document'}
                onClick={() => patch({ screenMode: 'document' })}
                className={buttonClass}
              >
                {space.screenMode === 'document' ? 'On projector' : 'Show on projector'}
              </button>
            </div>
            <DocumentPage doc={presenting} page={page} />
            <div className="flex items-center justify-between gap-3">
              <button type="button" disabled={busy || page <= 1} onClick={() => goTo(page - 1)} className={primaryButtonClass}>
                ← Prev
              </button>
              <span className="text-xs tabular-nums text-slate-400">
                Page {page} / {presenting.pageCount}
              </span>
              <button type="button" disabled={busy || page >= presenting.pageCount} onClick={() => goTo(page + 1)} className={primaryButtonClass}>
                Next →
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Everyone following along moves to the page you&apos;re on. Arrow keys and presentation clickers work here too.
            </p>
          </>
        ) : (
          <div className="py-16 text-center">
            <p className="text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">Not presenting</p>
            <p className="text-sm text-slate-400 mt-2">
              Press &ldquo;Present&rdquo; on a document and attendees&apos; phones will follow the page you&apos;re on.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AnnouncementsTab({ space, busy, patch }: Omit<TabProps, 'call'>) {
  const [text, setText] = useState('');

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (await patch({ announcement: text })) setText('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <form onSubmit={send} className={`${cardClass} space-y-3`}>
        <h3 className="text-xs uppercase tracking-[0.08em] text-slate-400 font-medium">Post an announcement</h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Lunch is served in the foyer. Sessions resume at 2:00 PM."
          className={`${inputClass} resize-none`}
        />
        <button type="submit" disabled={busy || !text.trim()} className={primaryButtonClass}>
          Post
        </button>
      </form>
      <div className="space-y-2">
        {space.announcements.length === 0 ? (
          <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">
            No announcements yet
          </div>
        ) : (
          <>
            {space.announcements.map((a) => (
              <div key={a.createdAt} className={cardClass}>
                <p className="text-sm text-white whitespace-pre-wrap break-words">{a.text}</p>
                <p className="text-[11px] uppercase tracking-[0.06em] text-slate-500 mt-1 font-medium">{formatDate(a.createdAt)}</p>
              </div>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm('Clear all announcements?')) patch({ clearAnnouncements: true });
              }}
              className={buttonClass}
            >
              Clear all
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsTab({
  space,
  busy,
  patch,
  onDelete,
}: Omit<TabProps, 'call'> & { onDelete: () => void }) {
  const [title, setTitle] = useState(space.title);
  const [welcomeMessage, setWelcomeMessage] = useState(space.welcomeMessage || '');

  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`${cardClass} space-y-4`}>
        <div>
          <label className={labelClass}>Space name</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass}>Welcome message</label>
          <textarea
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={4}
            maxLength={1000}
            className={`${inputClass} mt-1 resize-none`}
          />
        </div>
        <button type="button" disabled={busy || !title.trim()} onClick={() => patch({ title, welcomeMessage })} className={primaryButtonClass}>
          Save
        </button>
      </div>
      <div className="p-5 border border-rose-900/50 rounded-xl space-y-3">
        <h3 className="text-xs uppercase tracking-[0.08em] text-rose-400 font-medium">Delete this room</h3>
        <p className="text-sm text-slate-400">
          Removes every poll, response, question and document. The join link stops working. This can&apos;t be undone.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm("Delete this room and everything in it?")) onDelete();
          }}
          className="px-4 py-2 text-[13px] border border-rose-800 text-rose-400 rounded-md hover:bg-rose-950/40 transition disabled:opacity-40 font-medium"
        >
          Delete room
        </button>
      </div>
    </div>
  );
}
