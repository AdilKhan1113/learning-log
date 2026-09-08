/**
 * USDA FoodData Central response shapes, for branded foods.
 *
 * As with Open Food Facts, everything is optional: this is external data and
 * normalize.ts validates before any of it reaches the database.
 */

/** Nutrient ids used by FoodData Central. Stable, and the only reliable key —
 *  nutrient *names* vary between datasets. */
export const NUTRIENT_IDS = {
  energyKcal: 1008,
  protein: 1003,
  carbs: 1005,
  fat: 1004,
  fiber: 1079,
  sugars: 2000,
  satFat: 1258,
  sodiumMg: 1093,
} as const;

export interface UsdaFoodNutrient {
  nutrientId?: number;
  nutrientName?: string;
  unitName?: string;
  /** Per 100 g/ml for branded foods. */
  value?: number;
}

export interface UsdaFood {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaFoodNutrient[];
}

export interface UsdaSearchResponse {
  foods?: UsdaFood[];
}
