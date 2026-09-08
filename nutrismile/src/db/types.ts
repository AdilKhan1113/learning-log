/**
 * Row types mirroring src/db/schema/001_init.sql.
 *
 * These describe rows exactly as SQLite returns them: no Date objects, no
 * booleans, no nested relations. Mapping to richer domain shapes happens in the
 * repositories, so the pure functions in src/domain never see a driver detail.
 */

/** Unix epoch milliseconds, UTC. */
export type Timestamp = number;

/** A calendar day in the user's local timezone, 'YYYY-MM-DD'. */
export type DateString = string;

/** SQLite has no boolean; 0 or 1. */
export type SqlBool = 0 | 1;

export type Sex = 'female' | 'male' | 'unspecified';
export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export type BasisUnit = 'g' | 'ml';
export type FoodSource =
  | 'custom'
  | 'openfoodfacts'
  | 'usda'
  | 'nutritionix'
  | 'photo_ai';
export type EntrySource =
  | 'manual'
  | 'search'
  | 'barcode'
  | 'photo_ai'
  | 'recipe'
  | 'copied'
  | 'quick_add';
export type GoalSource = 'calculated' | 'manual';
export type UnitSystem = 'metric' | 'imperial';
export type ThemePreference = 'dark' | 'light' | 'system';

/** Columns every synced table carries. */
export interface SyncColumns {
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
  server_updated_at: Timestamp | null;
  dirty: SqlBool;
}

export interface UserRow extends SyncColumns {
  id: string;
  email: string | null;
  display_name: string | null;
  birth_date: DateString | null;
  sex: Sex | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  goal_type: GoalType | null;
  /** Signed kg per week; negative means losing. */
  goal_rate_kg_week: number | null;
  unit_system: UnitSystem;
  theme: ThemePreference;
  water_unit: 'ml' | 'floz';
  water_container_ml: number;
  timezone: string | null;
  onboarded_at: Timestamp | null;
}

export interface DailyGoalRow extends SyncColumns {
  id: string;
  user_id: string;
  effective_date: DateString;
  calorie_target: number;
  protein_g_target: number;
  carbs_g_target: number;
  fat_g_target: number;
  fiber_g_target: number | null;
  water_ml_target: number;
  source: GoalSource;
  bmr_kcal: number | null;
  tdee_kcal: number | null;
  calc_weight_kg: number | null;
  calc_height_cm: number | null;
  calc_age_years: number | null;
  calc_activity_level: ActivityLevel | null;
  floor_applied: SqlBool;
}

export interface FoodRow extends SyncColumns {
  id: string;
  /** NULL for shared catalogue rows fetched from an upstream database. */
  user_id: string | null;
  name: string;
  brand: string | null;
  search_text: string;
  source: FoodSource;
  source_id: string | null;
  barcode: string | null;
  basis_unit: BasisUnit;
  kcal_per_100: number;
  protein_g_per_100: number;
  carbs_g_per_100: number;
  fat_g_per_100: number;
  fiber_g_per_100: number | null;
  sugar_g_per_100: number | null;
  sat_fat_g_per_100: number | null;
  sodium_mg_per_100: number | null;
  /** Needed before volume units can be offered; NULL hides them. */
  grams_per_ml: number | null;
  is_favorite: SqlBool;
  is_verified: SqlBool;
  last_used_at: Timestamp | null;
  use_count: number;
}

export interface FoodPortionRow extends SyncColumns {
  id: string;
  food_id: string;
  /** What the picker shows: '1 medium', 'cup', 'g'. */
  label: string;
  quantity: number;
  /** How much of the food's basis_unit one portion is. */
  amount_in_basis: number;
  is_default: SqlBool;
  sort_order: number;
}

export interface RecipeRow extends SyncColumns {
  id: string;
  user_id: string;
  name: string;
  search_text: string;
  notes: string | null;
  servings: number;
  serving_label: string | null;
  photo_uri: string | null;
  /** Cached rollup for the whole recipe; divide by servings for per-serving. */
  total_grams: number | null;
  total_kcal: number | null;
  total_protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  totals_stale: SqlBool;
  is_favorite: SqlBool;
  last_used_at: Timestamp | null;
  use_count: number;
}

export interface RecipeIngredientRow extends SyncColumns {
  id: string;
  recipe_id: string;
  food_id: string;
  portion_id: string | null;
  quantity: number;
  unit_label: string;
  amount_in_basis: number;
  sort_order: number;
}

/**
 * A logged item. Every nutrition field here is a snapshot taken at log time and
 * is never recomputed: food_id and recipe_id are provenance for "log again" and
 * "edit", not inputs to any sum.
 */
export interface LogEntryRow extends SyncColumns {
  id: string;
  user_id: string;
  log_date: DateString;
  meal: Meal;
  sort_order: number;
  logged_at: Timestamp;
  food_id: string | null;
  recipe_id: string | null;

  name_snapshot: string;
  brand_snapshot: string | null;
  quantity: number;
  unit_label: string;
  /** NULL when the unit is a recipe serving rather than a mass or volume. */
  amount_in_basis: number | null;
  basis_unit: BasisUnit | null;

  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sat_fat_g: number | null;
  sodium_mg: number | null;

  entry_source: EntrySource;
  is_estimate: SqlBool;
  ai_confidence: number | null;
  ai_photo_uri: string | null;
  notes: string | null;
}

export interface WeightEntryRow extends SyncColumns {
  id: string;
  user_id: string;
  log_date: DateString;
  weight_kg: number;
  body_fat_pct: number | null;
  note: string | null;
  recorded_at: Timestamp;
}

export interface WaterEntryRow extends SyncColumns {
  id: string;
  user_id: string;
  log_date: DateString;
  amount_ml: number;
  logged_at: Timestamp;
}

export interface SchemaMigrationRow {
  version: number;
  name: string;
  applied_at: Timestamp;
}

export interface AppMetaRow {
  key: string;
  value: string | null;
  updated_at: Timestamp;
}

export interface SyncQueueRow {
  id: number;
  table_name: string;
  row_id: string;
  op: 'upsert' | 'delete';
  queued_at: Timestamp;
  attempts: number;
  last_error: string | null;
}

/** Shape of the v_daily_meal_totals view. */
export interface DailyMealTotalsRow {
  user_id: string;
  log_date: DateString;
  meal: Meal;
  entry_count: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Shape of the v_daily_totals view. */
export type DailyTotalsRow = Omit<DailyMealTotalsRow, 'meal'>;
