/**
 * Daily goals: effective-dated calorie and macro targets.
 *
 * Targets are never updated in place. Changing a goal inserts a row dated
 * today, and the target in force for any day is the newest row on or before
 * it — so a change today cannot restate what last month showed.
 */
import { getDatabase } from '../client.ts';
import type { ActivityLevel, DailyGoalRow } from '../types.ts';
import type { MacroTargets } from '../../domain/types.ts';
import { type DateString, today } from '../../utils/dates.ts';
import { newId } from '../../utils/ids.ts';
import { enqueue } from './sync.ts';

export interface DailyGoal extends MacroTargets {
  id: string;
  effectiveDate: DateString;
  waterMlTarget: number;
  source: 'calculated' | 'manual';
  bmrKcal: number | null;
  tdeeKcal: number | null;
  floorApplied: boolean;
}

function toDailyGoal(row: DailyGoalRow): DailyGoal {
  return {
    id: row.id,
    effectiveDate: row.effective_date,
    calorieTarget: row.calorie_target,
    proteinGTarget: row.protein_g_target,
    carbsGTarget: row.carbs_g_target,
    fatGTarget: row.fat_g_target,
    waterMlTarget: row.water_ml_target,
    source: row.source,
    bmrKcal: row.bmr_kcal,
    tdeeKcal: row.tdee_kcal,
    floorApplied: row.floor_applied === 1,
  };
}

/** The target in force on a given day. */
export async function forDate(
  userId: string,
  date: DateString = today(),
): Promise<DailyGoal | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DailyGoalRow>(
    `SELECT * FROM daily_goals
     WHERE user_id = ? AND effective_date <= ? AND deleted_at IS NULL
     ORDER BY effective_date DESC LIMIT 1`,
    userId,
    date,
  );
  return row ? toDailyGoal(row) : null;
}

export interface SetGoalInput extends MacroTargets {
  userId: string;
  effectiveDate?: DateString;
  waterMlTarget?: number;
  source?: 'calculated' | 'manual';
  bmrKcal?: number | null;
  tdeeKcal?: number | null;
  calcWeightKg?: number | null;
  calcHeightCm?: number | null;
  calcAgeYears?: number | null;
  calcActivityLevel?: ActivityLevel | null;
  floorApplied?: boolean;
}

/**
 * Set the target from a given date. Setting it twice on the same day replaces
 * that day's row rather than stacking, which keeps one row per change.
 */
export async function set(input: SetGoalInput): Promise<string> {
  const db = await getDatabase();
  const effectiveDate = input.effectiveDate ?? today();
  const now = Date.now();

  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM daily_goals WHERE user_id = ? AND effective_date = ?`,
    input.userId,
    effectiveDate,
  );
  const id = existing?.id ?? newId();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO daily_goals (
         id, user_id, effective_date, calorie_target, protein_g_target,
         carbs_g_target, fat_g_target, water_ml_target, source,
         bmr_kcal, tdee_kcal, calc_weight_kg, calc_height_cm, calc_age_years,
         calc_activity_level, floor_applied, created_at, updated_at, dirty
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(user_id, effective_date) DO UPDATE SET
         calorie_target = excluded.calorie_target,
         protein_g_target = excluded.protein_g_target,
         carbs_g_target = excluded.carbs_g_target,
         fat_g_target = excluded.fat_g_target,
         water_ml_target = excluded.water_ml_target,
         source = excluded.source,
         bmr_kcal = excluded.bmr_kcal,
         tdee_kcal = excluded.tdee_kcal,
         calc_weight_kg = excluded.calc_weight_kg,
         calc_height_cm = excluded.calc_height_cm,
         calc_age_years = excluded.calc_age_years,
         calc_activity_level = excluded.calc_activity_level,
         floor_applied = excluded.floor_applied,
         deleted_at = NULL,
         updated_at = excluded.updated_at,
         dirty = 1`,
      id,
      input.userId,
      effectiveDate,
      input.calorieTarget,
      input.proteinGTarget,
      input.carbsGTarget,
      input.fatGTarget,
      input.waterMlTarget ?? 2000,
      input.source ?? 'calculated',
      input.bmrKcal ?? null,
      input.tdeeKcal ?? null,
      input.calcWeightKg ?? null,
      input.calcHeightCm ?? null,
      input.calcAgeYears ?? null,
      input.calcActivityLevel ?? null,
      input.floorApplied ? 1 : 0,
      now,
      now,
    );
    await enqueue(db, 'daily_goals', id, 'upsert');
  });

  return id;
}
