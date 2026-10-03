// components/space/useSpaceState.ts
//
// Polls /api/space/[code] for live changes. Sends the last version it saw,
// so an unchanged space costs almost nothing; pauses while the tab is in
// the background and catches up the moment it's visible again.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParticipantState, PublicSpaceState } from './types';

const POLL_INTERVAL_MS = 3000;

export function useSpaceState(code: string | undefined) {
  const [state, setState] = useState<PublicSpaceState | null>(null);
  const [me, setMe] = useState<ParticipantState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);
  const versionRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (force = false) => {
      if (!code) return;
      const query = !force && versionRef.current !== null ? `?v=${versionRef.current}` : '';
      try {
        const res = await fetch(`/api/space/${encodeURIComponent(code)}${query}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error('Request failed');
        const json = await res.json();
        versionRef.current = json.version;
        if (json.changed) {
          setState(json.state);
          setMe(json.me);
        }
        setOffline(false);
      } catch {
        // Venue Wi-Fi drops all the time — keep showing what we have and retry.
        setOffline(true);
      }
    },
    [code]
  );

  useEffect(() => {
    if (!code) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    // The first load always runs (a page opened in a background tab still
    // needs something to show); only the repeat polling pauses while hidden.
    let first = true;
    const loop = async () => {
      if (first || !document.hidden) await refresh();
      first = false;
      if (!stopped) timer = setTimeout(loop, POLL_INTERVAL_MS);
    };
    loop();

    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [code, refresh]);

  return { state, me, notFound, offline, refresh };
}
