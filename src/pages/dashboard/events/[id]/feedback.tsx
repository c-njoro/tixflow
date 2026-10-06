// pages/dashboard/events/[id]/feedback.tsx
//
// Post-event feedback: build the survey, schedule it to go out after the
// event (or send it now), and read the results.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { buttonClass, cardClass, inputClass, labelClass, primaryButtonClass } from '@/lib/ui';

interface Question {
  id: string;
  kind: 'rating' | 'choice' | 'text';
  prompt: string;
  options: string[];
  required: boolean;
}

type Result =
  | { id: string; kind: 'rating'; prompt: string; count: number; average: number | null; distribution: number[] }
  | { id: string; kind: 'choice'; prompt: string; count: number; options: string[]; counts: number[] }
  | { id: string; kind: 'text'; prompt: string; count: number; answers: { text: string; at: string }[] };

interface Survey {
  id: string;
  intro: string | null;
  questions: Question[];
  status: 'draft' | 'scheduled' | 'sent' | 'closed';
  audience: 'attended' | 'all';
  sendAfterHours: number;
  sentAt: string | null;
  sentCount: number;
  sendsAt: string;
  results: { responseCount: number; questions: Result[] };
}

// Validated on the dashboard surface (see gate.tsx).
const BAR_COLOR = '#0284c7';
const TRACK_COLOR = '#0c2a40';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });

const STATUS_TEXT: Record<Survey['status'], string> = {
  draft: 'Draft — not scheduled',
  scheduled: 'Scheduled',
  sent: 'Sent — collecting responses',
  closed: 'Closed',
};

export default function FeedbackDashboard() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : undefined;
  const [survey, setSurvey] = useState<Survey | null | undefined>(undefined);
  const [eventTitle, setEventTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [intro, setIntro] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'results' | 'questions'>('results');

  const apply = (s: Survey | null) => {
    setSurvey(s);
    if (s) {
      setQuestions(s.questions);
      setIntro(s.intro || '');
    }
  };

  const request = useCallback(
    async (method: string, body?: unknown, path = '') => {
      const res = await fetch(`/api/events/${id}/feedback${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong.');
      return result.data;
    },
    [id]
  );

  useEffect(() => {
    if (!id) return;
    request('GET')
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'));
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((result) => result.data && setEventTitle(result.data.title))
      .catch(() => {});
  }, [id, request]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>) => run(async () => apply(await request('PATCH', body)));

  const updateQuestion = (index: number, changes: Partial<Question>) =>
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...changes } : q)));

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="font-display tracking-tight text-2xl font-semibold text-white">Feedback</h1>
        <p className="text-sm text-slate-400 mt-1">{eventTitle || 'Loading event...'}</p>
      </div>
      {id && (
        <Link href={`/dashboard/events/${id}`} className={buttonClass}>
          Back to Event
        </Link>
      )}
    </div>
  );

  if (survey === undefined) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-xs text-slate-500 uppercase tracking-[0.08em] font-medium">{error || 'Loading...'}</p>
      </div>
    );
  }

  if (survey === null) {
    return (
      <div className="space-y-6">
        {header}
        <div className={`${cardClass} space-y-3 max-w-2xl`}>
          <h2 className="text-sm font-semibold text-white">Ask attendees how it went</h2>
          <p className="text-sm text-slate-400">
            A short survey goes out by email and WhatsApp a couple of hours after the event ends — to people who were
            scanned in. Each person gets their own link and can answer once; answers are anonymous. If certificates are on,
            they go in the same message.
          </p>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button type="button" disabled={busy} onClick={() => run(async () => apply(await request('POST')))} className={primaryButtonClass}>
            Create survey
          </button>
        </div>
      </div>
    );
  }

  const editable = survey.status === 'draft' || survey.status === 'scheduled';

  return (
    <div className="space-y-6">
      {header}
      {error && <div className="p-3 text-xs font-medium border rounded-md bg-rose-950/30 text-rose-400 border-rose-800/50">{error}</div>}
      {notice && <div className="p-3 text-xs font-medium border rounded-md bg-emerald-950/30 text-emerald-400 border-emerald-800/50">{notice}</div>}

      <div className={`${cardClass} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <p className="text-sm font-semibold text-white">{STATUS_TEXT[survey.status]}</p>
          <p className="text-xs text-slate-400 mt-1">
            {survey.status === 'scheduled' && <>Goes out {when(survey.sendsAt)} to {survey.audience === 'attended' ? 'people who were scanned in' : 'all ticket holders'}.</>}
            {survey.status === 'draft' && <>Schedule it to send automatically {survey.sendAfterHours}h after the event ends.</>}
            {(survey.status === 'sent' || survey.status === 'closed') && survey.sentAt && (
              <>Sent {when(survey.sentAt)} to {survey.sentCount} people · {survey.results.responseCount} responses</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {survey.status === 'draft' && (
            <button type="button" disabled={busy} onClick={() => patch({ status: 'scheduled' })} className={primaryButtonClass}>
              Schedule
            </button>
          )}
          {survey.status === 'scheduled' && (
            <button type="button" disabled={busy} onClick={() => patch({ status: 'draft' })} className={buttonClass}>
              Unschedule
            </button>
          )}
          {editable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm('Send the survey to attendees now? It can only be sent once.')) {
                  run(async () => {
                    await request('POST', undefined, '/send');
                    setNotice('Sending now — this takes a few seconds per person.');
                    setTimeout(() => request('GET').then(apply).catch(() => {}), 4000);
                  });
                }
              }}
              className={buttonClass}
            >
              Send now
            </button>
          )}
          {survey.status === 'sent' && (
            <button type="button" disabled={busy} onClick={() => patch({ status: 'closed' })} className={buttonClass}>
              Close survey
            </button>
          )}
          {survey.status === 'closed' && (
            <button type="button" disabled={busy} onClick={() => patch({ status: 'sent' })} className={buttonClass}>
              Reopen
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto overflow-y-hidden">
        {(['results', 'questions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[13px] border-b-2 -mb-px ${
              tab === t ? 'border-white text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
            } font-medium`}
          >
            {t === 'results' ? `Results (${survey.results.responseCount})` : 'Questions & settings'}
          </button>
        ))}
      </div>

      {tab === 'results' ? (
        survey.results.responseCount === 0 ? (
          <div className="p-8 border border-dashed border-slate-800 rounded-xl text-center text-xs uppercase tracking-[0.08em] text-slate-500 font-medium">
            No responses yet
          </div>
        ) : (
          <div className="space-y-4">
            {survey.results.questions.map((r) => (
              <div key={r.id} className={`${cardClass} space-y-3`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{r.prompt}</p>
                  <p className="text-xs tabular-nums text-slate-500 shrink-0">{r.count} answers</p>
                </div>
                {r.kind === 'rating' && (
                  <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-6 items-center">
                    <div>
                      <p className="text-4xl font-semibold text-white">{r.average ?? '—'}</p>
                      <p className="text-xs text-slate-500">average out of 5</p>
                    </div>
                    <div className="space-y-1.5">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = r.distribution[star - 1];
                        const pct = r.count ? Math.round((count / r.count) * 100) : 0;
                        return (
                          <div key={star} className="flex items-center gap-3 text-xs">
                            <span className="w-10 text-slate-400 tabular-nums">{star} ★</span>
                            <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: TRACK_COLOR }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BAR_COLOR }} />
                            </div>
                            <span className="w-16 text-right text-slate-400 tabular-nums">
                              {count} · {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {r.kind === 'choice' && (
                  <div className="space-y-1.5">
                    {r.options.map((o, i) => {
                      const pct = r.count ? Math.round((r.counts[i] / r.count) * 100) : 0;
                      return (
                        <div key={o} className="text-xs space-y-1">
                          <div className="flex justify-between text-slate-300">
                            <span>{o}</span>
                            <span className="tabular-nums text-slate-400">
                              {r.counts[i]} · {pct}%
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: TRACK_COLOR }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BAR_COLOR }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {r.kind === 'text' && (
                  <ul className="space-y-2 max-h-80 overflow-y-auto">
                    {r.answers.map((a, i) => (
                      <li key={i} className="p-3 rounded-lg border border-slate-800 text-sm text-slate-200 whitespace-pre-wrap break-words">
                        {a.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-4 max-w-3xl">
          {!editable && (
            <p className="text-xs text-amber-400/80">
              The survey has been sent — you can still fix wording; answers stay attached to their questions.
            </p>
          )}
          <div className={`${cardClass} grid grid-cols-1 sm:grid-cols-2 gap-4`}>
            <div>
              <label className={labelClass}>Send to</label>
              <select
                value={survey.audience}
                disabled={!editable || busy}
                onChange={(e) => patch({ audience: e.target.value })}
                className={`${inputClass} mt-1`}
              >
                <option value="attended">People who were scanned in</option>
                <option value="all">All ticket holders</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Hours after the event ends</label>
              <select
                value={survey.sendAfterHours}
                disabled={!editable || busy}
                onChange={(e) => patch({ sendAfterHours: Number(e.target.value) })}
                className={`${inputClass} mt-1`}
              >
                {[0, 1, 2, 4, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? 'Right when it ends' : `${h} hours`}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Intro (optional)</label>
              <input value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={500} className={`${inputClass} mt-1`} placeholder="It takes about a minute. Your answers are anonymous." />
            </div>
          </div>

          {questions.map((q, i) => (
            <div key={q.id} className={`${cardClass} space-y-3`}>
              <div className="flex gap-2">
                <select
                  value={q.kind}
                  onChange={(e) => updateQuestion(i, { kind: e.target.value as Question['kind'], options: e.target.value === 'choice' ? (q.options.length ? q.options : ['', '']) : [] })}
                  className={`${inputClass} w-36 shrink-0`}
                >
                  <option value="rating">Rating 1–5</option>
                  <option value="choice">Choice</option>
                  <option value="text">Text</option>
                </select>
                <input value={q.prompt} onChange={(e) => updateQuestion(i, { prompt: e.target.value })} maxLength={200} className={inputClass} />
              </div>
              {q.kind === 'choice' && (
                <div className="space-y-2 pl-2">
                  {q.options.map((o, j) => (
                    <div key={j} className="flex gap-2">
                      <input
                        value={o}
                        onChange={(e) => updateQuestion(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })}
                        placeholder={`Option ${j + 1}`}
                        className={inputClass}
                      />
                      {q.options.length > 2 && (
                        <button type="button" onClick={() => updateQuestion(i, { options: q.options.filter((_, k) => k !== j) })} className="text-slate-500 hover:text-rose-400 px-2">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {q.options.length < 8 && (
                    <button type="button" onClick={() => updateQuestion(i, { options: [...q.options, ''] })} className={buttonClass}>
                      + Option
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(i, { required: e.target.checked })} />
                  Required
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => setQuestions((qs) => qs.map((x, k) => (k === i - 1 ? qs[i] : k === i ? qs[i - 1] : x)))}
                    className={buttonClass}
                  >
                    ↑
                  </button>
                  <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, k) => k !== i))} className="px-2 text-[13px] text-rose-400 font-medium">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            {questions.length < 12 && (
              <button
                type="button"
                // Temporary id for React; the server assigns a real one on save.
                onClick={() => setQuestions((qs) => [...qs, { id: `new-${qs.length}-${Date.now()}`, kind: 'text', prompt: '', options: [], required: false }])}
                className={buttonClass}
              >
                + Add question
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run(async () => {
                apply(await request('PATCH', { questions, intro }));
                setNotice('Survey saved.');
              })}
              className={primaryButtonClass}
            >
              Save questions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
