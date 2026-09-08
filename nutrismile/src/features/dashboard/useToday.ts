/**
 * Everything the Today screen shows, for one date.
 *
 * Totals are computed by the pure functions in src/domain from the entries'
 * own snapshots — no food is joined in, so what this returns for a past day
 * cannot change when a food is edited later.
 */
import { useCallback, useEffect, useState } from 'react';
import { dayProgress, dayTotals } from '../../domain/nutrition/totals.ts';
import type { DayProgress, DayTotals } from '../../domain/nutrition/totals.ts';
import type { MacroTargets } from '../../domain/types.ts';
import { logEntries, water } from '../../db/repositories/index.ts';
import type { LogEntry } from '../../db/repositories/logEntries.ts';
import { type DateString, today } from '../../utils/dates.ts';

export interface TodayData {
  entries: LogEntry[];
  totals: DayTotals;
  progress: DayProgress | null;
  waterMl: number;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  undoDelete: (id: string) => Promise<void>;
  addWater: (ml: number) => Promise<void>;
  removeWater: () => Promise<void>;
}

export function useToday(
  userId: string | null,
  targets: MacroTargets | null,
  date: DateString = today(),
): TodayData {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setEntries([]);
      setWaterMl(0);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [loaded, ml] = await Promise.all([
        logEntries.listByDay(userId, date),
        water.totalForDay(userId, date),
      ]);
      setEntries(loaded);
      setWaterMl(ml);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this day.');
    } finally {
      setLoading(false);
    }
  }, [userId, date]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const deleteEntry = useCallback(
    async (id: string) => {
      // Remove locally first so the row disappears under the finger, then
      // persist. A failure reloads from the database rather than guessing.
      setEntries((current) => current.filter((e) => e.id !== id));
      try {
        await logEntries.remove(id);
      } catch {
        await reload();
      }
    },
    [reload],
  );

  const undoDelete = useCallback(
    async (id: string) => {
      await logEntries.restore(id);
      await reload();
    },
    [reload],
  );

  const addWater = useCallback(
    async (ml: number) => {
      if (!userId) return;
      setWaterMl((current) => current + ml);
      try {
        await water.add(userId, ml, date);
      } catch {
        await reload();
      }
    },
    [userId, date, reload],
  );

  const removeWater = useCallback(async () => {
    if (!userId) return;
    await water.removeLast(userId, date);
    await reload();
  }, [userId, date, reload]);

  const totals = dayTotals(
    entries.map((e) => ({ meal: e.meal, nutrition: e.nutrition })),
  );

  return {
    entries,
    totals,
    progress: targets ? dayProgress(totals.total, targets) : null,
    waterMl,
    loading,
    error,
    reload,
    deleteEntry,
    undoDelete,
    addWater,
    removeWater,
  };
}
