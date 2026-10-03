// pages/space/[code]/screen.tsx
//
// The projector / big-screen view. Open it on the laptop connected to the
// venue screen; the organiser switches what it shows from the dashboard.
import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowUpIcon, ArrowsPointingOutIcon } from '@heroicons/react/24/outline';
import { useSpaceState } from '@/components/space/useSpaceState';
import PollResults from '@/components/space/PollResults';
import DocumentPage from '@/components/space/DocumentPage';
import JoinQr from '@/components/space/JoinQr';
import type { PublicSpaceState } from '@/components/space/types';

export default function SpaceScreen() {
  const router = useRouter();
  const code = typeof router.query.code === 'string' ? router.query.code.toUpperCase() : undefined;
  const { state, notFound } = useSpaceState(code);
  // Nothing below the loading state renders on the server, so window is
  // always there when this is actually used.
  const host = typeof window !== 'undefined' ? window.location.host : '';

  const goFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (notFound) {
    return <Frame><Centered><p className="text-3xl text-slate-400">Space not found</p></Centered></Frame>;
  }
  if (!state) {
    return <Frame><Centered><p className="text-xl font-mono uppercase tracking-widest text-slate-600">Loading...</p></Centered></Frame>;
  }

  const mode = state.isOpen ? state.screenMode : 'join';
  const joinPath = `${host}/space/${state.joinCode}`;

  return (
    <Frame title={state.title}>
      <button
        type="button"
        onClick={goFullscreen}
        className="absolute top-4 right-4 p-2 text-slate-700 hover:text-slate-300 transition z-10"
        aria-label="Full screen"
      >
        <ArrowsPointingOutIcon className="w-6 h-6" />
      </button>

      {mode === 'join' ? (
        <Centered>
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <JoinQr joinCode={state.joinCode} size={380} className="p-4 w-[min(30vw,60vh)] h-auto" />
            <div className="text-center lg:text-left max-w-xl">
              <p className="text-xl font-mono uppercase tracking-widest text-slate-500">{state.event.organiser}</p>
              <h1 className="text-6xl font-bold mt-3 leading-tight">{state.title}</h1>
              <p className="text-3xl text-slate-300 mt-10">Scan to join</p>
              <p className="text-2xl text-slate-500 mt-3">or go to</p>
              <p className="text-3xl font-mono text-white mt-1 break-all">{joinPath}</p>
              {state.isOpen && (
                <p className="text-xl font-mono uppercase tracking-widest text-slate-600 mt-10">
                  {state.activeCount} {state.activeCount === 1 ? 'person' : 'people'} here
                </p>
              )}
            </div>
          </div>
        </Centered>
      ) : (
        <div className="h-screen flex flex-col">
          <div className="flex-1 min-h-0 flex flex-col px-16 pt-14 pb-6 overflow-hidden">
            {mode === 'poll' && <PollScreen state={state} />}
            {mode === 'questions' && <QuestionsScreen state={state} />}
            {mode === 'document' && <DocumentScreen state={state} />}
          </div>
          <footer className="shrink-0 flex items-center gap-6 px-16 py-4 border-t border-slate-900">
            <JoinQr joinCode={state.joinCode} size={96} className="p-1 w-[5rem] h-[5rem]" />
            <div>
              <p className="text-lg text-slate-400">Join at</p>
              <p className="text-2xl font-mono">{joinPath}</p>
            </div>
            <p className="ml-auto text-lg font-mono uppercase tracking-widest text-slate-600">{state.title}</p>
          </footer>
        </div>
      )}
    </Frame>
  );
}

// Projectors and laptops come in every shape — size everything from the
// viewport (Tailwind sizes are rem-based) so a screen always fits without
// scrolling, from a short laptop window to a 4K projector.
function useViewportFontSize() {
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.fontSize;
    html.style.fontSize = 'min(1.25vw, 2vh)';
    return () => {
      html.style.fontSize = previous;
    };
  }, []);
}

function Frame({ children, title }: { children: React.ReactNode; title?: string }) {
  useViewportFontSize();
  return (
    <div className="h-screen bg-black text-white relative overflow-hidden">
      <Head>
        <title>{title ? `${title} · Screen` : 'Event Space Screen'}</title>
      </Head>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full min-h-0 flex-1 flex items-center justify-center p-12">{children}</div>;
}

function PollScreen({ state }: { state: PublicSpaceState }) {
  const poll = state.poll;
  if (!poll) return <Centered><p className="text-4xl text-slate-500">No poll right now</p></Centered>;
  return (
    <div className="max-w-6xl w-full mx-auto">
      <p className="text-xl font-mono uppercase tracking-widest text-slate-500">
        {poll.status === 'live' ? 'Live poll — answer on your phone' : 'Final results'}
      </p>
      <h1 className="text-5xl font-bold mt-4 mb-12 leading-tight">{poll.question}</h1>
      {poll.results && <PollResults options={poll.options} results={poll.results} size="lg" />}
    </div>
  );
}

function QuestionsScreen({ state }: { state: PublicSpaceState }) {
  const spotlight = state.spotlightQuestion;
  if (spotlight) {
    return (
      <Centered>
        <div className="max-w-5xl text-center">
          <p className="text-xl font-mono uppercase tracking-widest text-sky-400">Question from the audience</p>
          <p className="text-6xl font-semibold leading-tight mt-8">&ldquo;{spotlight.text}&rdquo;</p>
          <p className="text-2xl text-slate-400 mt-10">
            {spotlight.authorName || 'Anonymous'} · {spotlight.upvotes} upvotes
          </p>
        </div>
      </Centered>
    );
  }

  const top = state.questions.filter((q) => q.status === 'visible').slice(0, 6);
  return (
    <div className="max-w-6xl w-full mx-auto">
      <p className="text-xl font-mono uppercase tracking-widest text-slate-500">Top questions — ask and upvote on your phone</p>
      {top.length === 0 ? (
        <p className="text-4xl text-slate-500 mt-16">No questions yet</p>
      ) : (
        <div className="space-y-5 mt-10">
          {top.map((q) => (
            <div key={q.id} className="flex items-center gap-8 p-6 rounded-2xl bg-slate-900/70">
              <div className="flex flex-col items-center text-sky-300 w-20 shrink-0">
                <ArrowUpIcon className="w-8 h-8" />
                <span className="text-3xl font-mono">{q.upvotes}</span>
              </div>
              <div className="min-w-0">
                <p className="text-3xl leading-snug">{q.text}</p>
                <p className="text-lg text-slate-500 mt-2">{q.authorName || 'Anonymous'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentScreen({ state }: { state: PublicSpaceState }) {
  const doc = state.live ? state.documents.find((d) => d.id === state.live!.documentId) : undefined;
  if (!doc || !state.live) return <Centered><p className="text-4xl text-slate-500">Nothing is being presented</p></Centered>;
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
      <div className="flex justify-center">
        <DocumentPage doc={doc} page={state.live.page} className="max-h-[68vh] w-auto object-contain" />
      </div>
      <p className="text-lg font-mono text-slate-500 mt-4">
        {doc.title} · {state.live.page} / {doc.pageCount}
      </p>
    </div>
  );
}
