/**
 * Log entries: what the user ate.
 *
 * Writes always store a full nutrition snapshot. Reads never join foods into
 * the arithmetic — a day's totals come from log_entries alone, which is what
 * makes past days stable when a food is later corrected or deleted.
 */
import type { Database } from '../client.ts';
import { getDatabase } from '../client.ts';
import type { EntrySource, LogEntryRow, Meal } from '../types.ts';
import type { Nutrition } from '../../domain/types.ts';
import { roundNutrition } from '../../domain/nutrition/serving.ts';
import type { DateString } from '../../utils/dates.ts';
import { newId } from '../../utils/ids.ts';
import { enqueue } from './sync.ts';
import { toNull, toNutrition } from './mappers.ts';

export interface LogEntry {
  id: string;
  logDate: DateString;
  meal: Meal;
  loggedAt: number;
  sortOrder: number;
  name: string;
  brand: string | null;
  quantity: number;
  unitLabel: string;
  nutrition: Nutrition;
  foodId: string | null;
  recipeId: string | null;
  entrySource: EntrySource;
  isEstimate: boolean;
  aiConfidence: number | null;
}

export interface CreateLogEntryInput {
  userId: string;
  logDate: DateString;
  meal: Meal;
  name: string;
  brand?: string | null;
  quantity: number;
  unitLabel: string;
  nutrition: Nutrition;
  amountInBasis?: number | null;
  basisUnit?: 'g' | 'ml' | null;
  foodId?: string | null;
  recipeId?: string | null;
  entrySource?: EntrySource;
  isEstimate?: boolean;
  aiConfidence?: number | null;
  notes?: string | null;
}

function toLogEntry(row: LogEntryRow): LogEntry {
  return {
    id: row.id,
    logDate: row.log_date,
    meal: row.meal,
    loggedAt: row.logged_at,
    sortOrder: row.sort_order,
    name: row.name_snapshot,
    brand: row.brand_snapshot,
    quantity: row.quantity,
    unitLabel: row.unit_label,
    nutrition: toNutrition(row),
    foodId: row.food_id,
    recipeId: row.recipe_id,
    entrySource: row.entry_source,
    isEstimate: row.is_estimate === 1,
    aiConfidence: row.ai_confidence,
  };
}

/** Next position within a meal, so new entries append rather than interleave. */
async function nextSortOrder(
  db: Database,
  userId: string,
  logDate: DateString,
  meal: Meal,
): Promise<number> {
  const row = await db.getFirstAsync<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM log_entries
     WHERE user_id = ? AND log_date = ? AND meal = ? AND deleted_at IS NULL`,
    userId,
    logDate,
    meal,
  );
  return row?.next ?? 0;
}

/**
 * Log a food. The snapshot, the food's usage counters and the sync record are
 * written in one transaction: either the entry exists and is queued for push,
 * or nothing happened.
 */
export async function create(input: CreateLogEntryInput): Promise<LogEntry> {
  const db = await getDatabase();
  const id = newId();
  const now = Date.now();
  const nutrition = roundNutrition(input.nutrition);

  await db.withTransactionAsync(async () => {
    const sortOrder = await nextSortOrder(db, input.userId, input.logDate, input.meal);

    await db.runAsync(
      `INSERT INTO log_entries (
         id, user_id, log_date, meal, sort_order, logged_at,
         food_id, recipe_id,
         name_snapshot, brand_snapshot, quantity, unit_label,
         amount_in_basis, basis_unit,
         kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
         entry_source, is_estimate, ai_confidence, notes,
         created_at, updated_at, dirty
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id,
      input.userId,
      input.logDate,
      input.meal,
      sortOrder,
      now,
      input.foodId ?? null,
      input.recipeId ?? null,
      input.name,
      input.brand ?? null,
      input.quantity,
      input.unitLabel,
      input.amountInBasis ?? null,
      input.basisUnit ?? null,
      nutrition.kcal,
      nutrition.proteinG,
      nutrition.carbsG,
      nutrition.fatG,
      toNull(nutrition.fiberG),
      toNull(nutrition.sugarG),
      toNull(nutrition.satFatG),
      toNull(nutrition.sodiumMg),
      input.entrySource ?? 'manual',
      input.isEstimate ? 1 : 0,
      input.aiConfidence ?? null,
      input.notes ?? null,
      now,
      now,
    );

    // Recency and frequency drive the search boosts and the Recent list.
    if (input.foodId) {
      await db.runAsync(
        `UPDATE foods SET last_used_at = ?, use_count = use_count + 1,
           updated_at = ?, dirty = 1 WHERE id = ?`,
        now,
        now,
        input.foodId,
      );
    }
    if (input.recipeId) {
      await db.runAsync(
        `UPDATE recipes SET last_used_at = ?, use_count = use_count + 1,
           updated_at = ?, dirty = 1 WHERE id = ?`,
        now,
        now,
        input.recipeId,
      );
    }

    await enqueue(db, 'log_entries', id, 'upsert');
  });

  const row = await db.getFirstAsync<LogEntryRow>(
    'SELECT * FROM log_entries WHERE id = ?',
    id,
  );
  return toLogEntry(row!);
}

/** Every entry for a day, ordered as the dashboard shows them. */
export async function listByDay(
  userId: string,
  logDate: DateString,
): Promise<LogEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LogEntryRow>(
    `SELECT * FROM log_entries
     WHERE user_id = ? AND log_date = ? AND deleted_at IS NULL
     ORDER BY CASE meal
        WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1
        WHEN 'dinner' THEN 2 ELSE 3 END,
      sort_order, logged_at`,
    userId,
    logDate,
  );
  return rows.map(toLogEntry);
}

/**
 * Change a serving. The new nutrition is passed in already calculated — the
 * repository stores what it is given and never recomputes from a food, so an
 * edit cannot silently pick up a food's changed values.
 */
export async function updateServing(
  id: string,
  quantity: number,
  unitLabel: string,
  nutrition: Nutrition,
  amountInBasis?: number | null,
): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  const rounded = roundNutrition(nutrition);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE log_entries SET
         quantity = ?, unit_label = ?, amount_in_basis = ?,
         kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
         fiber_g = ?, sugar_g = ?, sat_fat_g = ?, sodium_mg = ?,
         updated_at = ?, dirty = 1
       WHERE id = ?`,
      quantity,
      unitLabel,
      amountInBasis ?? null,
      rounded.kcal,
      rounded.proteinG,
      rounded.carbsG,
      rounded.fatG,
      toNull(rounded.fiberG),
      toNull(rounded.sugarG),
      toNull(rounded.satFatG),
      toNull(rounded.sodiumMg),
      now,
      id,
    );
    await enqueue(db, 'log_entries', id, 'upsert');
  });
}

export async function move(id: string, meal: Meal): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE log_entries SET meal = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      meal,
      now,
      id,
    );
    await enqueue(db, 'log_entries', id, 'upsert');
  });
}

/** Soft delete, so the removal can be replicated to the user's other devices. */
export async function remove(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE log_entries SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      now,
      now,
      id,
    );
    await enqueue(db, 'log_entries', id, 'delete');
  });
}

/** Undo for swipe-to-delete: clears deleted_at within the same session. */
export async function restore(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE log_entries SET deleted_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?',
      now,
      id,
    );
    await enqueue(db, 'log_entries', id, 'upsert');
  });
}

/**
 * Copy a meal from one day to another, snapshots and all.
 *
 * The copies take the original's recorded nutrition rather than recalculating
 * from the food, so copying Tuesday's lunch reproduces exactly what Tuesday
 * showed.
 */
export async function copyMeal(
  userId: string,
  from: { logDate: DateString; meal: Meal },
  to: { logDate: DateString; meal: Meal },
): Promise<number> {
  const db = await getDatabase();
  const source = await listByDay(userId, from.logDate);
  const entries = source.filter((e) => e.meal === from.meal);
  if (entries.length === 0) return 0;

  const now = Date.now();
  await db.withTransactionAsync(async () => {
    let sortOrder = await nextSortOrder(db, userId, to.logDate, to.meal);
    for (const entry of entries) {
      const id = newId();
      await db.runAsync(
        `INSERT INTO log_entries (
           id, user_id, log_date, meal, sort_order, logged_at,
           food_id, recipe_id, name_snapshot, brand_snapshot,
           quantity, unit_label, amount_in_basis, basis_unit,
           kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
           entry_source, is_estimate, ai_confidence, created_at, updated_at, dirty
         )
         SELECT ?, user_id, ?, ?, ?, ?,
           food_id, recipe_id, name_snapshot, brand_snapshot,
           quantity, unit_label, amount_in_basis, basis_unit,
           kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg,
           'copied', is_estimate, ai_confidence, ?, ?, 1
         FROM log_entries WHERE id = ?`,
        id,
        to.logDate,
        to.meal,
        sortOrder++,
        now,
        now,
        now,
        entry.id,
      );
      await enqueue(db, 'log_entries', id, 'upsert');
    }
  });

  return entries.length;
}

/** Distinct days with at least one entry, newest first. Used by the streak. */
export async function loggedDates(
  userId: string,
  since: DateString,
): Promise<DateString[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ log_date: DateString }>(
    `SELECT DISTINCT log_date FROM log_entries
     WHERE user_id = ? AND log_date >= ? AND deleted_at IS NULL
     ORDER BY log_date DESC`,
    userId,
    since,
  );
  return rows.map((r) => r.log_date);
}

/**
 * Per-day totals across a range, for the progress charts.
 *
 * Reads the v_daily_totals view, which sums the entries' own snapshots — so a
 * chart of last month shows what those days showed at the time, not what they
 * would compute to against today's food data.
 *
 * Days with nothing logged are simply absent rather than returned as zeroes:
 * a day not recorded is not a day of no food, and averaging it in as zero
 * would understate every period it appears in.
 */
export async function dailyTotals(
  userId: string,
  from: DateString,
  to: DateString,
): Promise<
  {
    date: DateString;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    entryCount: number;
  }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    log_date: DateString;
    kcal: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    entry_count: number;
  }>(
    `SELECT log_date, kcal, protein_g, carbs_g, fat_g, entry_count
     FROM v_daily_totals
     WHERE user_id = ? AND log_date >= ? AND log_date <= ?
     ORDER BY log_date`,
    userId,
    from,
    to,
  );

  return rows.map((row) => ({
    date: row.log_date,
    kcal: row.kcal ?? 0,
    proteinG: row.protein_g ?? 0,
    carbsG: row.carbs_g ?? 0,
    fatG: row.fat_g ?? 0,
    entryCount: row.entry_count,
  }));
}
