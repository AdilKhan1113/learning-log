/**
 * Deciding what to sync, in what order, and who wins a conflict.
 *
 * Pure. The network and the database live in engine.ts; everything here is a
 * function of its inputs, which is what makes the awkward cases — a delete
 * queued behind three edits, two devices touching the same row — testable
 * without a server.
 */

/** Local-only bookkeeping. Never sent, never accepted back. */
const LOCAL_ONLY_COLUMNS = ['dirty', 'server_updated_at'] as const;

/**
 * Tables that sync, parents before children.
 *
 * Order matters on push: a food_portion whose food has not arrived yet is a
 * foreign key violation. It does not matter on pull, since deletes are soft.
 */
export const SYNC_TABLES = [
  'users',
  'foods',
  'food_portions',
  'recipes',
  'recipe_ingredients',
  'daily_goals',
  'log_entries',
  'weight_entries',
  'water_entries',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * Columns SQLite stores as 0/1 and Postgres stores as boolean, by table.
 * Converted in both directions rather than relying on either side to coerce.
 */
export const BOOLEAN_COLUMNS: Record<SyncTable, readonly string[]> = {
  users: [],
  foods: ['is_favorite', 'is_verified'],
  food_portions: ['is_default'],
  recipes: ['totals_stale', 'is_favorite'],
  recipe_ingredients: [],
  daily_goals: ['floor_applied'],
  log_entries: ['is_estimate'],
  weight_entries: [],
  water_entries: [],
};

/**
 * Tables the cloud stores a user_id on that the device does not.
 * Row-level security has to decide ownership from the row itself.
 */
export const NEEDS_USER_ID: readonly SyncTable[] = ['food_portions', 'recipe_ingredients'];

export type SyncOp = 'upsert' | 'delete';

export interface QueueEntry {
  id: number;
  table_name: string;
  row_id: string;
  op: SyncOp;
  queued_at: number;
}

export interface PlannedChange {
  table: SyncTable;
  rowId: string;
  op: SyncOp;
  /** Every queue row this change stands for, so all can be cleared together. */
  queueIds: number[];
}

/**
 * Collapse the outbox into one change per row.
 *
 * A row edited five times needs one push, not five. A row deleted after being
 * edited is a delete — the edits are irrelevant, since the delete carries the
 * final state anyway. Rows for tables that do not sync are dropped here rather
 * than failing later.
 *
 * Order is by the row's *earliest* queue entry, so a row created before another
 * is still pushed first.
 */
export function coalesceQueue(entries: readonly QueueEntry[]): PlannedChange[] {
  const byRow = new Map<string, PlannedChange & { firstQueuedAt: number }>();

  for (const entry of entries) {
    if (!isSyncTable(entry.table_name)) continue;
    const key = `${entry.table_name}:${entry.row_id}`;
    const existing = byRow.get(key);

    if (!existing) {
      byRow.set(key, {
        table: entry.table_name,
        rowId: entry.row_id,
        op: entry.op,
        queueIds: [entry.id],
        firstQueuedAt: entry.queued_at,
      });
      continue;
    }

    existing.queueIds.push(entry.id);
    existing.firstQueuedAt = Math.min(existing.firstQueuedAt, entry.queued_at);
    // A delete anywhere in the run wins: the row is gone either way, and the
    // soft-deleted row carries its own final state.
    if (entry.op === 'delete') existing.op = 'delete';
  }

  return [...byRow.values()]
    .sort(
      (a, b) =>
        SYNC_TABLES.indexOf(a.table) - SYNC_TABLES.indexOf(b.table) ||
        a.firstQueuedAt - b.firstQueuedAt,
    )
    .map(({ firstQueuedAt: _ignored, ...change }) => change);
}

export function isSyncTable(name: string): name is SyncTable {
  return (SYNC_TABLES as readonly string[]).includes(name);
}

export type Row = Record<string, unknown>;

/**
 * A local row as the cloud should receive it: bookkeeping stripped, 0/1 turned
 * into booleans, and an owner attached where the cloud keeps one.
 */
export function toRemoteRow(table: SyncTable, row: Row, userId: string): Row {
  const out: Row = {};

  for (const [key, value] of Object.entries(row)) {
    if ((LOCAL_ONLY_COLUMNS as readonly string[]).includes(key)) continue;
    out[key] = BOOLEAN_COLUMNS[table].includes(key) ? value === 1 : value;
  }

  if (NEEDS_USER_ID.includes(table)) out.user_id = userId;
  return out;
}

/**
 * A remote row as the device should store it: booleans back to 0/1, and any
 * column the cloud has but the device does not left behind.
 */
export function toLocalRow(table: SyncTable, row: Row, localColumns: readonly string[]): Row {
  const out: Row = {};

  for (const [key, value] of Object.entries(row)) {
    if (!localColumns.includes(key)) continue;
    out[key] = BOOLEAN_COLUMNS[table].includes(key) ? (value ? 1 : 0) : value;
  }
  return out;
}

export type Resolution = 'local' | 'remote' | 'identical';

/**
 * Which version of a row to keep.
 *
 * Last write wins on updated_at, which is the honest rule for a single person
 * on a handful of devices: the most recent edit is the one they meant. A tie
 * goes to the remote copy, so two devices that disagree converge on the same
 * answer instead of each keeping its own.
 *
 * A delete is not special-cased. It carries an updated_at like any other edit,
 * so deleting on one device and editing on another resolves by whichever
 * happened later — which is what the user would expect.
 */
export function resolveConflict(
  localUpdatedAt: number,
  remoteUpdatedAt: number,
): Resolution {
  if (localUpdatedAt > remoteUpdatedAt) return 'local';
  if (remoteUpdatedAt > localUpdatedAt) return 'remote';
  return 'identical';
}

/** What Supabase hands back when a call fails. Only the parts we read. */
export interface RemoteError {
  message?: string;
  code?: string;
}

/**
 * What to tell the user when the server refuses a row.
 *
 * These used to be swallowed: push stopped at the first failure and reported
 * how many rows it had managed, so a project with no tables at all synced
 * "successfully" and the Profile screen said "Backed up just now" over a queue
 * that never emptied. Saying nothing was worse than saying the wrong thing —
 * the one state a backup must never claim is one it is not in.
 *
 * Two failures are worth naming, because the fix differs and neither is
 * transient: the tables not existing yet, and the account not being allowed to
 * write. Everything else keeps the server's own wording, which is more use
 * than a category we invented.
 *
 * Nothing here blames the user; a failed backup is a fact about the server.
 */
export function describeRemoteError(error: RemoteError | null | undefined): string {
  // PGRST205: PostgREST cannot find the table. 42P01: Postgres says the same.
  if (error?.code === 'PGRST205' || error?.code === '42P01') {
    return 'The backup database has no tables yet.';
  }
  // 42501 is a row-level-security refusal; PGRST301 is a rejected token.
  if (error?.code === '42501' || error?.code === 'PGRST301') {
    return 'The backup service would not accept this device’s data.';
  }
  const message = error?.message?.trim();
  return message ? `${message.replace(/\.$/, '')}.` : 'The backup service could not be reached.';
}
