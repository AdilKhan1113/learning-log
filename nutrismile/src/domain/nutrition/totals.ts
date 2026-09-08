/**
 * Rolling logged entries up into what the dashboard shows.
 *
 * Everything here reports numbers and nothing else. There is no notion of a
 * day being good or bad, over or under — the UI states what was eaten and what
 * the target was, and leaves the interpretation to the person.
 */
import type { MacroTargets, Meal, Nutrition } from '../types.ts';
import { sumNutrition } from './serving.ts';

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
};

/** The minimum a log entry needs to expose to be counted. */
export interface EntryLike {
  meal: Meal;
  nutrition: Nutrition;
}

export interface DayTotals {
  total: Nutrition;
  byMeal: Record<Meal, Nutrition>;
  entryCount: number;
}

/** Totals for a day, and for each meal within it. */
export function dayTotals(entries: readonly EntryLike[]): DayTotals {
  const byMeal = {} as Record<Meal, Nutrition>;
  for (const meal of MEALS) {
    byMeal[meal] = sumNutrition(
      entries.filter((e) => e.meal === meal).map((e) => e.nutrition),
    );
  }
  return {
    total: sumNutrition(entries.map((e) => e.nutrition)),
    byMeal,
    entryCount: entries.length,
  };
}

export interface Progress {
  consumed: number;
  target: number;
  /**
   * Consumed minus target. Negative means some of the target is unused;
   * positive means it was passed. Both are stated plainly, neither is flagged.
   */
  difference: number;
  /** consumed / target. Not clamped — the caller decides how to draw past 1. */
  ratio: number;
}

function progress(consumed: number, target: number): Progress {
  return {
    consumed,
    target,
    difference: consumed - target,
    ratio: target > 0 ? consumed / target : 0,
  };
}

export interface DayProgress {
  calories: Progress;
  protein: Progress;
  carbs: Progress;
  fat: Progress;
}

/** Consumed against target, for the ring and the macro bars. */
export function dayProgress(
  consumed: Nutrition,
  targets: MacroTargets,
): DayProgress {
  return {
    calories: progress(consumed.kcal, targets.calorieTarget),
    protein: progress(consumed.proteinG, targets.proteinGTarget),
    carbs: progress(consumed.carbsG, targets.carbsGTarget),
    fat: progress(consumed.fatG, targets.fatGTarget),
  };
}

/**
 * How the day's calories divide between the macros, as percentages summing to
 * 100. Returns zeroes for an empty day rather than dividing by zero.
 */
export function macroDistribution(consumed: Nutrition): {
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
} {
  const proteinKcal = consumed.proteinG * 4;
  const carbsKcal = consumed.carbsG * 4;
  const fatKcal = consumed.fatG * 9;
  const total = proteinKcal + carbsKcal + fatKcal;
  if (total <= 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };
  return {
    proteinPct: (proteinKcal * 100) / total,
    carbsPct: (carbsKcal * 100) / total,
    fatPct: (fatKcal * 100) / total,
  };
}

/** Water intake against its target, in millilitres. */
export function waterProgress(consumedMl: number, targetMl: number): Progress {
  return progress(consumedMl, targetMl);
}
