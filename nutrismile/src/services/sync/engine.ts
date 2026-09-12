/**
 * Draining the outbox and pulling what changed elsewhere.
 *
 * The decisions — what to send, in what order, who wins — are in plan.ts and
 * are unit-tested. This file is the I/O around them: read rows, call Supabase,
 * write rows back, move the cursor.
 *
 * Sync is best-effort by design. Nothing here blocks the app, and a failure
 * leaves the outbox intact so the next attempt picks up where this one stopped.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDatabase } from '../../db/client.ts';
import { getSupabase } from '../supabase/client.ts';
import {
  type PlannedChange,
  type QueueEntry,
  type Row,
  SYNC_TABLES,
  type SyncTable,
  coalesceQueue,
  describeRemoteError,
  toLocalRow,
  toRemoteRow,
} from './plan.ts';

/** Rows per request. Large enough to be worth a round trip, small enough that
 *  a failure does not lose much progress. */
const BATCH_SIZE = 200;

const cursorKey = (table: SyncTable) => `sync.cursor.${table}`;

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  /** Set when sync could not run or did not finish. Never shown as an error
   *  dialog — the app works offline and this is a status, not a failure. */
  problem: string | null;
}

/** The device's own columns for a table, so a remote row cannot introduce one. */
async function localColumns(table: SyncTable): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

async function readQueue(): Promise<QueueEntry[]> {
  const db = await getDatabase();
  return db.getAllAsync<QueueEntry>(
    'SELECT id, table_name, row_id, op, queued_at FROM sync_queue ORDER BY queued_at, id',
  );
}

async function readRow(table: SyncTable, rowId: string): Promise<Row | null> {
  const db = await getDatabase();
  return (await db.getFirstAsync<Row>(`SELECT * FROM ${table} WHERE id = ?`, rowId)) ?? null;
}

async function clearQueue(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDatabase();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, ...ids);
}

async function markClean(table: SyncTable, rowId: string, serverUpdatedAt: number) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ${table} SET dirty = 0, server_updated_at = ? WHERE id = ?`,
    serverUpdatedAt,
    rowId,
  );
}

async function readCursor(table: SyncTable): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_meta WHERE key = ?',
    cursorKey(table),
  );
  const parsed = Number(row?.value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeCursor(table: SyncTable, value: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    cursorKey(table),
    String(value),
    Date.now(),
  );
}

/**
 * Send one row.
 *
 * A soft-deleted row is sent as an upsert like any other: `deleted_at` is the
 * delete, and sending it as a row rather than a DELETE is what lets another
 * device learn that it happened.
 */
async function pushChange(
  supabase: SupabaseClient,
  change: PlannedChange,
  userId: string,
): Promise<string | null> {
  const row = await readRow(change.table, change.rowId);

  // Hard-deleted locally with nothing to send — the queue entry is stale.
  if (!row) return null;

  const remote = toRemoteRow(change.table, row, userId);
  const { error } = await supabase.from(change.table).upsert(remote, { onConflict: 'id' });
  if (error) return describeRemoteError(error);

  await markClean(change.table, change.rowId, Number(row.updated_at ?? Date.now()));
  return null;
}

/**
 * Write a remote row into the local database.
 *
 * Column names come from the device's own schema, never from the payload, so a
 * remote row cannot introduce a column. A local row that is dirty and newer is
 * left alone: it has an unsent edit that would otherwise be silently discarded.
 */
async function applyRemoteRow(
  table: SyncTable,
  remote: Row,
  columns: readonly string[],
): Promise<boolean> {
  const db = await getDatabase();
  const local = toLocalRow(table, remote, columns);
  const id = local.id;
  if (typeof id !== 'string') return false;

  const existing = await db.getFirstAsync<{ updated_at: number; dirty: number }>(
    `SELECT updated_at, dirty FROM ${table} WHERE id = ?`,
    id,
  );

  if (existing?.dirty === 1 && existing.updated_at >= Number(local.updated_at ?? 0)) {
    return false;
  }

  const keys = Object.keys(local);
  const assignments = keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`);

  await db.runAsync(
    `INSERT INTO ${table} (${keys.join(', ')}, dirty, server_updated_at)
     VALUES (${keys.map(() => '?').join(', ')}, 0, ?)
     ON CONFLICT(id) DO UPDATE SET ${assignments.join(', ')}, dirty = 0,
       server_updated_at = excluded.server_updated_at`,
    ...keys.map((k) => local[k] as string | number | null),
    Number(local.updated_at ?? Date.now()),
  );
  return true;
}

/**
 * Push everything queued. Stops at the first failure so ordering holds, and
 * reports why — a run that stopped early is not a run that succeeded.
 */
export async function push(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ pushed: number; problem: string | null }> {
  const planned = coalesceQueue(await readQueue());
  let pushed = 0;

  for (const change of planned) {
    const problem = await pushChange(supabase, change, userId);
    // A later change may depend on this one, so stop rather than skip.
    if (problem) return { pushed, problem };
    await clearQueue(change.queueIds);
    pushed++;
  }
  return { pushed, problem: null };
}

/**
 * Pull everything changed since the last cursor, table by table.
 *
 * An error and an empty page used to take the same branch, so a server that
 * refused every request looked exactly like a server with nothing new.
 */
export async function pull(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ pulled: number; problem: string | null }> {
  let pulled = 0;

  for (const table of SYNC_TABLES) {
    const columns = await localColumns(table);
    const since = await readCursor(table);
    let cursor = since;

    // Page until a short batch comes back.
    for (;;) {
      const query = supabase
        .from(table)
        .select('*')
        .gt('updated_at', cursor)
        .order('updated_at', { ascending: true })
        .limit(BATCH_SIZE);

      // The profile row is keyed by the user id itself; everything else by owner.
      const { data, error } = await (table === 'users'
        ? query.eq('id', userId)
        : query.eq('user_id', userId));

      if (error) return { pulled, problem: describeRemoteError(error) };
      if (!data || data.length === 0) break;

      for (const remote of data as Row[]) {
        if (await applyRemoteRow(table, remote, columns)) pulled++;
        cursor = Math.max(cursor, Number(remote.updated_at ?? cursor));
      }

      await writeCursor(table, cursor);
      if (data.length < BATCH_SIZE) break;
    }
  }

  return { pulled, problem: null };
}

/**
 * One sync pass: push, then pull.
 *
 * Push first so local work is safe before anything can overwrite it, and so a
 * row this device just created is on the server before the pull that would
 * otherwise not know about it.
 */
export async function sync(userId: string): Promise<SyncOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { pushed: 0, pulled: 0, problem: 'Cloud backup isn’t set up.' };

  try {
    const pushResult = await push(supabase, userId);
    // Pull anyway: a push that failed on one table does not mean the rest of
    // the account cannot be brought down, and the user is better off with
    // fresh data plus an honest status than with neither.
    const pullResult = await pull(supabase, userId);
    return {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      problem: pushResult.problem ?? pullResult.problem,
    };
  } catch (error) {
    return {
      pushed: 0,
      pulled: 0,
      problem: error instanceof Error ? error.message : 'Sync could not finish.',
    };
  }
}

/** How much is waiting to go out. Shown in Profile. */
export async function pendingCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM sync_queue',
  );
  return row?.count ?? 0;
}
