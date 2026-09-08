/**
 * Food search: local first, then the food database.
 *
 * Local results appear immediately, because the user's own foods and anything
 * already cached are the common case and need no network. The remote lookup
 * runs behind that, and its results are written into the same local catalogue
 * and re-queried — so ranking, typo tolerance and the familiarity boosts all
 * come from one tested path, and everything found this way is available
 * offline the next time.
 *
 * A remote failure never clears what is already on screen. Being offline
 * degrades the feature to local search with a note, rather than presenting an
 * empty list as though nothing matched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { foods } from '../../db/repositories/index.ts';
import type { FoodSummary } from '../../db/repositories/foods.ts';
import {
  MIN_REMOTE_QUERY_LENGTH,
  describeLookupError,
  searchProducts,
} from '../../services/openfoodfacts/index.ts';

/** Long enough to avoid a query per keystroke, short enough to feel live. */
const LOCAL_DEBOUNCE_MS = 180;

/**
 * The remote lookup waits longer than the local one. Typing "chicken" should
 * cost one request, not seven.
 */
const REMOTE_DEBOUNCE_MS = 500;

export type SearchMode = 'recent' | 'results';
export type RemoteStatus = 'idle' | 'searching' | 'done' | 'failed';

export interface FoodSearchState {
  query: string;
  setQuery: (value: string) => void;
  mode: SearchMode;
  results: FoodSummary[];
  /** The local query is running and there is nothing to show yet. */
  loading: boolean;
  remoteStatus: RemoteStatus;
  /** Why the food database could not be reached. Never an error dialog. */
  remoteNotice: string | null;
  /** A local failure, which is the only kind that leaves nothing to show. */
  error: string | null;
  reload: () => Promise<void>;
}

export function useFoodSearch(userId: string | null): FoodSearchState {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [mode, setMode] = useState<SearchMode>('recent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>('idle');
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);

  /** Identifies the newest query, so a slow earlier one cannot overwrite it. */
  const generation = useRef(0);
  /** Cancels the in-flight remote request when a newer query starts. */
  const remoteAbort = useRef<AbortController | null>(null);

  const runLocal = useCallback(
    async (value: string, id: number) => {
      if (!userId) return;
      const trimmed = value.trim();
      const found = trimmed
        ? (await foods.search(userId, trimmed)).map((r) => r.item)
        : await foods.recent(userId);

      if (id !== generation.current) return;
      setResults(found);
      setMode(trimmed ? 'results' : 'recent');
    },
    [userId],
  );

  const runRemote = useCallback(
    async (value: string, id: number) => {
      const trimmed = value.trim();
      if (!userId || trimmed.length < MIN_REMOTE_QUERY_LENGTH) {
        setRemoteStatus('idle');
        return;
      }

      remoteAbort.current?.abort();
      const controller = new AbortController();
      remoteAbort.current = controller;

      setRemoteStatus('searching');
      setRemoteNotice(null);

      try {
        const response = await searchProducts(trimmed, { signal: controller.signal });
        if (id !== generation.current) return;

        if (!response.ok) {
          setRemoteStatus('failed');
          setRemoteNotice(describeLookupError(response.error));
          return;
        }

        // Cache first, then re-run the local query, so remote results are
        // ranked and deduplicated by the same code as everything else.
        await foods.cacheProducts(response.value.foods);
        if (id !== generation.current) return;

        await runLocal(value, id);
        if (id !== generation.current) return;
        setRemoteStatus('done');
      } catch {
        // Aborted because a newer query started, or the screen went away.
        // Neither is something to tell the user about.
        if (id === generation.current) setRemoteStatus('idle');
      }
    },
    [userId, runLocal],
  );

  const run = useCallback(
    async (value: string) => {
      if (!userId) return;
      const id = ++generation.current;
      setLoading(true);
      setError(null);

      try {
        await runLocal(value, id);
      } catch (e) {
        if (id !== generation.current) return;
        setError(e instanceof Error ? e.message : 'Could not search your foods.');
      } finally {
        if (id === generation.current) setLoading(false);
      }
    },
    [userId, runLocal],
  );

  // Local search, on every keystroke after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => void run(query), LOCAL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  // Remote search, on a longer pause, so one word costs one request.
  useEffect(() => {
    const timer = setTimeout(
      () => void runRemote(query, generation.current),
      REMOTE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query, runRemote]);

  // Abandon any in-flight request when the screen goes away.
  useEffect(() => () => remoteAbort.current?.abort(), []);

  return {
    query,
    setQuery,
    mode,
    results,
    loading,
    remoteStatus,
    remoteNotice,
    error,
    reload: () => run(query),
  };
}
