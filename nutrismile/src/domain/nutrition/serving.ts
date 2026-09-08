/**
 * Serving size resolution and nutrition scaling.
 *
 * Two steps, kept separate so each is testable on its own:
 *   1. a quantity and a unit label become an amount in the food's basis unit
 *   2. that amount scales the food's per-100 values into real nutrition
 */
import type { FoodLike, Nutrition, NutritionPer100, Portion } from '../types.ts';
import { type Result, err, ok } from '../result.ts';
import {
  type ConversionError,
  MASS_UNITS,
  VOLUME_UNITS,
  convertToBasis,
  isMeasureUnit,
} from './units.ts';

export type ServingError =
  | ConversionError
  | { code: 'unknown_portion'; label: string }
  | { code: 'invalid_quantity'; quantity: number };

/** One choice in the unit picker. */
export interface UnitOption {
  /** Stored on the log entry as unit_label, and shown in the UI. */
  label: string;
  kind: 'portion' | 'mass' | 'volume';
  portionId?: string;
  isDefault: boolean;
}

/**
 * The units this food can be logged in.
 *
 * Named portions come first because they are the fastest thing to tap, then
 * mass, then volume — and volume only when the food's density is known, so the
 * picker never offers a conversion that would have to be guessed.
 */
export function availableUnits(food: FoodLike): UnitOption[] {
  const portions = (food.portions ?? []).map<UnitOption>((p) => ({
    label: p.label,
    kind: 'portion',
    portionId: p.id,
    isDefault: p.isDefault,
  }));

  const hasDensity = !!food.gramsPerMl && food.gramsPerMl > 0;
  const massOffered = food.per100.basisUnit === 'g' || hasDensity;
  const volumeOffered = food.per100.basisUnit === 'ml' || hasDensity;

  const mass = massOffered
    ? MASS_UNITS.map<UnitOption>((u) => ({ label: u, kind: 'mass', isDefault: false }))
    : [];
  const volume = volumeOffered
    ? VOLUME_UNITS.map<UnitOption>((u) => ({ label: u, kind: 'volume', isDefault: false }))
    : [];

  const options = [...portions, ...mass, ...volume];

  // Something must be selected when the sheet opens. Prefer the food's own
  // default portion, else its basis unit.
  if (!options.some((o) => o.isDefault)) {
    const fallback =
      options.find((o) => o.label === food.per100.basisUnit) ?? options[0];
    if (fallback) fallback.isDefault = true;
  }

  return options;
}

function findPortion(
  portions: readonly Portion[] | undefined,
  label: string,
): Portion | undefined {
  return portions?.find((p) => p.id === label || p.label === label);
}

/**
 * Resolve a quantity and unit into an amount of the food's basis unit.
 * Named portions are checked before measure units so a food may define a
 * portion called "cup" that differs from the generic 236.6 ml one.
 */
export function resolveAmountInBasis(
  food: FoodLike,
  quantity: number,
  unitLabel: string,
): Result<number, ServingError> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return err({ code: 'invalid_quantity', quantity });
  }

  const portion = findPortion(food.portions, unitLabel);
  if (portion) return ok(quantity * portion.amountInBasis);

  if (isMeasureUnit(unitLabel)) {
    return convertToBasis(
      quantity,
      unitLabel,
      food.per100.basisUnit,
      food.gramsPerMl,
    );
  }

  return err({ code: 'unknown_portion', label: unitLabel });
}

/** Scale per-100 values by an amount of the basis unit. */
export function scaleNutrition(
  per100: NutritionPer100,
  amountInBasis: number,
): Nutrition {
  const factor = amountInBasis / 100;
  return {
    kcal: per100.kcal * factor,
    proteinG: per100.proteinG * factor,
    carbsG: per100.carbsG * factor,
    fatG: per100.fatG * factor,
    fiberG: scaleOptional(per100.fiberG, factor),
    sugarG: scaleOptional(per100.sugarG, factor),
    satFatG: scaleOptional(per100.satFatG, factor),
    sodiumMg: scaleOptional(per100.sodiumMg, factor),
  };
}

export interface ServingResult {
  amountInBasis: number;
  nutrition: Nutrition;
}

/**
 * The whole path in one call: what a given serving of a food actually is.
 * This is what the serving editor recomputes on every keystroke.
 */
export function nutritionForServing(
  food: FoodLike,
  quantity: number,
  unitLabel: string,
): Result<ServingResult, ServingError> {
  const amount = resolveAmountInBasis(food, quantity, unitLabel);
  if (!amount.ok) return amount;
  return ok({
    amountInBasis: amount.value,
    nutrition: scaleNutrition(food.per100, amount.value),
  });
}

// --- recipes -----------------------------------------------------------------

export interface RecipeIngredientLike {
  per100: NutritionPer100;
  amountInBasis: number;
}

/** Nutrition for a whole recipe: the sum of its ingredients. */
export function recipeTotals(
  ingredients: readonly RecipeIngredientLike[],
): Nutrition {
  return sumNutrition(
    ingredients.map((i) => scaleNutrition(i.per100, i.amountInBasis)),
  );
}

/**
 * Nutrition for one serving of a recipe. Always derived from the ingredients,
 * never stored as an independent number, so an edited ingredient cannot leave
 * a stale per-serving figure behind.
 */
export function recipePerServing(
  ingredients: readonly RecipeIngredientLike[],
  servings: number,
): Result<Nutrition, ServingError> {
  if (!Number.isFinite(servings) || servings <= 0) {
    return err({ code: 'invalid_quantity', quantity: servings });
  }
  return ok(divideNutrition(recipeTotals(ingredients), servings));
}

// --- combining ---------------------------------------------------------------

const ZERO: Nutrition = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/**
 * Add nutrition values together.
 *
 * Optional fields stay undefined unless at least one input reported them, so a
 * day of foods that never listed fibre shows "—" rather than a confident 0.
 */
export function sumNutrition(items: readonly Nutrition[]): Nutrition {
  if (items.length === 0) return { ...ZERO };

  const total: Nutrition = { ...ZERO };
  for (const item of items) {
    total.kcal += item.kcal;
    total.proteinG += item.proteinG;
    total.carbsG += item.carbsG;
    total.fatG += item.fatG;
    total.fiberG = addOptional(total.fiberG, item.fiberG);
    total.sugarG = addOptional(total.sugarG, item.sugarG);
    total.satFatG = addOptional(total.satFatG, item.satFatG);
    total.sodiumMg = addOptional(total.sodiumMg, item.sodiumMg);
  }
  return total;
}

export function divideNutrition(n: Nutrition, divisor: number): Nutrition {
  const factor = 1 / divisor;
  return {
    kcal: n.kcal * factor,
    proteinG: n.proteinG * factor,
    carbsG: n.carbsG * factor,
    fatG: n.fatG * factor,
    fiberG: scaleOptional(n.fiberG, factor),
    sugarG: scaleOptional(n.sugarG, factor),
    satFatG: scaleOptional(n.satFatG, factor),
    sodiumMg: scaleOptional(n.sodiumMg, factor),
  };
}

/**
 * Round for storage. Floats accumulate visible noise across a day of entries,
 * and two decimal places is far finer than any food label is accurate to.
 */
export function roundNutrition(n: Nutrition, dp = 2): Nutrition {
  const r = (v: number) => Math.round(v * 10 ** dp) / 10 ** dp;
  return {
    kcal: r(n.kcal),
    proteinG: r(n.proteinG),
    carbsG: r(n.carbsG),
    fatG: r(n.fatG),
    fiberG: n.fiberG === undefined ? undefined : r(n.fiberG),
    sugarG: n.sugarG === undefined ? undefined : r(n.sugarG),
    satFatG: n.satFatG === undefined ? undefined : r(n.satFatG),
    sodiumMg: n.sodiumMg === undefined ? undefined : r(n.sodiumMg),
  };
}

function scaleOptional(
  value: number | undefined | null,
  factor: number,
): number | undefined {
  return value === undefined || value === null ? undefined : value * factor;
}

function addOptional(
  total: number | undefined,
  value: number | undefined | null,
): number | undefined {
  if (value === undefined || value === null) return total;
  return (total ?? 0) + value;
}
