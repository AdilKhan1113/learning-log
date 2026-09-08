/**
 * Migration runner.
 *
 * Migrations are plain SQL strings applied in order inside a transaction, with
 * their version recorded in schema_migrations. Anything already applied is
 * skipped, so this is safe to call on every launch.
 *
 * The SQL lives inline rather than in the .sql file at runtime because Metro
 * cannot require a .sql asset. src/db/schema/001_init.sql stays the readable
 * source of truth and the file the schema test runs against; MIGRATIONS below
 * must be kept identical to it. tests/db/schema.smoke.mjs checks the file, and
 * scripts/check-schema-sync.mjs checks that this copy has not drifted from it.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { INIT_SQL } from './schema/init.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: INIT_SQL },
];

/** Versions already recorded in the database. */
async function appliedVersions(db: SQLiteDatabase): Promise<Set<number>> {
  const tableExists = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
  );
  if (!tableExists) return new Set();

  const rows = await db.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.version));
}

/**
 * Bring the database up to date. Each migration runs in its own transaction,
 * so a failure part-way leaves the database on the last complete version
 * rather than half-migrated.
 */
export async function migrate(db: SQLiteDatabase): Promise<number> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const applied = await appliedVersions(db);
  let count = 0;

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        Date.now(),
      );
    });
    count++;
  }

  return count;
}
