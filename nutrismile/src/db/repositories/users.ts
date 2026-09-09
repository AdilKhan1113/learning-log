/**
 * The local profile. Normally exactly one row: the person using this device.
 */
import { getDatabase } from '../client.ts';
import type { ActivityLevel, GoalType, Sex, UserRow } from '../types.ts';
import { newId } from '../../utils/ids.ts';
import { enqueue } from './sync.ts';

export interface Profile {
  id: string;
  displayName: string | null;
  birthDate: string | null;
  sex: Sex | null;
  heightCm: number | null;
  activityLevel: ActivityLevel | null;
  goalType: GoalType | null;
  goalRateKgWeek: number | null;
  unitSystem: 'metric' | 'imperial';
  waterContainerMl: number;
  onboarded: boolean;
}

function toProfile(row: UserRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    birthDate: row.birth_date,
    sex: row.sex,
    heightCm: row.height_cm,
    activityLevel: row.activity_level,
    goalType: row.goal_type,
    goalRateKgWeek: row.goal_rate_kg_week,
    unitSystem: row.unit_system,
    waterContainerMl: row.water_container_ml,
    onboarded: row.onboarded_at !== null,
  };
}

/** The profile on this device, or null before onboarding. */
export async function current(): Promise<Profile | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<UserRow>(
    'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1',
  );
  return row ? toProfile(row) : null;
}

/** Create the local profile. Called once, at the start of onboarding. */
export async function create(): Promise<Profile> {
  const db = await getDatabase();
  const id = newId();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO users (id, created_at, updated_at, dirty) VALUES (?, ?, ?, 1)',
      id,
      now,
      now,
    );
    await enqueue(db, 'users', id, 'upsert');
  });
  const row = await db.getFirstAsync<UserRow>('SELECT * FROM users WHERE id = ?', id);
  return toProfile(row!);
}

export interface ProfileUpdate {
  displayName?: string | null;
  birthDate?: string | null;
  sex?: Sex | null;
  heightCm?: number | null;
  activityLevel?: ActivityLevel | null;
  goalType?: GoalType | null;
  goalRateKgWeek?: number | null;
  unitSystem?: 'metric' | 'imperial';
  waterContainerMl?: number;
  onboardedAt?: number | null;
}

/** Column name for each updatable field. */
const COLUMNS: Record<keyof ProfileUpdate, string> = {
  displayName: 'display_name',
  birthDate: 'birth_date',
  sex: 'sex',
  heightCm: 'height_cm',
  activityLevel: 'activity_level',
  goalType: 'goal_type',
  goalRateKgWeek: 'goal_rate_kg_week',
  unitSystem: 'unit_system',
  waterContainerMl: 'water_container_ml',
  onboardedAt: 'onboarded_at',
};

export async function update(id: string, patch: ProfileUpdate): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const db = await getDatabase();
  const now = Date.now();
  const assignments = entries
    .map(([key]) => `${COLUMNS[key as keyof ProfileUpdate]} = ?`)
    .join(', ');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE users SET ${assignments}, updated_at = ?, dirty = 1 WHERE id = ?`,
      ...entries.map(([, value]) => value as string | number | null),
      now,
      id,
    );
    await enqueue(db, 'users', id, 'upsert');
  });
}

/**
 * Adopt the id the server issued for this device's account.
 *
 * The profile is created offline with a local UUID, long before any sign-in.
 * Once an anonymous session exists, the rows have to move to that id or they
 * would be pushed as somebody else's — and row-level security would reject
 * them.
 *
 * Every table referencing the user is rewritten in one transaction with
 * foreign keys suspended, because a primary key cannot be updated while its
 * children still point at the old value and the schema does not declare
 * ON UPDATE CASCADE. Nothing is read or written between the two states.
 */
export async function adoptAuthId(localId: string, authId: string): Promise<void> {
  if (localId === authId) return;

  const db = await getDatabase();
  const now = Date.now();

  const childTables = [
    'daily_goals',
    'foods',
    'recipes',
    'log_entries',
    'weight_entries',
    'water_entries',
  ] as const;

  // PRAGMA statements do not take effect inside a transaction, so the guard is
  // lifted around it rather than within.
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync('UPDATE users SET id = ?, updated_at = ? WHERE id = ?', authId, now, localId);
      for (const table of childTables) {
        await db.runAsync(
          `UPDATE ${table} SET user_id = ? WHERE user_id = ?`,
          authId,
          localId,
        );
      }
      // The outbox refers to rows by id; the profile row's id just changed.
      await db.runAsync(
        `UPDATE sync_queue SET row_id = ? WHERE table_name = 'users' AND row_id = ?`,
        authId,
        localId,
      );
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
}
