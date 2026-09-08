/**
 * Foods: the user's custom entries and anything cached from an upstream
 * database. Search runs in two stages — FTS narrows, then the pure ranker in
 * src/domain/search orders.
 */
import { getDatabase } from '../client.ts';
import type { FoodPortionRow, FoodRow } from '../types.ts';
import type { FoodLike } from '../../domain/types.ts';
import { buildSearchText } from '../../domain/search/normalize.ts';
import { type RankedFood, rankFoods, toFtsQuery } from '../../domain/search/rank.ts';
import { newId } from '../../utils/ids.ts';
import { toFoodLike } from './mappers.ts';
import { enqueue } from './sync.ts';

/** A food as the search list renders it. */
export interface FoodSummary {
  id: string;
  name: string;
  brand: string | null;
  kcalPer100: number;
  basisUnit: 'g' | 'ml';
  isFavorite: boolean;
  isVerified: boolean;
  isCustom: boolean;
  lastUsedAt: number | null;
  useCount: number;
  searchText: string;
}

function toSummary(row: FoodRow): FoodSummary {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    kcalPer100: row.kcal_per_100,
    basisUnit: row.basis_unit,
    isFavorite: row.is_favorite === 1,
    isVerified: row.is_verified === 1,
    isCustom: row.source === 'custom',
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    searchText: row.search_text,
  };
}

/** How many FTS candidates to rank. Generous enough that the pure ranker,
 *  not the index, decides the order the user sees. */
const CANDIDATE_LIMIT = 200;

/**
 * Search by name or brand.
 *
 * FTS5 supplies candidates; ranking, typo tolerance and the familiarity
 * boosts all happen in the tested pure functions. A query that normalises to
 * nothing returns nothing rather than the whole table.
 */
export async function search(
  userId: string,
  query: string,
  limit = 40,
): Promise<RankedFood<FoodSummary>[]> {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];

  const db = await getDatabase();
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT f.* FROM foods f
     JOIN foods_fts ON foods_fts.rowid = f.rowid
     WHERE foods_fts MATCH ?
       AND f.deleted_at IS NULL
       AND (f.user_id IS NULL OR f.user_id = ?)
     LIMIT ?`,
    ftsQuery,
    userId,
    CANDIDATE_LIMIT,
  );

  return rankFoods(query, rows.map(toSummary), { limit });
}

/** Most recently logged foods, for the Recent tab. */
export async function recent(userId: string, limit = 30): Promise<FoodSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT * FROM foods
     WHERE (user_id = ? OR user_id IS NULL)
       AND last_used_at IS NOT NULL AND deleted_at IS NULL
     ORDER BY last_used_at DESC LIMIT ?`,
    userId,
    limit,
  );
  return rows.map(toSummary);
}

export async function favorites(userId: string): Promise<FoodSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT * FROM foods
     WHERE (user_id = ? OR user_id IS NULL)
       AND is_favorite = 1 AND deleted_at IS NULL
     ORDER BY name`,
    userId,
  );
  return rows.map(toSummary);
}

/** A food with its portions, ready for the serving editor. */
export async function getById(id: string): Promise<FoodLike | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<FoodRow>(
    'SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL',
    id,
  );
  if (!row) return null;

  const portions = await db.getAllAsync<FoodPortionRow>(
    `SELECT * FROM food_portions WHERE food_id = ? AND deleted_at IS NULL
     ORDER BY sort_order, label`,
    id,
  );
  return toFoodLike(row, portions);
}

export interface CreateFoodInput {
  userId: string;
  name: string;
  brand?: string | null;
  basisUnit?: 'g' | 'ml';
  kcalPer100: number;
  proteinGPer100?: number;
  carbsGPer100?: number;
  fatGPer100?: number;
  fiberGPer100?: number | null;
  gramsPerMl?: number | null;
  barcode?: string | null;
  portions?: { label: string; amountInBasis: number; isDefault?: boolean }[];
}

/** Create a custom food, with any named portions it defines. */
export async function create(input: CreateFoodInput): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO foods (
         id, user_id, name, brand, search_text, source, barcode, basis_unit,
         kcal_per_100, protein_g_per_100, carbs_g_per_100, fat_g_per_100,
         fiber_g_per_100, grams_per_ml, created_at, updated_at, dirty
       ) VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id,
      input.userId,
      input.name,
      input.brand ?? null,
      buildSearchText(input.name, input.brand),
      input.barcode ?? null,
      input.basisUnit ?? 'g',
      input.kcalPer100,
      input.proteinGPer100 ?? 0,
      input.carbsGPer100 ?? 0,
      input.fatGPer100 ?? 0,
      input.fiberGPer100 ?? null,
      input.gramsPerMl ?? null,
      now,
      now,
    );

    let sortOrder = 0;
    for (const portion of input.portions ?? []) {
      await db.runAsync(
        `INSERT INTO food_portions (
           id, food_id, label, quantity, amount_in_basis, is_default,
           sort_order, created_at, updated_at, dirty
         ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 1)`,
        newId(),
        id,
        portion.label,
        portion.amountInBasis,
        portion.isDefault ? 1 : 0,
        sortOrder++,
        now,
        now,
      );
    }

    await enqueue(db, 'foods', id, 'upsert');
  });

  return id;
}

export async function setFavorite(id: string, isFavorite: boolean): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE foods SET is_favorite = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      isFavorite ? 1 : 0,
      now,
      id,
    );
    await enqueue(db, 'foods', id, 'upsert');
  });
}

/**
 * Soft delete. Past log entries keep their snapshots and lose only the
 * provenance link, which the schema's ON DELETE SET NULL handles for hard
 * deletes and which nothing here needs to undo for soft ones.
 */
export async function remove(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE foods SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      now,
      now,
      id,
    );
    await enqueue(db, 'foods', id, 'delete');
  });
}
