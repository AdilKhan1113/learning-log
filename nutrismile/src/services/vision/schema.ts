/**
 * Validating a meal estimate returned by the vision model.
 *
 * The model is asked for strict JSON and the tool schema constrains it, but
 * this still validates everything: the response crosses a network boundary,
 * and an estimate that reaches the log without checking would put invented
 * numbers into a day's totals.
 *
 * Items that fail are dropped rather than corrected. An estimate the user is
 * about to confirm should be the model's actual guess, not one this file
 * quietly repaired.
 *
 * Pure, and therefore all of it is tested.
 */
import { type Result, err, ok } from '../../domain/result.ts';

/** One identified food, as the model reports it. */
export interface EstimatedFood {
  /** Stable within a response, so the review list can key and edit rows. */
  id: string;
  name: string;
  grams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** 0–1. The model's own confidence in this line. */
  confidence: number;
}

export interface MealEstimate {
  foods: EstimatedFood[];
  /** 0–1 across the whole photo. */
  confidence: number;
  /** The model's note when a photo is hard to read. Shown, never hidden. */
  note: string | null;
  /** Items the model returned that could not be trusted, by reason. */
  dropped: { reason: DropReason; count: number }[];
}

export type DropReason =
  | 'no_name'
  | 'bad_portion'
  | 'bad_energy'
  | 'impossible_macros'
  | 'energy_mismatch';

export type EstimateError =
  | { code: 'malformed' }
  | { code: 'no_foods' }
  | { code: 'all_dropped'; dropped: { reason: DropReason; count: number }[] };

/** No single item on a plate weighs more than this. */
const MAX_GRAMS = 3000;

/** Pure fat is ~9 kcal/g, so nothing exceeds this per gram. */
const MAX_KCAL_PER_GRAM = 9.5;

/**
 * How far the stated calories may sit from what the macros imply before the
 * line is treated as internally inconsistent.
 *
 * Atwater factors give 4/4/9 kcal per gram, but fibre, sugar alcohols and
 * rounding all move the real figure, so the tolerance is wide. It is here to
 * catch a line that is wrong by a factor, not one that is off by a few percent.
 */
const ENERGY_TOLERANCE = 0.4;

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Models occasionally emit a number as a string despite the schema.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nonNegative(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n >= 0 ? n : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Confidence is clamped rather than rejected: a value outside 0–1 is a
 *  miscalibrated number, not a reason to lose the whole line. */
function clampConfidence(value: unknown): number {
  const n = finiteNumber(value);
  if (n === null) return 0.5;
  return Math.max(0, Math.min(1, n));
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Validate one item. Returns why it was dropped rather than throwing. */
export function validateFood(
  raw: unknown,
  index: number,
): Result<EstimatedFood, DropReason> {
  if (typeof raw !== 'object' || raw === null) return err('no_name');
  const item = raw as Record<string, unknown>;

  const name = text(item.name);
  if (!name) return err('no_name');

  const grams = nonNegative(item.grams);
  if (grams === null || grams <= 0 || grams > MAX_GRAMS) return err('bad_portion');

  const kcal = nonNegative(item.kcal);
  if (kcal === null || kcal > grams * MAX_KCAL_PER_GRAM) return err('bad_energy');

  const proteinG = nonNegative(item.proteinG) ?? 0;
  const carbsG = nonNegative(item.carbsG) ?? 0;
  const fatG = nonNegative(item.fatG) ?? 0;

  // Macros cannot outweigh the food they came from.
  if (proteinG + carbsG + fatG > grams * 1.05) return err('impossible_macros');

  // A line whose calories and macros disagree by a wide margin is one the
  // model has not thought through, and confirming it would log both numbers.
  const impliedKcal = proteinG * 4 + carbsG * 4 + fatG * 9;
  if (impliedKcal > 0 && kcal > 0) {
    const ratio = kcal / impliedKcal;
    if (ratio < 1 - ENERGY_TOLERANCE || ratio > 1 + ENERGY_TOLERANCE) {
      return err('energy_mismatch');
    }
  }

  return ok({
    id: `${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    grams: round1(grams),
    kcal: round1(kcal),
    proteinG: round1(proteinG),
    carbsG: round1(carbsG),
    fatG: round1(fatG),
    confidence: clampConfidence(item.confidence),
  });
}

/**
 * Validate a whole response.
 *
 * A response with some usable items returns those, with the dropped ones
 * counted so the screen can say the estimate is partial. A response with
 * nothing usable is an error: showing an empty list for a photo of a meal
 * would read as "there is no food here".
 */
export function parseMealEstimate(raw: unknown): Result<MealEstimate, EstimateError> {
  if (typeof raw !== 'object' || raw === null) return err({ code: 'malformed' });
  const body = raw as Record<string, unknown>;

  const rawFoods = body.foods;
  if (!Array.isArray(rawFoods)) return err({ code: 'malformed' });
  if (rawFoods.length === 0) return err({ code: 'no_foods' });

  const foods: EstimatedFood[] = [];
  const reasons = new Map<DropReason, number>();

  for (const [index, item] of rawFoods.entries()) {
    const result = validateFood(item, index);
    if (result.ok) {
      foods.push(result.value);
    } else {
      reasons.set(result.error, (reasons.get(result.error) ?? 0) + 1);
    }
  }

  const dropped = [...reasons].map(([reason, count]) => ({ reason, count }));
  if (foods.length === 0) return err({ code: 'all_dropped', dropped });

  return ok({
    foods,
    // An overall confidence the model did not give is inferred from the items,
    // taking the least confident rather than the average: a plate is only as
    // well understood as its least certain part.
    confidence:
      finiteNumber(body.confidence) !== null
        ? clampConfidence(body.confidence)
        : Math.min(...foods.map((f) => f.confidence)),
    note: text(body.note),
    dropped,
  });
}

/**
 * Rescale one item's nutrition to a different portion.
 *
 * The review screen lets the user correct a portion, and the calories and
 * macros have to follow. Scaling linearly is what the model's own per-item
 * figures imply.
 */
export function rescaleFood(food: EstimatedFood, grams: number): EstimatedFood {
  if (!Number.isFinite(grams) || grams <= 0 || food.grams <= 0) return food;
  const factor = grams / food.grams;
  return {
    ...food,
    grams: round1(grams),
    kcal: round1(food.kcal * factor),
    proteinG: round1(food.proteinG * factor),
    carbsG: round1(food.carbsG * factor),
    fatG: round1(food.fatG * factor),
  };
}

/** What a dropped item means, for the "some items were left out" note. */
export function describeDropReason(reason: DropReason): string {
  switch (reason) {
    case 'no_name':
      return 'an item with no name';
    case 'bad_portion':
      return 'an item with an unusable portion size';
    case 'bad_energy':
      return 'an item with unusable calories';
    case 'impossible_macros':
      return 'an item whose macros outweighed the food';
    case 'energy_mismatch':
      return "an item whose calories and macros didn't agree";
  }
}
