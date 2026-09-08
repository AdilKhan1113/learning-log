/**
 * Foods: the user's custom entries and anything cached from an upstream
 * database. Search runs in two stages — FTS narrows, then the pure ranker in
 * src/domain/search orders.
 */
import type { Database } from '../client.ts';
import { getDatabase } from '../client.ts';
import type { FoodPortionRow, FoodRow } from '../types.ts';
import type { FoodLike } from '../../domain/types.ts';
import { buildSearchText } from '../../domain/search/normalize.ts';
import { type RankedFood, rankFoods, toFtsQuery } from '../../domain/search/rank.ts';
import { newId } from '../../utils/ids.ts';
import type { MappedFood } from '../../services/openfoodfacts/normalize.ts';
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


// --- catalogue cache ---------------------------------------------------------

/**
 * Cached rows are kept for this long after being fetched. A row that has been
 * logged, favourited, or used in a recipe is never pruned regardless of age.
 */
export const CACHE_TTL_DAYS = 60;

/** Upstream databases a cached row can come from. */
export type CatalogSource = 'openfoodfacts' | 'usda' | 'nutritionix';

/**
 * Write products fetched from an upstream database into the local catalogue.
 *
 * Cached rows are shared rather than user-owned (user_id IS NULL), so a food
 * looked up once is instantly available afterwards — including offline, and
 * including the Phase 3 barcode scan, since the OFF code is the barcode.
 *
 * An existing row is refreshed in place so its id stays stable: log entries
 * point at it for "log again", and the user may have favourited it. The
 * columns that belong to this device — is_favorite, last_used_at, use_count —
 * are never overwritten by a refresh.
 *
 * Cached rows are deliberately not queued for sync. They are reproducible from
 * the upstream database, so pushing them would spend the user's bandwidth
 * replicating a public catalogue.
 */
export async function cacheProducts(
  products: readonly MappedFood[],
  source: CatalogSource = 'openfoodfacts',
): Promise<{ inserted: number; refreshed: number }> {
  if (products.length === 0) return { inserted: 0, refreshed: 0 };

  const db = await getDatabase();
  const now = Date.now();
  let inserted = 0;
  let refreshed = 0;

  await db.withTransactionAsync(async () => {
    for (const product of products) {
      const existing = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM foods
         WHERE source = ? AND source_id = ? AND deleted_at IS NULL`,
        source,
        product.sourceId,
      );

      if (existing) {
        await db.runAsync(
          `UPDATE foods SET
             name = ?, brand = ?, search_text = ?, barcode = ?, basis_unit = ?,
             kcal_per_100 = ?, protein_g_per_100 = ?, carbs_g_per_100 = ?,
             fat_g_per_100 = ?, fiber_g_per_100 = ?, sugar_g_per_100 = ?,
             sat_fat_g_per_100 = ?, sodium_mg_per_100 = ?, updated_at = ?
           WHERE id = ?`,
          product.name,
          product.brand,
          buildSearchText(product.name, product.brand),
          product.barcode,
          product.basisUnit,
          product.kcalPer100,
          product.proteinGPer100,
          product.carbsGPer100,
          product.fatGPer100,
          product.fiberGPer100,
          product.sugarGPer100,
          product.satFatGPer100,
          product.sodiumMgPer100,
          now,
          existing.id,
        );
        await insertMissingPortions(db, existing.id, product, now);
        refreshed++;
        continue;
      }

      const id = newId();
      await db.runAsync(
        `INSERT INTO foods (
           id, user_id, name, brand, search_text, source, source_id, barcode,
           basis_unit, kcal_per_100, protein_g_per_100, carbs_g_per_100,
           fat_g_per_100, fiber_g_per_100, sugar_g_per_100, sat_fat_g_per_100,
           sodium_mg_per_100, created_at, updated_at, dirty
         ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        id,
        product.name,
        product.brand,
        buildSearchText(product.name, product.brand),
        source,
        product.sourceId,
        product.barcode,
        product.basisUnit,
        product.kcalPer100,
        product.proteinGPer100,
        product.carbsGPer100,
        product.fatGPer100,
        product.fiberGPer100,
        product.sugarGPer100,
        product.satFatGPer100,
        product.sodiumMgPer100,
        now,
        now,
      );
      await insertMissingPortions(db, id, product, now);
      inserted++;
    }
  });

  return { inserted, refreshed };
}

/**
 * Add the product's serving as a portion, but only if the food has none.
 *
 * Replacing portions on every refresh would churn ids that recipe ingredients
 * point at, for information that rarely changes.
 */
async function insertMissingPortions(
  db: Database,
  foodId: string,
  product: MappedFood,
  now: number,
): Promise<void> {
  if (product.portions.length === 0) return;

  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM food_portions WHERE food_id = ? AND deleted_at IS NULL',
    foodId,
  );
  if ((existing?.count ?? 0) > 0) return;

  let sortOrder = 0;
  for (const portion of product.portions) {
    await db.runAsync(
      `INSERT INTO food_portions (
         id, food_id, label, quantity, amount_in_basis, is_default,
         sort_order, created_at, updated_at, dirty
       ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0)`,
      newId(),
      foodId,
      portion.label,
      portion.amountInBasis,
      sortOrder === 0 ? 1 : 0,
      sortOrder,
      now,
      now,
    );
    sortOrder++;
  }
}

/**
 * Drop stale catalogue rows so a year of searching does not leave thousands of
 * foods the user never chose.
 *
 * Only untouched rows go: anything logged, favourited, or referenced by an
 * entry or a recipe stays, whatever its age. Custom foods are never pruned.
 */
export async function pruneCache(olderThanDays = CACHE_TTL_DAYS): Promise<number> {
  const db = await getDatabase();
  const cutoff = Date.now() - olderThanDays * 86_400_000;

  const result = await db.runAsync(
    `DELETE FROM foods
     WHERE user_id IS NULL
       AND source <> 'custom'
       AND is_favorite = 0
       AND last_used_at IS NULL
       AND use_count = 0
       AND created_at < ?
       AND NOT EXISTS (SELECT 1 FROM log_entries WHERE log_entries.food_id = foods.id)
       AND NOT EXISTS (SELECT 1 FROM recipe_ingredients WHERE recipe_ingredients.food_id = foods.id)`,
    cutoff,
  );

  return result.changes;
}


/**
 * Find a cached or custom food by barcode.
 *
 * Tried in the order the candidates are given — the canonical EAN-13 first,
 * then the forms a catalogue might have stored instead. A food the user
 * created themselves wins over a cached one for the same barcode, since they
 * entered it deliberately.
 */
export async function findByBarcode(
  candidates: readonly string[],
): Promise<{ id: string; name: string } | null> {
  if (candidates.length === 0) return null;
  const db = await getDatabase();

  for (const candidate of candidates) {
    const row = await db.getFirstAsync<{ id: string; name: string }>(
      `SELECT id, name FROM foods
       WHERE barcode = ? AND deleted_at IS NULL
       ORDER BY CASE WHEN source = 'custom' THEN 0 ELSE 1 END
       LIMIT 1`,
      candidate,
    );
    if (row) return row;
  }

  return null;
}

/**
 * Cache one product and return its local id.
 *
 * The barcode scanner needs the id to open the serving sheet, and looking it
 * up again afterwards would be a second query for something this already
 * knows.
 */
export async function cacheProduct(
  product: MappedFood,
  source: CatalogSource = 'openfoodfacts',
): Promise<string> {
  await cacheProducts([product], source);

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM foods
     WHERE source = ? AND source_id = ? AND deleted_at IS NULL`,
    source,
    product.sourceId,
  );

  if (!row) {
    // cacheProducts either inserted or refreshed a row for this source id, so
    // its absence means something is wrong with the write rather than with the
    // data, and silently returning a wrong id would log the wrong food.
    throw new Error(`Cached product ${product.sourceId} could not be read back`);
  }
  return row.id;
}
