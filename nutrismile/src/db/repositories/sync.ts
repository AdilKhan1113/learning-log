/**
 * Sync bookkeeping shared by every repository.
 *
 * A change is only durable if the intent to push it is written in the same
 * transaction as the change itself, so these helpers are always called inside
 * the caller's transaction, never alongside it.
 */
import type { Database } from '../client.ts';

/** Record that a row needs pushing. Phase 5 drains this queue. */
export async function enqueue(
  db: Database,
  table: string,
  rowId: string,
  op: 'upsert' | 'delete',
): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, row_id, op, queued_at) VALUES (?, ?, ?, ?)`,
    table,
    rowId,
    op,
    Date.now(),
  );
}

/** The columns every insert sets. */
export function auditInsert(now = Date.now()) {
  return { created_at: now, updated_at: now, dirty: 1 as const };
}
