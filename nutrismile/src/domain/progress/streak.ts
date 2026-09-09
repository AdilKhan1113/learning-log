/**
 * Days-logged streaks.
 *
 * A streak counts days the user recorded something, and nothing else. It is
 * not a measure of whether they ate well, and the app never treats a broken
 * streak as a failure — the number is reported and that is all.
 */
import { type DateString, addDays, daysBetween } from '../../utils/dates.ts';

export interface StreakSummary {
  /** Days in a row up to and including today, or ending yesterday. */
  current: number;
  /** The longest run anywhere in the data. */
  longest: number;
  /**
   * True when today has not been logged but yesterday was, so the current
   * streak is still alive. Lets the UI say "log today to keep it" without
   * claiming a day that has not happened.
   */
  todayPending: boolean;
}

/**
 * Summarise streaks from the days that have entries.
 *
 * Yesterday counts as the anchor when today is not yet logged: at nine in the
 * morning a user has usually not eaten yet, and telling them their streak is
 * zero would be both wrong and discouraging.
 */
export function summariseStreak(
  loggedDates: readonly DateString[],
  today: DateString,
): StreakSummary {
  if (loggedDates.length === 0) {
    return { current: 0, longest: 0, todayPending: false };
  }

  const days = new Set(loggedDates);
  const sorted = [...days].sort();

  // Longest run anywhere.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = daysBetween(sorted[i - 1]!, sorted[i]!) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const loggedToday = days.has(today);
  const yesterday = addDays(today, -1);
  const anchor = loggedToday ? today : days.has(yesterday) ? yesterday : null;

  if (anchor === null) return { current: 0, longest, todayPending: false };

  let current = 0;
  for (let day = anchor; days.has(day); day = addDays(day, -1)) current++;

  return { current, longest, todayPending: !loggedToday };
}
