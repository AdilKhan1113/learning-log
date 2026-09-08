/**
 * Display formatting.
 *
 * Numbers are reported and nothing more. There is no copy here that praises,
 * warns or characterises a value — "over", "under" and "left" are the strongest
 * words used, and only where they are literally what the number means.
 */

/** Calories, always whole. */
export function formatKcal(value: number): string {
  return Math.round(value).toLocaleString();
}

/** Grams, one decimal below 10 and whole above, which is how labels read. */
export function formatGrams(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10) return `${Math.round(value * 10) / 10}g`;
  return `${Math.round(value)}g`;
}

/** A quantity as typed, without a trailing '.0'. */
export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * The calories still available, or the amount past the target.
 * Both are stated as plain quantities.
 */
export function formatRemaining(consumed: number, target: number): string {
  const difference = target - consumed;
  if (difference >= 0) return `${formatKcal(difference)} left`;
  return `${formatKcal(-difference)} over`;
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Millilitres, or whole cups once the number gets large. */
export function formatWater(ml: number, unit: 'ml' | 'floz'): string {
  if (unit === 'floz') return `${Math.round(ml / 29.5735295625)} fl oz`;
  if (ml >= 1000) return `${Math.round(ml / 100) / 10} L`;
  return `${Math.round(ml)} ml`;
}

export function formatWeight(kg: number, unit: 'metric' | 'imperial'): string {
  if (unit === 'imperial') return `${(kg / 0.45359237).toFixed(1)} lb`;
  return `${kg.toFixed(1)} kg`;
}
