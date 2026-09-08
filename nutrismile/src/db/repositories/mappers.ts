/**
 * Translating between database rows and domain shapes.
 *
 * Kept in one file so the snake_case/camelCase and 0/1-to-boolean boundary is
 * visible in a single place rather than spread across every repository.
 */
import type {
  FoodPortionRow,
  FoodRow,
  LogEntryRow,
  SqlBool,
} from '../types.ts';
import type { FoodLike, Nutrition, Portion } from '../../domain/types.ts';

export const bool = (value: SqlBool): boolean => value === 1;
export const sqlBool = (value: boolean): SqlBool => (value ? 1 : 0);

/** Undefined for the domain, null for SQLite. */
export const toNull = <T>(value: T | undefined): T | null =>
  value === undefined ? null : value;

export const toUndefined = <T>(value: T | null): T | undefined =>
  value === null ? undefined : value;

export function toFoodLike(row: FoodRow, portions: FoodPortionRow[] = []): FoodLike {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    per100: {
      basisUnit: row.basis_unit,
      kcal: row.kcal_per_100,
      proteinG: row.protein_g_per_100,
      carbsG: row.carbs_g_per_100,
      fatG: row.fat_g_per_100,
      fiberG: toUndefined(row.fiber_g_per_100),
      sugarG: toUndefined(row.sugar_g_per_100),
      satFatG: toUndefined(row.sat_fat_g_per_100),
      sodiumMg: toUndefined(row.sodium_mg_per_100),
    },
    gramsPerMl: row.grams_per_ml,
    portions: portions.map(toPortion),
  };
}

export function toPortion(row: FoodPortionRow): Portion {
  return {
    id: row.id,
    label: row.label,
    amountInBasis: row.amount_in_basis,
    isDefault: bool(row.is_default),
  };
}

/** The nutrition a log entry recorded at the time it was logged. */
export function toNutrition(row: LogEntryRow): Nutrition {
  return {
    kcal: row.kcal,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: toUndefined(row.fiber_g),
    sugarG: toUndefined(row.sugar_g),
    satFatG: toUndefined(row.sat_fat_g),
    sodiumMg: toUndefined(row.sodium_mg),
  };
}
