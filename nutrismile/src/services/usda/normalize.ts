/**
 * Mapping a USDA branded food into the same shape as an Open Food Facts
 * product, so both sources land in one catalogue and one ranking path.
 *
 * Pure, and tested. The plausibility rules are deliberately the same ones the
 * OFF mapper applies — a source being official does not make its data immune
 * to a decimal point in the wrong place.
 */
import { type Result, err, ok } from '../../domain/result.ts';
import type { BasisUnit } from '../../domain/types.ts';
import { convertToBasis, isMeasureUnit } from '../../domain/nutrition/units.ts';
import type { MappedFood, MappingError } from '../openfoodfacts/normalize.ts';
import { NUTRIENT_IDS, type UsdaFood, type UsdaFoodNutrient } from './types.ts';

const MAX_KCAL_PER_100 = 1000;

/** Look a nutrient up by id, which is stable across datasets in a way that
 *  nutrient names are not. */
export function nutrientValue(
  nutrients: readonly UsdaFoodNutrient[] | undefined,
  id: number,
): number | null {
  const found = nutrients?.find((n) => n.nutrientId === id);
  const value = found?.value;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * USDA records a serving size and its unit as separate fields, so unlike the
 * free text OFF returns there is nothing to parse — only to convert.
 */
export function servingAmount(food: UsdaFood, basisUnit: BasisUnit): number | null {
  const size = food.servingSize;
  const unit = text(food.servingSizeUnit)?.toLowerCase();
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || !unit) return null;
  if (!isMeasureUnit(unit)) return null;

  const converted = convertToBasis(size, unit, basisUnit);
  return converted.ok && converted.value > 0 ? converted.value : null;
}

/** A serving measured in millilitres means the food is measured by volume. */
export function detectBasisUnit(food: UsdaFood): BasisUnit {
  const unit = text(food.servingSizeUnit)?.toLowerCase();
  return unit === 'ml' || unit === 'l' ? 'ml' : 'g';
}

/**
 * Map one branded food. Returns an error rather than throwing so a single bad
 * record does not fail a lookup.
 */
export function mapUsdaFood(food: UsdaFood): Result<MappedFood, MappingError> {
  const sourceId = food.fdcId != null ? String(food.fdcId) : null;
  if (!sourceId) return err({ code: 'no_code' });

  const name = text(food.description);
  if (!name) return err({ code: 'no_name' });

  const nutrients = food.foodNutrients;
  const kcalPer100 = nutrientValue(nutrients, NUTRIENT_IDS.energyKcal);
  if (kcalPer100 === null) return err({ code: 'no_energy' });

  const proteinGPer100 = nutrientValue(nutrients, NUTRIENT_IDS.protein) ?? 0;
  const carbsGPer100 = nutrientValue(nutrients, NUTRIENT_IDS.carbs) ?? 0;
  const fatGPer100 = nutrientValue(nutrients, NUTRIENT_IDS.fat) ?? 0;

  if (kcalPer100 > MAX_KCAL_PER_100) {
    return {
      ok: false,
      error: {
        code: 'implausible',
        detail: `${Math.round(kcalPer100)} kcal per 100 exceeds what any food contains`,
      },
    };
  }
  const macroGrams = proteinGPer100 + carbsGPer100 + fatGPer100;
  if (macroGrams > 105) {
    return err({
      code: 'implausible',
      detail: `macros total ${Math.round(macroGrams)}g per 100`,
    });
  }
  if (kcalPer100 === 0 && macroGrams > 5) {
    return err({ code: 'implausible', detail: 'macros recorded but no energy' });
  }

  const basisUnit = detectBasisUnit(food);
  const gtin = text(food.gtinUpc)?.replace(/\D/g, '') ?? null;
  const amount = servingAmount(food, basisUnit);

  return ok({
    sourceId,
    barcode: gtin && /^\d{6,14}$/.test(gtin) ? gtin : null,
    name,
    brand: text(food.brandName) ?? text(food.brandOwner),
    basisUnit,
    kcalPer100,
    proteinGPer100,
    carbsGPer100,
    fatGPer100,
    fiberGPer100: nutrientValue(nutrients, NUTRIENT_IDS.fiber),
    sugarGPer100: nutrientValue(nutrients, NUTRIENT_IDS.sugars),
    satFatGPer100: nutrientValue(nutrients, NUTRIENT_IDS.satFat),
    sodiumMgPer100: nutrientValue(nutrients, NUTRIENT_IDS.sodiumMg),
    portions:
      amount !== null
        ? [{ label: `1 serving (${food.servingSize}${food.servingSizeUnit})`, amountInBasis: amount }]
        : [],
  });
}

/**
 * Pick the food matching a scanned barcode.
 *
 * USDA's search is a text search, so asking it for a barcode returns anything
 * whose description happens to contain those digits. Only a food whose own
 * GTIN matches is accepted; without this check a scan would happily log an
 * unrelated product.
 */
export function selectByBarcode(
  foods: readonly UsdaFood[],
  candidates: readonly string[],
): UsdaFood | null {
  const wanted = new Set(candidates.map((c) => c.replace(/^0+/, '')));

  for (const food of foods) {
    const gtin = text(food.gtinUpc)?.replace(/\D/g, '');
    if (gtin && wanted.has(gtin.replace(/^0+/, ''))) return food;
  }
  return null;
}
