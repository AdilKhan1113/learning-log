/**
 * The database handle.
 *
 * One connection for the app's lifetime, opened lazily and migrated before it
 * is handed out, so no caller can query a database that has not been set up.
 */
import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations.ts';

const DATABASE_NAME = 'nutrismile.db';

let handle: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrate(db);
  handle = db;
  return db;
}

/**
 * The migrated database. Concurrent callers during startup share one open
 * attempt rather than racing to migrate the same file.
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return Promise.resolve(handle);
  opening ??= open().catch((error) => {
    opening = null; // let a later caller retry rather than caching the failure
    throw error;
  });
  return opening;
}

/** Test and sign-out helper: drops the cached handle. */
export async function closeDatabase(): Promise<void> {
  const db = handle;
  handle = null;
  opening = null;
  await db?.closeAsync();
}

export type Database = SQLite.SQLiteDatabase;

/**
 * Delete every trace of the local database and start over.
 *
 * The file is removed rather than emptied table by table: a DELETE per table
 * can miss one as the schema grows, and "we deleted your data" has to be true
 * without qualification. The next getDatabase() recreates and migrates a fresh
 * one, so the app returns to its first-launch state.
 */
export async function resetDatabase(): Promise<void> {
  await closeDatabase();
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
}
