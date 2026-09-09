/**
 * Turning a run of daily figures into something a chart can show.
 *
 * Pure: takes rows, returns series. No dates are read from the clock and no
 * database is touched, so every case here is testable.
 */
import type { Nutrition } from '../types.ts';
import { type DateString, addDays, daysBetween } from '../../utils/dates.ts';

/** One day's recorded totals, as the database returns them. */
export interface DailyTotal {
  date: DateString;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entryCount: number;
}

export interface WeightPoint {
  date: DateString;
  weightKg: number;
}

export interface SeriesPoint {
  date: DateString;
  value: number;
}

/**
 * A weight series with a smoothed line through it.
 *
 * Day-to-day weight moves with water, salt and time of day far more than with
 * body fat, so the raw points are shown faintly and the average is what the
 * eye should follow. Seven days is the usual window: it spans a full week, so
 * a weekend does not tilt it.
 */
export interface WeightTrend {
  points: WeightPoint[];
  /** Trailing average. Shorter than the window at the start of the data. */
  trend: SeriesPoint[];
  /** kg per week over the fitted range; null when there is too little data. */
  rateKgPerWeek: number | null;
  first: WeightPoint | null;
  latest: WeightPoint | null;
}

export const TREND_WINDOW_DAYS = 7;

/** Trailing mean over up to `window` preceding points, including this one. */
export function movingAverage(
  points: readonly SeriesPoint[],
  window: number,
): SeriesPoint[] {
  return points.map((point, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = points.slice(from, index + 1);
    const sum = slice.reduce((total, p) => total + p.value, 0);
    return { date: point.date, value: sum / slice.length };
  });
}

/**
 * Least-squares slope in units per day, or null when a line would be
 * meaningless — fewer than two points, or every point on the same date.
 */
export function linearSlopePerDay(points: readonly SeriesPoint[]): number | null {
  if (points.length < 2) return null;

  const origin = points[0]!.date;
  const xs = points.map((p) => daysBetween(origin, p.date));
  const ys = points.map((p) => p.value);
  const n = xs.length;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }

  if (denominator === 0) return null;
  return numerator / denominator;
}

export function weightTrend(
  entries: readonly WeightPoint[],
  window = TREND_WINDOW_DAYS,
): WeightTrend {
  const points = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (points.length === 0) {
    return { points: [], trend: [], rateKgPerWeek: null, first: null, latest: null };
  }

  const series = points.map((p) => ({ date: p.date, value: p.weightKg }));
  const trend = movingAverage(series, window);

  // The rate is fitted to the smoothed line rather than the raw points, so one
  // heavy morning does not swing it.
  const slope = linearSlopePerDay(trend);

  return {
    points,
    trend,
    rateKgPerWeek: slope === null ? null : slope * 7,
    first: points[0]!,
    latest: points[points.length - 1]!,
  };
}

// --- period aggregation ------------------------------------------------------

export type Period = 'week' | 'month';

export interface PeriodAverage {
  /** First day of the period, used as the key and the axis label. */
  start: DateString;
  label: string;
  /** Days in the period that had at least one entry. */
  daysLogged: number;
  /** Averages over the days that were logged, not over the calendar period. */
  average: Nutrition;
}

/** Monday of the week containing `date`. ISO weeks start on Monday. */
export function startOfWeek(date: DateString): DateString {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addDays(date, offset);
}

export function startOfMonth(date: DateString): DateString {
  return `${date.slice(0, 7)}-01`;
}

function periodLabel(start: DateString, period: Period): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const asDate = new Date(y, m - 1, d);
  return period === 'week'
    ? asDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : asDate.toLocaleDateString(undefined, { month: 'short' });
}

/**
 * Average each period over the days that were actually logged.
 *
 * Dividing by seven regardless would show a week with two days logged as a
 * third of the calories the user actually ate, which is not a number anyone
 * wants to see or act on. `daysLogged` is returned alongside so the UI can say
 * how much the average rests on.
 */
export function averageByPeriod(
  days: readonly DailyTotal[],
  period: Period,
): PeriodAverage[] {
  const buckets = new Map<DateString, DailyTotal[]>();

  for (const day of days) {
    if (day.entryCount <= 0) continue;
    const start = period === 'week' ? startOfWeek(day.date) : startOfMonth(day.date);
    const bucket = buckets.get(start);
    if (bucket) bucket.push(day);
    else buckets.set(start, [day]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, entries]) => {
      const count = entries.length;
      const sum = entries.reduce(
        (total, day) => ({
          kcal: total.kcal + day.kcal,
          proteinG: total.proteinG + day.proteinG,
          carbsG: total.carbsG + day.carbsG,
          fatG: total.fatG + day.fatG,
        }),
        { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      );

      return {
        start,
        label: periodLabel(start, period),
        daysLogged: count,
        average: {
          kcal: sum.kcal / count,
          proteinG: sum.proteinG / count,
          carbsG: sum.carbsG / count,
          fatG: sum.fatG / count,
        },
      };
    });
}
