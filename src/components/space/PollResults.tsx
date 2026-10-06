// components/space/PollResults.tsx
// Shared by the attendee page, the projector screen and the organiser dashboard.
import type { PollResults as Results } from './types';

interface Props {
  options: string[];
  results: Results;
  size?: 'md' | 'lg';
  myOptionIndex?: number | null;
  // Organiser only — hide an inappropriate text answer from everyone.
  onHideAnswer?: (text: string) => void;
}

const percent = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

export default function PollResults({ options, results, size = 'md', myOptionIndex, onHideAnswer }: Props) {
  const large = size === 'lg';

  if (results.kind === 'choice') {
    const top = Math.max(...results.counts, 0);
    return (
      <div className={large ? 'space-y-5' : 'space-y-3'}>
        {options.map((option, i) => {
          const count = results.counts[i] ?? 0;
          const pct = percent(count, results.total);
          const leading = count > 0 && count === top;
          return (
            <div key={i}>
              <div className={`flex justify-between gap-3 ${large ? 'text-3xl mb-2' : 'text-sm mb-1'}`}>
                <span className={`${leading ? 'text-white font-semibold' : 'text-slate-300'} min-w-0 break-words`}>
                  {option}
                  {myOptionIndex === i && <span className="ml-2 text-[11px] uppercase tracking-[0.06em] text-sky-400 font-medium">Your pick</span>}
                </span>
                <span className="tabular-nums text-slate-400 shrink-0">{pct}%</span>
              </div>
              <div className={`w-full bg-slate-800/80 rounded-full overflow-hidden ${large ? 'h-6' : 'h-2.5'}`}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ${leading ? 'bg-sky-400' : 'bg-slate-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className={`uppercase tracking-[0.06em] text-slate-500 ${large ? 'text-lg' : 'text-[11px]'} font-medium`}>
          {results.total} {results.total === 1 ? 'response' : 'responses'}
        </p>
      </div>
    );
  }

  if (results.answers.length === 0) {
    return <p className={`text-slate-500 ${large ? 'text-2xl' : 'text-sm'}`}>No answers yet.</p>;
  }

  const max = results.answers[0].count;
  const min = results.answers[results.answers.length - 1].count;
  const [smallest, largest] = large ? [1.25, 5] : [0.85, 2.1];
  const fontSize = (count: number) =>
    max === min ? (smallest + largest) / 2 : smallest + ((count - min) / (max - min)) * (largest - smallest);

  // Shuffle-free but not strictly ranked: alternate big and small words so
  // the cloud doesn't look like a sorted list.
  const cloud = results.answers.slice(0, 25).map((a, i) => ({ ...a, rank: i }));
  const arranged = [...cloud.filter((_, i) => i % 2 === 0).reverse(), ...cloud.filter((_, i) => i % 2 === 1)];
  const palette = ['text-sky-300', 'text-white', 'text-emerald-300', 'text-amber-200', 'text-violet-300', 'text-rose-300'];

  return (
    <div className={large ? 'space-y-10' : 'space-y-5'}>
      <div className={`flex flex-wrap items-center justify-center ${large ? 'gap-x-8 gap-y-4' : 'gap-x-4 gap-y-2'}`}>
        {arranged.map((a) => (
          <span
            key={a.text}
            className={`font-semibold leading-tight ${palette[a.rank % palette.length]} transition-all duration-700`}
            style={{ fontSize: `${fontSize(a.count)}rem` }}
            title={`${a.count}`}
          >
            {a.text}
          </span>
        ))}
      </div>

      <ol className={large ? 'grid grid-cols-2 gap-x-12 gap-y-3' : 'space-y-1.5'}>
        {results.answers.slice(0, large ? 10 : 8).map((a, i) => (
          <li key={a.text} className={`flex items-center gap-3 ${large ? 'text-2xl' : 'text-sm'}`}>
            <span className="tabular-nums text-slate-500 w-6 shrink-0">{i + 1}.</span>
            <span className="text-slate-200 flex-1 min-w-0 break-words">{a.text}</span>
            <span className="tabular-nums text-slate-400 shrink-0">{a.count}</span>
            {onHideAnswer && (
              <button
                type="button"
                onClick={() => onHideAnswer(a.text)}
                className="text-xs text-rose-400 hover:text-rose-300 shrink-0 font-medium"
              >
                Hide
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className={`uppercase tracking-[0.06em] text-slate-500 ${large ? 'text-lg' : 'text-[11px]'} font-medium`}>
        {results.total} {results.total === 1 ? 'answer' : 'answers'}
      </p>
    </div>
  );
}
