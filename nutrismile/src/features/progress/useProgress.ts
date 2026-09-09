/**
 * Everything the Progress screen shows.
 *
 * All of it is derived by the pure functions in src/domain/progress from rows
 * the repositories return, so what appears here is testable without a screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DailyTotal,
  type Period,
  type PeriodAverage,
  type WeightTrend,
  averageByPeriod,
  weightTrend,
} from '../../domain/progress/trends.ts';
import { type StreakSummary, summariseStreak } from '../../domain/progress/streak.ts';
import { logEntries, weight } from '../../db/repositories/index.ts';
import { addDays, today } from '../../utils/dates.ts';

/** How far back each view reads. A year covers the monthly chart comfortably. */
const HISTORY_DAYS = 365;

export interface ProgressData {
  loading: boolean;
  error: string | null;
  streak: StreakSummary;
  trend: WeightTrend;
  periods: PeriodAverage[];
  period: Period;
  setPeriod: (period: Period) => void;
  reload: () => Promise<void>;
  /** Record today's weight, then refresh. */
  recordWeight: (weightKg: number) => Promise<void>;
}

const EMPTY_STREAK: StreakSummary = { current: 0, longest: 0, todayPending: false };

export function useProgress(userId: string | null): ProgressData {
  const [days, setDays] = useState<DailyTotal[]>([]);
  const [weights, setWeights] = useState<{ date: string; weightKg: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('week');

  const reload = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const to = today();
    const from = addDays(to, -HISTORY_DAYS);

    try {
      setError(null);
      const [totals, history] = await Promise.all([
        logEntries.dailyTotals(userId, from, to),
        weight.history(userId, from),
      ]);
      setDays(totals);
      setWeights(history.map((w) => ({ date: w.logDate, weightKg: w.weightKg })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your history.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const recordWeight = useCallback(
    async (weightKg: number) => {
      if (!userId) return;
      await weight.record(userId, weightKg, today());
      await reload();
    },
    [userId, reload],
  );

  const streak = useMemo(
    () =>
      days.length === 0
        ? EMPTY_STREAK
        : summariseStreak(
            days.filter((d) => d.entryCount > 0).map((d) => d.date),
            today(),
          ),
    [days],
  );

  const trend = useMemo(() => weightTrend(weights), [weights]);
  const periods = useMemo(() => averageByPeriod(days, period), [days, period]);

  return useMemo(
    () => ({ loading, error, streak, trend, periods, period, setPeriod, reload, recordWeight }),
    [loading, error, streak, trend, periods, period, reload, recordWeight],
  );
}
