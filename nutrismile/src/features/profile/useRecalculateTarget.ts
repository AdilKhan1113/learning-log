/**
 * Recalculating the daily target from the profile as it now stands.
 *
 * The new numbers are shown before anything is written. A target is the number
 * the whole app is measured against, so it should not change under someone
 * without their seeing what it changed to.
 *
 * Applying writes a goal dated today. Goals are effective-dated, so past days
 * keep the target they were actually measured against.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  type MacroSplit,
  type CalorieTarget,
  completeMetrics,
  missingMetrics,
  suggestTargets,
} from '../../domain/nutrition/goals.ts';
import { ageInYears } from '../../domain/nutrition/energy.ts';
import { goals, weight } from '../../db/repositories/index.ts';
import type { Profile } from '../../db/repositories/users.ts';
import { today } from '../../utils/dates.ts';

export type Suggestion = CalorieTarget & MacroSplit;

export interface RecalculateState {
  /** Inputs still needed, in the user's words. Empty when ready. */
  missing: string[];
  /** The latest recorded weight, once loaded. */
  weightKg: number | null;
  loading: boolean;
  /** The proposed target, awaiting confirmation. */
  preview: Suggestion | null;
  saving: boolean;
  error: string | null;
  compute: () => void;
  apply: () => Promise<boolean>;
  cancel: () => void;
}

export function useRecalculateTarget(profile: Profile | null): RecalculateState {
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Suggestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The weight lives in its own table rather than on the profile, so it has to
  // be read before the profile is complete enough to calculate from.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!profile) {
        setLoading(false);
        return;
      }
      try {
        const latest = await weight.latest(profile.id);
        if (!cancelled) setWeightKg(latest?.weightKg ?? null);
      } catch {
        if (!cancelled) setWeightKg(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const ageYears = profile?.birthDate ? ageInYears(profile.birthDate, new Date()) : null;

  const metrics = {
    sex: profile?.sex ?? null,
    ageYears,
    heightCm: profile?.heightCm ?? null,
    weightKg,
    activityLevel: profile?.activityLevel ?? null,
    goalType: profile?.goalType ?? null,
  };

  const missing = missingMetrics(metrics);

  const compute = useCallback(() => {
    const complete = completeMetrics(metrics);
    if (!complete || !profile?.goalType) return;

    setError(null);
    setPreview(
      suggestTargets(
        complete,
        profile.goalType,
        profile.goalRateKgWeek ?? undefined,
      ),
    );
    // metrics is derived from profile and weightKg, so those are the real
    // dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, weightKg, ageYears]);

  const apply = useCallback(async () => {
    if (!profile || !preview) return false;
    setSaving(true);
    setError(null);

    try {
      await goals.set({
        userId: profile.id,
        effectiveDate: today(),
        calorieTarget: preview.calorieTarget,
        proteinGTarget: preview.proteinGTarget,
        carbsGTarget: preview.carbsGTarget,
        fatGTarget: preview.fatGTarget,
        source: 'calculated',
        bmrKcal: preview.bmr,
        tdeeKcal: preview.tdee,
        calcWeightKg: weightKg,
        calcHeightCm: profile.heightCm,
        calcAgeYears: ageYears,
        calcActivityLevel: profile.activityLevel,
        floorApplied: preview.floorApplied,
      });
      setPreview(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the new target.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile, preview, weightKg, ageYears]);

  const cancel = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return { missing, weightKg, loading, preview, saving, error, compute, apply, cancel };
}
