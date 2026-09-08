/**
 * Water intake. One row per tap rather than a running total, so undo is a
 * delete and two offline devices merge by union.
 */
import { getDatabase } from '../client.ts';
import { type DateString, today } from '../../utils/dates.ts';
import { newId } from '../../utils/ids.ts';
import { enqueue } from './sync.ts';

export async function totalForDay(
  userId: string,
  date: DateString = today(),
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount_ml) AS total FROM water_entries
     WHERE user_id = ? AND log_date = ? AND deleted_at IS NULL`,
    userId,
    date,
  );
  return row?.total ?? 0;
}

export async function add(
  userId: string,
  amountMl: number,
  date: DateString = today(),
): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO water_entries (id, user_id, log_date, amount_ml, logged_at,
         created_at, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      id,
      userId,
      date,
      amountMl,
      now,
      now,
      now,
    );
    await enqueue(db, 'water_entries', id, 'upsert');
  });
  return id;
}

/** Undo the most recent tap of the day. */
export async function removeLast(
  userId: string,
  date: DateString = today(),
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM water_entries
     WHERE user_id = ? AND log_date = ? AND deleted_at IS NULL
     ORDER BY logged_at DESC LIMIT 1`,
    userId,
    date,
  );
  if (!row) return false;

  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE water_entries SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      now,
      now,
      row.id,
    );
    await enqueue(db, 'water_entries', row.id, 'delete');
  });
  return true;
}
