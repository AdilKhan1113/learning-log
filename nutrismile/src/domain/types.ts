/**
 * Domain shapes. Deliberately separate from the database row types in
 * src/db/types.ts: these are camelCase, use real booleans, and carry only what
 * the calculations need. Repositories map between the two.
 */

export type Sex = 'female' | 'male' | 'unspecified';

export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';

export type GoalType = 'lose' | 'maintain' | 'gain';

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

/** The unit a food's nutrition is expressed against. */
export type BasisUnit = 'g' | 'ml';

/**
 * A set of nutrition values. The four the app targets are always present;
 * the rest are optional because most upstream databases omit them.
 */
export interface Nutrition {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number | undefined;
  sugarG?: number | undefined;
  satFatG?: number | undefined;
  sodiumMg?: number | undefined;
}

/** Nutrition per 100 g or per 100 ml, as stored on a food. */
export interface NutritionPer100 extends Nutrition {
  basisUnit: BasisUnit;
}

/** A named serving: '1 medium', 'cup', 'slice'. */
export interface Portion {
  id: string;
  label: string;
  /** How much of the food's basis unit one of this portion is. */
  amountInBasis: number;
  isDefault: boolean;
}

/** The subset of a food the nutrition math needs. */
export interface FoodLike {
  id: string;
  name: string;
  brand?: string | null;
  per100: NutritionPer100;
  /**
   * Grams in one millilitre. Required to convert between mass and volume
   * units; when absent, volume units are not offered rather than guessed.
   */
  gramsPerMl?: number | null;
  portions?: readonly Portion[];
}

/** The four targets a day is measured against. */
export interface MacroTargets {
  calorieTarget: number;
  proteinGTarget: number;
  carbsGTarget: number;
  fatGTarget: number;
}

/** Everything onboarding collects, in metric. */
export interface BodyMetrics {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
}
