/**
 * Turning an Open Food Facts product into something safe to store.
 *
 * Pure and defensive. The payload is crowd-sourced, so this validates rather
 * than trusts: a product with no name, no usable energy value, or physically
 * impossible numbers is rejected instead of being written to the local
 * catalogue where it would resurface in every future search.
 *
 * Nothing here performs I/O, so all of it is unit-tested.
 */
import { type Result, err, ok } from '../../domain/result.ts';
import type { BasisUnit } from '../../domain/types.ts';
import { convertToBasis, isMeasureUnit } from '../../domain/nutrition/units.ts';
import type { OffNutriments, OffProduct } from './types.ts';

/** A product mapped into the shape the foods table stores. */
export interface MappedFood {
  sourceId: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  basisUnit: BasisUnit;
  kcalPer100: number;
  proteinGPer100: number;
  carbsGPer100: number;
  fatGPer100: number;
  fiberGPer100: number | null;
  sugarGPer100: number | null;
  satFatGPer100: number | null;
  sodiumMgPer100: number | null;
  portions: { label: string; amountInBasis: number }[];
}

export type MappingError =
  | { code: 'no_code' }
  | { code: 'no_name' }
  | { code: 'no_energy' }
  | { code: 'implausible'; detail: string };

/** Kilojoules in one kilocalorie. */
const KJ_PER_KCAL = 4.184;

/**
 * Pure fat is about 900 kcal per 100 g, so anything past this is a data-entry
 * error — usually a per-package value recorded as if it were per 100 g.
 */
const MAX_KCAL_PER_100 = 1000;

/** Sodium is 1/2.5 of salt by mass. */
const SALT_TO_SODIUM = 1 / 2.5;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Energy per 100, in kcal.
 *
 * OFF records kcal directly on most products but not all; where it is missing
 * the kilojoule value is converted rather than the product being dropped.
 */
export function energyKcalPer100(nutriments: OffNutriments): number | null {
  const kcal = nonNegative(nutriments['energy-kcal_100g']);
  if (kcal !== null) return kcal;

  const kj = nonNegative(nutriments['energy-kj_100g']);
  if (kj !== null) return kj / KJ_PER_KCAL;

  // The generic `energy_100g` is kJ unless the record says otherwise.
  const generic = nonNegative(nutriments.energy_100g);
  if (generic !== null) {
    const unit = text(nutriments.energy_unit)?.toLowerCase();
    return unit === 'kcal' ? generic : generic / KJ_PER_KCAL;
  }

  return null;
}

/** Sodium in mg per 100, from either the sodium or the salt figure. */
export function sodiumMgPer100(nutriments: OffNutriments): number | null {
  const sodiumG = nonNegative(nutriments.sodium_100g);
  if (sodiumG !== null) return sodiumG * 1000;

  const saltG = nonNegative(nutriments.salt_100g);
  if (saltG !== null) return saltG * SALT_TO_SODIUM * 1000;

  return null;
}

/**
 * Whether a product's numbers are recorded per 100 ml rather than per 100 g.
 *
 * OFF names every field `*_100g` regardless, and stores per-100-ml figures for
 * drinks under those same names. The package size is the most reliable signal
 * available, with the serving size as a fallback.
 */
export function detectBasisUnit(product: OffProduct): BasisUnit {
  const haystack = `${product.quantity ?? ''} ${product.serving_size ?? ''}`.toLowerCase();
  return /\b\d+(?:[.,]\d+)?\s*(ml|cl|dl|l|litre|liter|fl\.?\s?oz)\b/.test(haystack)
    ? 'ml'
    : 'g';
}

/** Every `<number> <unit>` pair in a string, in order. */
function measurements(input: string): { quantity: number; unit: string }[] {
  const found: { quantity: number; unit: string }[] = [];
  const pattern = /(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/g;

  for (const match of input.matchAll(pattern)) {
    const quantity = Number.parseFloat(match[1]!.replace(',', '.'));
    const unit = match[2]!.toLowerCase();
    if (Number.isFinite(quantity) && quantity > 0) found.push({ quantity, unit });
  }
  return found;
}

/**
 * The size of one serving, in the food's basis unit.
 *
 * OFF serving text is free-form: '30 g', '1 cup (240 ml)', '2 biscuits (25 g)'.
 * A parenthesised measurement is preferred because that is where the concrete
 * amount lives when the leading number counts items rather than measuring
 * them. A serving that cannot be converted to the basis unit — a volume for a
 * food measured by mass, with no density known — yields null rather than a
 * guess.
 */
export function parseServingSize(
  servingSize: string | undefined,
  basisUnit: BasisUnit,
): number | null {
  const raw = text(servingSize);
  if (!raw) return null;

  const parenthesised = raw.match(/\(([^)]*)\)/)?.[1];
  const candidates = [
    ...(parenthesised ? measurements(parenthesised) : []),
    ...measurements(raw),
  ];

  for (const candidate of candidates) {
    if (!isMeasureUnit(candidate.unit)) continue;
    const converted = convertToBasis(candidate.quantity, candidate.unit, basisUnit);
    if (converted.ok && converted.value > 0) return converted.value;
  }

  return null;
}

/** Reject values that cannot describe a real food. */
function checkPlausible(food: {
  kcalPer100: number;
  proteinGPer100: number;
  carbsGPer100: number;
  fatGPer100: number;
}): MappingError | null {
  const { kcalPer100, proteinGPer100, carbsGPer100, fatGPer100 } = food;

  if (kcalPer100 > MAX_KCAL_PER_100) {
    return {
      code: 'implausible',
      detail: `${Math.round(kcalPer100)} kcal per 100 exceeds what any food contains`,
    };
  }

  for (const [name, grams] of [
    ['protein', proteinGPer100],
    ['carbohydrate', carbsGPer100],
    ['fat', fatGPer100],
  ] as const) {
    if (grams > 100) {
      return { code: 'implausible', detail: `${Math.round(grams)}g of ${name} per 100` };
    }
  }

  // Rounding and water content make an exact 100 unrealistic, so allow slack.
  const macroGrams = proteinGPer100 + carbsGPer100 + fatGPer100;
  if (macroGrams > 105) {
    return {
      code: 'implausible',
      detail: `macros total ${Math.round(macroGrams)}g per 100`,
    };
  }

  // Macros present but no energy recorded means the energy field is wrong,
  // and calories are the one number the whole app is built on.
  if (kcalPer100 === 0 && macroGrams > 5) {
    return { code: 'implausible', detail: 'macros recorded but no energy' };
  }

  return null;
}

/**
 * Map one product. Returns an error rather than throwing, so a single bad
 * record in a results page skips itself instead of failing the search.
 */
export function mapProduct(product: OffProduct): Result<MappedFood, MappingError> {
  const sourceId = text(product.code);
  if (!sourceId) return err({ code: 'no_code' });

  const name =
    text(product.product_name) ??
    text(product.product_name_en) ??
    text(product.generic_name);
  if (!name) return err({ code: 'no_name' });

  const nutriments = product.nutriments ?? {};
  const kcalPer100 = energyKcalPer100(nutriments);
  if (kcalPer100 === null) return err({ code: 'no_energy' });

  const basisUnit = detectBasisUnit(product);
  const mapped: MappedFood = {
    sourceId,
    // OFF codes are barcodes, which is what makes the Phase 3 scan a cache hit.
    barcode: /^\d{6,14}$/.test(sourceId) ? sourceId : null,
    name,
    brand: text(product.brands)?.split(',')[0]?.trim() ?? null,
    basisUnit,
    kcalPer100,
    proteinGPer100: nonNegative(nutriments.proteins_100g) ?? 0,
    carbsGPer100: nonNegative(nutriments.carbohydrates_100g) ?? 0,
    fatGPer100: nonNegative(nutriments.fat_100g) ?? 0,
    fiberGPer100: nonNegative(nutriments.fiber_100g),
    sugarGPer100: nonNegative(nutriments.sugars_100g),
    satFatGPer100: nonNegative(nutriments['saturated-fat_100g']),
    sodiumMgPer100: sodiumMgPer100(nutriments),
    portions: [],
  };

  const problem = checkPlausible(mapped);
  if (problem) return err(problem);

  const servingAmount = parseServingSize(product.serving_size, basisUnit);
  if (servingAmount !== null) {
    mapped.portions.push({
      label: text(product.serving_size) ?? '1 serving',
      amountInBasis: servingAmount,
    });
  }

  return ok(mapped);
}

export interface MapPageResult {
  foods: MappedFood[];
  /** Products that could not be mapped, by reason. Surfaced for diagnostics,
   *  never shown to the user as an error — a partial page is still useful. */
  skipped: { code: MappingError['code']; count: number }[];
}

/** Map a page of results, dropping the ones that cannot be trusted. */
export function mapProducts(products: readonly OffProduct[]): MapPageResult {
  const foods: MappedFood[] = [];
  const reasons = new Map<MappingError['code'], number>();

  for (const product of products) {
    const result = mapProduct(product);
    if (result.ok) {
      foods.push(result.value);
    } else {
      reasons.set(result.error.code, (reasons.get(result.error.code) ?? 0) + 1);
    }
  }

  return {
    foods,
    skipped: [...reasons].map(([code, count]) => ({ code, count })),
  };
}

/**
 * Whatever could be read from a product that failed validation.
 *
 * A product with a name but no calories is useless to log and is therefore
 * rejected, but the name is still worth having: it saves the user typing it
 * out when they add the food by hand. Energy is deliberately never carried
 * over — it was either missing or implausible, and a prefilled wrong number
 * is worse than an empty field.
 */
export interface PartialFood {
  barcode: string | null;
  name: string | null;
  brand: string | null;
  basisUnit: BasisUnit;
  proteinGPer100: number | null;
  carbsGPer100: number | null;
  fatGPer100: number | null;
}

/** Read a product loosely, for prefilling a form rather than for storage. */
export function extractPartial(product: OffProduct): PartialFood {
  const nutriments = product.nutriments ?? {};
  const code = text(product.code);

  const plausibleMacro = (value: unknown): number | null => {
    const grams = nonNegative(value);
    return grams !== null && grams <= 100 ? grams : null;
  };

  return {
    barcode: code && /^\d{6,14}$/.test(code) ? code : null,
    name:
      text(product.product_name) ??
      text(product.product_name_en) ??
      text(product.generic_name),
    brand: text(product.brands)?.split(',')[0]?.trim() ?? null,
    basisUnit: detectBasisUnit(product),
    proteinGPer100: plausibleMacro(nutriments.proteins_100g),
    carbsGPer100: plausibleMacro(nutriments.carbohydrates_100g),
    fatGPer100: plausibleMacro(nutriments.fat_100g),
  };
}

/** Whether a partial carries anything worth prefilling a form with. */
export function isUsefulPartial(partial: PartialFood): boolean {
  return (
    partial.name !== null ||
    partial.proteinGPer100 !== null ||
    partial.carbsGPer100 !== null ||
    partial.fatGPer100 !== null
  );
}
