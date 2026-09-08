/**
 * Open Food Facts response shapes.
 *
 * Everything here is optional and typed as `unknown`-adjacent on purpose: the
 * payload is external, crowd-sourced, and frequently incomplete. Nothing in
 * this file is trusted — normalize.ts validates before anything reaches the
 * database.
 */

/** Nutriment keys OFF exposes per 100 g/ml. Values are numbers or absent. */
export interface OffNutriments {
  'energy-kcal_100g'?: number;
  'energy-kj_100g'?: number;
  energy_100g?: number;
  energy_unit?: string;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sugars_100g?: number;
  'saturated-fat_100g'?: number;
  /** Grams, not milligrams. */
  sodium_100g?: number;
  /** Grams. Used to derive sodium when sodium itself is missing. */
  salt_100g?: number;
}

export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  /** Free text: '30 g', '1 cup (240 ml)', '2 biscuits (25 g)'. */
  serving_size?: string;
  /** Package size: '500 g', '1 l'. Used to tell drinks from solids. */
  quantity?: string;
  nutriments?: OffNutriments;
}

export interface OffSearchResponse {
  products?: OffProduct[];
  count?: number;
}

/** Fields requested from the API. Keeping this tight matters on mobile data. */
export const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'brands',
  'serving_size',
  'quantity',
  'nutriments',
].join(',');
