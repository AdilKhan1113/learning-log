/**
 * Weight log. One entry per day; logging again the same day replaces it.
 * Always stored in kilograms, converted at the UI edge for imperial users.
 */
import { getDatabase } from '../client.ts';
import { type DateString, today } from '../../utils/dates.ts';
import { newId } from '../../utils/ids.ts';
import { enqueue } from './sync.ts';

export interface WeightEntry {
  id: string;
  logDate: DateString;
  weightKg: number;
}

export async function latest(userId: string): Promise<WeightEntry | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string; log_date: string; weight_kg: number }>(
    `SELECT id, log_date, weight_kg FROM weight_entries
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY log_date DESC LIMIT 1`,
    userId,
  );
  return row ? { id: row.id, logDate: row.log_date, weightKg: row.weight_kg } : null;
}

export async function history(
  userId: string,
  since: DateString,
): Promise<WeightEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string; log_date: string; weight_kg: number }>(
    `SELECT id, log_date, weight_kg FROM weight_entries
     WHERE user_id = ? AND log_date >= ? AND deleted_at IS NULL
     ORDER BY log_date`,
    userId,
    since,
  );
  return rows.map((r) => ({ id: r.id, logDate: r.log_date, weightKg: r.weight_kg }));
}

/** Record today's weight, replacing any entry already made today. */
export async function record(
  userId: string,
  weightKg: number,
  date: DateString = today(),
): Promise<string> {
  const db = await getDatabase();
  const now = Date.now();

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM weight_entries WHERE user_id = ? AND log_date = ?',
    userId,
    date,
  );
  const id = existing?.id ?? newId();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO weight_entries (id, user_id, log_date, weight_kg, recorded_at,
         created_at, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(user_id, log_date) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         recorded_at = excluded.recorded_at,
         deleted_at = NULL,
         updated_at = excluded.updated_at,
         dirty = 1`,
      id,
      userId,
      date,
      weightKg,
      now,
      now,
      now,
    );
    await enqueue(db, 'weight_entries', id, 'upsert');
  });

  return id;
}
