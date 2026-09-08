/**
 * Calendar dates.
 *
 * A log day is a 'YYYY-MM-DD' string in the device's own timezone, never a UTC
 * instant. Someone who logs dinner at 9pm and flies overnight should still see
 * that dinner on the day they ate it.
 */

export type DateString = string;

/** The local calendar date of an instant, as 'YYYY-MM-DD'. */
export function toDateString(date: Date = new Date()): DateString {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function today(): DateString {
  return toDateString(new Date());
}

/** Midnight local time on the given date. */
export function fromDateString(value: DateString): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(value: DateString, days: number): DateString {
  const date = fromDateString(value);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DateString, to: DateString): number {
  const ms = fromDateString(to).getTime() - fromDateString(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** 'Today', 'Yesterday', otherwise a short date. */
export function describeDay(value: DateString, now: DateString = today()): string {
  const delta = daysBetween(now, value);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  return fromDateString(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The seven dates ending at `value`, oldest first. */
export function lastNDays(n: number, value: DateString = today()): DateString[] {
  return Array.from({ length: n }, (_, i) => addDays(value, i - (n - 1)));
}
