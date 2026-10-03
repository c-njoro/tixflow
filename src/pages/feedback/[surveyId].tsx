// pages/feedback/[surveyId].tsx
//
// The attendee's feedback form, from their personal link. One response per
// person; the organiser sees answers without names.
import { FormEvent, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

interface Question {
  id: string;
  kind: 'rating' | 'choice' | 'text';
  prompt: string;
  options: string[];
  required: boolean;
}

interface Survey {
  event: { title: string; date: string; organiser: string } | null;
  intro: string | null;
  questions: Question[];
  open: boolean;
  alreadyAnswered: boolean;
}

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export default function FeedbackPage() {
  const router = useRouter();
  const surveyId = typeof router.query.surveyId === 'string' ? router.query.surveyId : undefined;
  const token = typeof router.query.t === 'string' ? router.query.t : undefined;
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!surveyId || !token) return;
    fetch(`/api/feedback/${surveyId}?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'This feedback link is not valid.');
        setSurvey(result.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'This feedback link is not valid.'));
  }, [surveyId, token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/feedback/${surveyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, answers }),
      });
      const result = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(result.error || 'Could not send your feedback.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  const set = (id: string, value: number | string) => setAnswers((a) => ({ ...a, [id]: value }));

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100">
      <Head>
        <title>{survey?.event ? `Feedback · ${survey.event.title}` : 'Feedback · Tixflow'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="max-w-lg mx-auto px-4 py-10 space-y-6">
        {!survey ? (
          <p className="text-center text-sm text-slate-400 pt-20">{error || 'Loading...'}</p>
        ) : done || survey.alreadyAnswered ? (
          <div className="pt-16 text-center space-y-3">
            <CheckCircleIcon className="w-12 h-12 text-emerald-400 mx-auto" />
            <h1 className="text-xl font-bold">Thank you!</h1>
            <p className="text-sm text-slate-400">Your feedback helps {survey.event?.organiser} make the next one better.</p>
          </div>
        ) : !survey.open ? (
          <p className="text-center text-sm text-slate-400 pt-20">This survey is closed.</p>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{survey.event?.organiser}</p>
              <h1 className="text-2xl font-bold mt-1">How was {survey.event?.title}?</h1>
              <p className="text-sm text-slate-400 mt-2">{survey.intro || 'It takes about a minute. Your answers are anonymous.'}</p>
            </div>

            {survey.questions.map((q) => (
              <fieldset key={q.id} className="p-5 bg-[#0E131F] border border-slate-800/80 rounded-xl space-y-3">
                <legend className="sr-only">{q.prompt}</legend>
                <p className="text-sm font-medium text-white">
                  {q.prompt}
                  {q.required && <span className="text-rose-400"> *</span>}
                </p>
                {q.kind === 'rating' && (
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => set(q.id, n)}
                        aria-pressed={answers[q.id] === n}
                        className={`py-2.5 rounded-lg border text-center transition ${
                          answers[q.id] === n ? 'border-amber-400 bg-amber-950/40 text-amber-200' : 'border-slate-800 text-slate-400'
                        }`}
                      >
                        {/* A number + one star fits five buttons across a phone; five stars don't. */}
                        <span className="block text-lg leading-tight">
                          {n}
                          <span className="text-sm"> ★</span>
                        </span>
                        <span className="block text-[9px] font-mono uppercase mt-0.5">{RATING_LABELS[n - 1]}</span>
                      </button>
                    ))}
                  </div>
                )}
                {q.kind === 'choice' && (
                  <div className="space-y-2">
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => set(q.id, o)}
                        aria-pressed={answers[q.id] === o}
                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition ${
                          answers[q.id] === o ? 'border-sky-400 bg-sky-950/40 text-white' : 'border-slate-800 text-slate-300'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                {q.kind === 'text' && (
                  <textarea
                    value={(answers[q.id] as string) || ''}
                    onChange={(e) => set(q.id, e.target.value)}
                    rows={3}
                    maxLength={1000}
                    className="block w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                )}
              </fieldset>
            ))}

            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting || survey.questions.some((q) => q.required && (answers[q.id] === undefined || answers[q.id] === ''))}
              className="w-full py-3 rounded-xl text-sm font-medium bg-white text-black hover:bg-slate-200 transition disabled:opacity-40"
            >
              {submitting ? 'Sending...' : 'Send feedback'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
