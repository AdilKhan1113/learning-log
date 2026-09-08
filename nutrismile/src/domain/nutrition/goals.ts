/**
 * Turning body metrics and a goal into a daily calorie target and macro split.
 */
import type { GoalType, MacroTargets, Sex } from '../types.ts';
import { type ActivityLevel, type BodyMetrics } from '../types.ts';
import { calculateBmr, calculateTdee } from './energy.ts';

/**
 * Energy in one kilogram of body mass, kcal. The conventional 7700 figure
 * (≈3500 kcal per pound). It is an approximation — real rates vary with
 * body composition — so it is used to set a starting target, not a promise.
 */
export const KCAL_PER_KG = 7700;

/** The fastest weekly change the app will suggest, in either direction. */
export const MAX_RATE_KG_WEEK = 1;

/** Default weekly rate for each goal, kg/week, signed. */
export const DEFAULT_RATE_KG_WEEK: Record<GoalType, number> = {
  lose: -0.5,
  maintain: 0,
  gain: 0.25,
};

/**
 * Absolute calorie floors by sex. Widely used clinical guidance for
 * unsupervised dieting; 'unspecified' takes the lower of the two so the app
 * never assumes a higher floor than the user's body may warrant — the
 * proportional floor below still protects larger bodies.
 */
const ABSOLUTE_FLOOR: Record<Sex, number> = {
  female: 1200,
  male: 1500,
  unspecified: 1200,
};

/**
 * A target is additionally never set below this share of BMR, so the floor
 * scales with the person rather than being one number for everyone.
 */
export const BMR_FLOOR_RATIO = 0.85;

export interface CalorieFloor {
  /** The binding floor: the higher of the two rules below. */
  floor: number;
  absoluteFloor: number;
  bmrFloor: number;
  /** Which rule actually bound, for the explanation shown in Profile. */
  boundBy: 'absolute' | 'bmr';
}

/** The lowest daily target the app will set for this person. */
export function calorieFloor(sex: Sex, bmr: number): CalorieFloor {
  const absoluteFloor = ABSOLUTE_FLOOR[sex];
  const bmrFloor = bmr * BMR_FLOOR_RATIO;
  return {
    floor: Math.max(absoluteFloor, bmrFloor),
    absoluteFloor,
    bmrFloor,
    boundBy: bmrFloor > absoluteFloor ? 'bmr' : 'absolute',
  };
}

export interface CalorieTarget {
  /** The number the dashboard counts against, rounded to the nearest 10. */
  calorieTarget: number;
  bmr: number;
  tdee: number;
  /** Daily surplus or deficit implied by the requested rate, before flooring. */
  requestedDailyDelta: number;
  /** What the rate works out to once the floor is applied. */
  effectiveDailyDelta: number;
  /** True when the floor raised the target above what the rate asked for. */
  floorApplied: boolean;
  floor: CalorieFloor;
  /** The rate actually used, after clamping to MAX_RATE_KG_WEEK. */
  rateKgWeek: number;
}

/**
 * Calculate a daily calorie target.
 *
 * TDEE plus the daily delta the requested rate implies, then raised to the
 * floor if it fell below it. When the floor binds, the achievable rate is
 * recomputed and reported so the UI can state the real expectation rather
 * than the one that was asked for.
 */
export function calculateCalorieTarget(
  metrics: BodyMetrics,
  goalType: GoalType,
  rateKgWeek: number = DEFAULT_RATE_KG_WEEK[goalType],
): CalorieTarget {
  const bmr = calculateBmr(metrics);
  const tdee = calculateTdee(bmr, metrics.activityLevel);

  const clampedRate = clamp(
    goalType === 'maintain' ? 0 : rateKgWeek,
    -MAX_RATE_KG_WEEK,
    MAX_RATE_KG_WEEK,
  );

  const requestedDailyDelta = (clampedRate * KCAL_PER_KG) / 7;
  const raw = tdee + requestedDailyDelta;

  const floor = calorieFloor(metrics.sex, bmr);
  const floorApplied = raw < floor.floor;
  const flooredTarget = floorApplied ? floor.floor : raw;

  // Round to the nearest 10 for a target that reads as a decision rather than
  // a calculation, then make sure rounding did not drop back under the floor.
  let calorieTarget = Math.round(flooredTarget / 10) * 10;
  if (calorieTarget < floor.floor) {
    calorieTarget = Math.ceil(floor.floor / 10) * 10;
  }

  const effectiveDailyDelta = calorieTarget - tdee;

  return {
    calorieTarget,
    bmr,
    tdee,
    requestedDailyDelta,
    effectiveDailyDelta,
    floorApplied,
    floor,
    rateKgWeek: clampedRate,
  };
}

/** The weekly change a given daily delta implies, kg/week. */
export function rateFromDailyDelta(dailyDelta: number): number {
  return (dailyDelta * 7) / KCAL_PER_KG;
}

// --- macro split -------------------------------------------------------------

/**
 * Protein per kg of body weight. Higher in a deficit, where the goal is to
 * keep lean mass while losing fat, and while gaining, where it is being built.
 */
const PROTEIN_G_PER_KG: Record<GoalType, number> = {
  lose: 1.8,
  maintain: 1.6,
  gain: 1.8,
};

/** Fat is never set below this, to cover essential fatty acids. */
const MIN_FAT_G_PER_KG = 0.6;

/**
 * Protein never takes more than this share of the day's calories.
 *
 * The g/kg figures above are anchored to total body weight, and at higher
 * weights that overshoots: adipose tissue does not need feeding with protein
 * the way lean mass does. Without a ceiling, a heavier person on a deficit ends
 * up with protein crowding out most of their carbohydrate.
 *
 * The clinically tidier fix is to anchor to goal or lean body weight, but that
 * needs a number onboarding does not ask for. A ceiling gets most of the
 * benefit for none of the extra questions: it leaves the g/kg rule untouched
 * for the great majority and only binds at the extremes.
 */
const MAX_PROTEIN_SHARE_OF_CALORIES = 0.35;

/** Otherwise fat takes this share of calories, with carbs taking the rest. */
const FAT_SHARE_OF_CALORIES = 0.25;

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export interface MacroSplit extends MacroTargets {
  /** True when the target was too small to fit protein and fat as calculated,
   *  so both were scaled down proportionally and carbs set to zero. */
  compressed: boolean;
  /** True when the share ceiling reduced protein below its g/kg figure. */
  proteinCapped: boolean;
}

/**
 * Split a calorie target into grams of protein, carbs and fat.
 *
 * Protein and fat are anchored to body weight first because both have floors
 * that matter physiologically; carbohydrate takes whatever calories remain.
 * Protein is then held to a share of the day's calories, so the g/kg rule
 * cannot crowd out carbohydrate at higher body weights.
 *
 * At very low targets the two anchors can still exceed the target outright, in
 * which case they are scaled proportionally rather than allowed to overshoot.
 */
export function calculateMacroSplit(
  calorieTarget: number,
  weightKg: number,
  goalType: GoalType,
): MacroSplit {
  const proteinFromWeight = PROTEIN_G_PER_KG[goalType] * weightKg;
  const proteinCeiling =
    (MAX_PROTEIN_SHARE_OF_CALORIES * calorieTarget) / KCAL_PER_G.protein;

  const proteinCapped = proteinFromWeight > proteinCeiling;
  let proteinG = Math.min(proteinFromWeight, proteinCeiling);

  let fatG = Math.max(
    MIN_FAT_G_PER_KG * weightKg,
    (FAT_SHARE_OF_CALORIES * calorieTarget) / KCAL_PER_G.fat,
  );

  const anchorKcal = proteinG * KCAL_PER_G.protein + fatG * KCAL_PER_G.fat;
  let compressed = false;

  if (anchorKcal > calorieTarget) {
    const scale = calorieTarget / anchorKcal;
    proteinG *= scale;
    fatG *= scale;
    compressed = true;
  }

  const remainingKcal =
    calorieTarget - (proteinG * KCAL_PER_G.protein + fatG * KCAL_PER_G.fat);
  const carbsG = Math.max(0, remainingKcal / KCAL_PER_G.carbs);

  return {
    calorieTarget,
    proteinGTarget: round1(proteinG),
    carbsGTarget: round1(carbsG),
    fatGTarget: round1(fatG),
    compressed,
    proteinCapped,
  };
}

/** Full suggestion: metrics and goal straight through to targets. */
export function suggestTargets(
  metrics: BodyMetrics,
  goalType: GoalType,
  rateKgWeek?: number,
): CalorieTarget & MacroSplit {
  const target = calculateCalorieTarget(metrics, goalType, rateKgWeek);
  const split = calculateMacroSplit(
    target.calorieTarget,
    metrics.weightKg,
    goalType,
  );
  return { ...target, ...split };
}

// --- manual override ---------------------------------------------------------

export interface MacroPercentages {
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
}

/** What share of the target's calories each macro accounts for. */
export function macroPercentages(targets: MacroTargets): MacroPercentages {
  const { calorieTarget: kcal } = targets;
  if (kcal <= 0) return { proteinPct: 0, carbsPct: 0, fatPct: 0 };
  return {
    proteinPct: (targets.proteinGTarget * KCAL_PER_G.protein * 100) / kcal,
    carbsPct: (targets.carbsGTarget * KCAL_PER_G.carbs * 100) / kcal,
    fatPct: (targets.fatGTarget * KCAL_PER_G.fat * 100) / kcal,
  };
}

/**
 * Build targets from percentages the user set by hand. Percentages are
 * normalised so the grams always add up to the calorie target exactly, which
 * keeps the dashboard's bars honest even if the sliders are a point off.
 */
export function targetsFromPercentages(
  calorieTarget: number,
  pct: MacroPercentages,
): MacroTargets {
  const total = pct.proteinPct + pct.carbsPct + pct.fatPct;
  const norm = total > 0 ? 100 / total : 0;
  return {
    calorieTarget,
    proteinGTarget: round1(
      (calorieTarget * pct.proteinPct * norm) / 100 / KCAL_PER_G.protein,
    ),
    carbsGTarget: round1(
      (calorieTarget * pct.carbsPct * norm) / 100 / KCAL_PER_G.carbs,
    ),
    fatGTarget: round1(
      (calorieTarget * pct.fatPct * norm) / 100 / KCAL_PER_G.fat,
    ),
  };
}

export type TargetValidation =
  | { valid: true; warnings: readonly string[] }
  | { valid: false; reason: string; warnings: readonly string[] };

/**
 * Check a manually entered target.
 *
 * Below the floor is refused, because the app should not hand someone a number
 * it believes is unsafe. Everything else is a neutral note, not a refusal:
 * the user is allowed to overrule the suggestion.
 */
export function validateManualTarget(
  targets: MacroTargets,
  sex: Sex,
  bmr: number,
): TargetValidation {
  const warnings: string[] = [];
  const { floor, boundBy } = calorieFloor(sex, bmr);

  if (!Number.isFinite(targets.calorieTarget) || targets.calorieTarget <= 0) {
    return { valid: false, reason: 'Enter a calorie target above zero.', warnings };
  }

  if (targets.calorieTarget < floor) {
    const because =
      boundBy === 'bmr'
        ? `85% of your estimated BMR (${Math.round(bmr)} kcal)`
        : 'the minimum this app will set';
    return {
      valid: false,
      reason: `The lowest target available is ${Math.round(floor)} kcal, which is ${because}.`,
      warnings,
    };
  }

  const macroKcal =
    targets.proteinGTarget * KCAL_PER_G.protein +
    targets.carbsGTarget * KCAL_PER_G.carbs +
    targets.fatGTarget * KCAL_PER_G.fat;

  // A 2% tolerance absorbs rounding to whole grams without hiding a real gap.
  if (Math.abs(macroKcal - targets.calorieTarget) > targets.calorieTarget * 0.02) {
    warnings.push(
      `Macros add up to ${Math.round(macroKcal)} kcal, not ${Math.round(targets.calorieTarget)}.`,
    );
  }

  return { valid: true, warnings };
}

// --- helpers -----------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// --- recalculating from a profile ---------------------------------------------

/** Metrics as a profile holds them: any of them may not have been given yet. */
export interface PartialMetrics {
  sex: Sex | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel | null;
  goalType: GoalType | null;
}

/**
 * What is missing before a target can be calculated, in the user's words.
 *
 * Returned as labels rather than field names so the screen can say "add a
 * recent weight" instead of disabling a button with no explanation.
 */
export function missingMetrics(input: PartialMetrics): string[] {
  const missing: string[] = [];
  if (!input.sex) missing.push('sex');
  if (input.ageYears === null || !Number.isFinite(input.ageYears) || input.ageYears <= 0) {
    missing.push('year of birth');
  }
  if (!input.heightCm || input.heightCm <= 0) missing.push('height');
  if (!input.weightKg || input.weightKg <= 0) missing.push('a recent weight');
  if (!input.activityLevel) missing.push('activity level');
  if (!input.goalType) missing.push('goal');
  return missing;
}

/** The metrics as a complete set, or null when something is still missing. */
export function completeMetrics(input: PartialMetrics): BodyMetrics | null {
  if (missingMetrics(input).length > 0) return null;
  return {
    sex: input.sex!,
    ageYears: input.ageYears!,
    heightCm: input.heightCm!,
    weightKg: input.weightKg!,
    activityLevel: input.activityLevel!,
  };
}

/** Join labels the way a sentence would: "height, weight and goal". */
export function listMissing(missing: readonly string[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) return missing[0]!;
  return `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
}
