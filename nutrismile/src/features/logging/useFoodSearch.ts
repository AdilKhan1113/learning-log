/**
 * Food search, debounced.
 *
 * Recents are shown while the query is empty so the fastest path — logging
 * something eaten before — needs no typing at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { foods } from '../../db/repositories/index.ts';
import type { FoodSummary } from '../../db/repositories/foods.ts';

/** Long enough to avoid a query per keystroke, short enough to feel live. */
const DEBOUNCE_MS = 180;

export type SearchMode = 'recent' | 'favorites' | 'results';

export interface FoodSearchState {
  query: string;
  setQuery: (value: string) => void;
  mode: SearchMode;
  results: FoodSummary[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useFoodSearch(userId: string | null): FoodSearchState {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [mode, setMode] = useState<SearchMode>('recent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identifies the newest request, so a slow earlier one cannot overwrite it.
  const requestId = useRef(0);

  const run = useCallback(
    async (value: string) => {
      if (!userId) return;
      const id = ++requestId.current;
      setLoading(true);
      setError(null);

      try {
        const trimmed = value.trim();
        const found = trimmed
          ? (await foods.search(userId, trimmed)).map((r) => r.item)
          : await foods.recent(userId);

        if (id !== requestId.current) return; // a newer query has since started
        setResults(found);
        setMode(trimmed ? 'results' : 'recent');
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : 'Could not search your foods.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  return {
    query,
    setQuery,
    mode,
    results,
    loading,
    error,
    reload: () => run(query),
  };
}
