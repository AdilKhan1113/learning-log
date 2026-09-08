/**
 * Basal metabolic rate and total daily energy expenditure.
 */
import type { ActivityLevel, BodyMetrics, Sex } from '../types.ts';

/**
 * Sex-specific constant in the Mifflin-St Jeor equation.
 *
 * The equation was validated on male and female cohorts only. For a user who
 * declines to state, the midpoint of the two constants is used: it keeps the
 * estimate within roughly 80 kcal of either, which is well inside the ±10%
 * the equation is accurate to anyway, and it avoids making the app demand an
 * answer to a question the user chose not to give.
 */
const SEX_CONSTANT: Record<Sex, number> = {
  male: 5,
  female: -161,
  unspecified: -78,
};

/**
 * Mifflin-St Jeor resting metabolic rate, in kcal/day.
 *
 *   BMR = 10·weight(kg) + 6.25·height(cm) − 5·age(years) + sexConstant
 */
export function calculateBmr(metrics: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const { sex, weightKg, heightCm, ageYears } = metrics;
  return (
    10 * weightKg + 6.25 * heightCm - 5 * ageYears + SEX_CONSTANT[sex]
  );
}

/**
 * Activity multipliers, the conventional Harris-Benedict set.
 * Descriptions are what the onboarding screen shows, so a user picks by
 * behaviour rather than by guessing what "moderate" means.
 */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_DESCRIPTIONS: Record<ActivityLevel, string> = {
  sedentary: 'Desk work, little exercise',
  light: 'Light exercise 1–3 days a week',
  moderate: 'Moderate exercise 3–5 days a week',
  active: 'Hard exercise 6–7 days a week',
  very_active: 'Physical job or twice-daily training',
};

/** Total daily energy expenditure: BMR scaled by activity. */
export function calculateTdee(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activityLevel];
}

/** Convenience: metrics straight through to TDEE. */
export function tdeeFromMetrics(metrics: BodyMetrics): number {
  return calculateTdee(calculateBmr(metrics), metrics.activityLevel);
}

/** Whole years elapsed, used to derive age from a stored birth date. */
export function ageInYears(birthDate: string, on: Date): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = on.getFullYear() - y;
  const monthDelta = on.getMonth() + 1 - m;
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < d)) age -= 1;
  return age;
}
