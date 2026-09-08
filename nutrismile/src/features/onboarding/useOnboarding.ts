/**
 * Onboarding state and the write that ends it.
 *
 * The suggestion shown on the last step comes straight from the tested pure
 * functions, and the numbers behind it — BMR, TDEE, whether the floor bound —
 * are stored alongside the target so Profile can explain it later.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ActivityLevel, GoalType, Sex } from '../../domain/types.ts';
import { suggestTargets } from '../../domain/nutrition/goals.ts';
import { DEFAULT_RATE_KG_WEEK } from '../../domain/nutrition/goals.ts';
import { goals, users, weight } from '../../db/repositories/index.ts';
import { today } from '../../utils/dates.ts';

export interface OnboardingDraft {
  birthDate: string | null;
  sex: Sex | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel | null;
  goalType: GoalType | null;
  rateKgWeek: number | null;
}

const EMPTY: OnboardingDraft = {
  birthDate: null,
  sex: null,
  heightCm: null,
  weightKg: null,
  activityLevel: null,
  goalType: null,
  rateKgWeek: null,
};

export function useOnboarding() {
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  /** Age in whole years, from the birth date. */
  const ageYears = useMemo(() => {
    if (!draft.birthDate) return null;
    const born = new Date(draft.birthDate);
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const monthDelta = now.getMonth() - born.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age -= 1;
    return age;
  }, [draft.birthDate]);

  /** The suggested targets, or null while the draft is incomplete. */
  const suggestion = useMemo(() => {
    const { sex, heightCm, weightKg, activityLevel, goalType } = draft;
    if (!sex || !heightCm || !weightKg || !activityLevel || !goalType || ageYears === null) {
      return null;
    }
    return suggestTargets(
      { sex, ageYears, heightCm, weightKg, activityLevel },
      goalType,
      draft.rateKgWeek ?? DEFAULT_RATE_KG_WEEK[goalType],
    );
  }, [draft, ageYears]);

  /**
   * Write the profile, the starting weight and the first goal.
   * Returns the new user id, or null if something was missing.
   */
  const complete = useCallback(async (): Promise<string | null> => {
    if (!suggestion || ageYears === null) return null;
    setSaving(true);
    setError(null);

    try {
      const existing = await users.current();
      const profile = existing ?? (await users.create());

      await users.update(profile.id, {
        birthDate: draft.birthDate,
        sex: draft.sex,
        heightCm: draft.heightCm,
        activityLevel: draft.activityLevel,
        goalType: draft.goalType,
        goalRateKgWeek: suggestion.rateKgWeek,
        onboardedAt: Date.now(),
      });

      if (draft.weightKg) {
        await weight.record(profile.id, draft.weightKg, today());
      }

      await goals.set({
        userId: profile.id,
        calorieTarget: suggestion.calorieTarget,
        proteinGTarget: suggestion.proteinGTarget,
        carbsGTarget: suggestion.carbsGTarget,
        fatGTarget: suggestion.fatGTarget,
        source: 'calculated',
        bmrKcal: suggestion.bmr,
        tdeeKcal: suggestion.tdee,
        calcWeightKg: draft.weightKg,
        calcHeightCm: draft.heightCm,
        calcAgeYears: ageYears,
        calcActivityLevel: draft.activityLevel,
        floorApplied: suggestion.floorApplied,
      });

      return profile.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your details.');
      return null;
    } finally {
      setSaving(false);
    }
  }, [draft, suggestion, ageYears]);

  return { draft, update, ageYears, suggestion, complete, saving, error };
}
