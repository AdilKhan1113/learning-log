-- NutriSmile local schema (SQLite / expo-sqlite)
-- Migration 001 — initial. Local-first: this file is the source of truth for the
-- on-device database. The Supabase mirror in supabase/migrations/ is generated
-- to match it.
--
-- Conventions used throughout:
--   * Primary keys are client-generated UUIDv4 TEXT so rows can be created
--     offline and pushed later without renumbering.
--   * Timestamps are INTEGER Unix epoch milliseconds (UTC).
--   * Calendar days are TEXT 'YYYY-MM-DD' in the *user's local* timezone, so a
--     day boundary never shifts under a traveling user.
--   * Booleans are INTEGER 0/1.
--   * Soft deletes: deleted_at IS NOT NULL means gone. Rows are kept so a
--     delete can be replicated to other devices.
--   * Sync bookkeeping: updated_at (local clock) + dirty (needs push) +
--     server_updated_at (last value confirmed by Supabase).
--   * Energy is stored in kcal. Macros in grams. Micros in mg/mcg as named.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- users
-- One row per profile on this device (normally exactly one). id matches the
-- Supabase auth.users id once signed in; before sign-in it is a local UUID that
-- is rewritten on first successful auth.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  TEXT PRIMARY KEY NOT NULL,
  email               TEXT,
  display_name        TEXT,

  -- Onboarding inputs (nullable until onboarding completes)
  birth_date          TEXT,                       -- 'YYYY-MM-DD'; age derived, so it stays correct
  sex                 TEXT CHECK (sex IN ('female','male','unspecified')),
  height_cm           REAL CHECK (height_cm > 0),
  activity_level      TEXT CHECK (activity_level IN
                        ('sedentary','light','moderate','active','very_active')),
  goal_type           TEXT CHECK (goal_type IN ('lose','maintain','gain')),
  goal_rate_kg_week   REAL,                       -- signed: -0.5 = lose 0.5 kg/wk

  -- Display preferences
  unit_system         TEXT NOT NULL DEFAULT 'metric'
                        CHECK (unit_system IN ('metric','imperial')),
  theme               TEXT NOT NULL DEFAULT 'dark'
                        CHECK (theme IN ('dark','light','system')),
  water_unit          TEXT NOT NULL DEFAULT 'ml' CHECK (water_unit IN ('ml','floz')),
  water_container_ml  REAL NOT NULL DEFAULT 250,  -- size of one tap on the water counter
  timezone            TEXT,                       -- IANA name, e.g. 'Europe/London'
  onboarded_at        INTEGER,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

-- ---------------------------------------------------------------------------
-- daily_goals
-- Effective-dated targets. One row per (user, day) only for days where the
-- target changed; the value in force for any day is the newest row with
-- effective_date <= that day. Editing today's target never rewrites history.
-- Macro grams are stored (not percentages) because grams are what the
-- dashboard compares against; percentages are derived for display.
-- ---------------------------------------------------------------------------
CREATE TABLE daily_goals (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_date      TEXT NOT NULL,              -- 'YYYY-MM-DD', local

  calorie_target      REAL NOT NULL CHECK (calorie_target > 0),
  protein_g_target    REAL NOT NULL CHECK (protein_g_target >= 0),
  carbs_g_target      REAL NOT NULL CHECK (carbs_g_target >= 0),
  fat_g_target        REAL NOT NULL CHECK (fat_g_target >= 0),
  fiber_g_target      REAL,
  water_ml_target     REAL NOT NULL DEFAULT 2000,

  -- Provenance: what produced these numbers, and the inputs used, so the
  -- Profile screen can explain a target and recompute it if a input changes.
  source              TEXT NOT NULL DEFAULT 'calculated'
                        CHECK (source IN ('calculated','manual')),
  bmr_kcal            REAL,                       -- Mifflin-St Jeor output
  tdee_kcal           REAL,                       -- BMR x activity multiplier
  calc_weight_kg      REAL,
  calc_height_cm      REAL,
  calc_age_years      REAL,
  calc_activity_level TEXT,
  floor_applied       INTEGER NOT NULL DEFAULT 0 CHECK (floor_applied IN (0,1)),

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),

  UNIQUE (user_id, effective_date)
);

CREATE INDEX idx_daily_goals_lookup ON daily_goals (user_id, effective_date DESC);

-- ---------------------------------------------------------------------------
-- foods
-- One row per distinct food, whatever its origin: typed in by the user, cached
-- from Open Food Facts / USDA, or created from a barcode scan that found
-- nothing. Nutrition is normalised to a per-100 basis so every serving
-- calculation is one multiplication.
-- ---------------------------------------------------------------------------
CREATE TABLE foods (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT REFERENCES users(id) ON DELETE CASCADE,
                        -- NULL = shared/cached catalogue row, not user-owned

  name                TEXT NOT NULL,
  brand               TEXT,
  -- Lowercased, punctuation-stripped 'name + brand', maintained by trigger.
  -- The fuzzy matcher scores against this; the FTS index tokenises it.
  search_text         TEXT NOT NULL DEFAULT '',

  source              TEXT NOT NULL DEFAULT 'custom'
                        CHECK (source IN ('custom','openfoodfacts','usda','nutritionix','photo_ai')),
  source_id           TEXT,                       -- upstream id, for refresh/dedupe
  barcode             TEXT,                       -- UPC/EAN as scanned

  -- Nutrition basis. 'g' for solids, 'ml' for liquids. All values below are
  -- per 100 of this unit.
  basis_unit          TEXT NOT NULL DEFAULT 'g' CHECK (basis_unit IN ('g','ml')),
  kcal_per_100        REAL NOT NULL CHECK (kcal_per_100 >= 0),
  protein_g_per_100   REAL NOT NULL DEFAULT 0 CHECK (protein_g_per_100 >= 0),
  carbs_g_per_100     REAL NOT NULL DEFAULT 0 CHECK (carbs_g_per_100 >= 0),
  fat_g_per_100       REAL NOT NULL DEFAULT 0 CHECK (fat_g_per_100 >= 0),
  fiber_g_per_100     REAL,
  sugar_g_per_100     REAL,
  sat_fat_g_per_100   REAL,
  sodium_mg_per_100   REAL,

  -- Density, so 'cups' works for a food whose basis is grams (and vice versa).
  -- NULL means volume units are not offered for this food.
  grams_per_ml        REAL CHECK (grams_per_ml > 0),

  is_favorite         INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0,1)),
  is_verified         INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  last_used_at        INTEGER,                    -- drives the "Recent" list
  use_count           INTEGER NOT NULL DEFAULT 0,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

-- A barcode identifies one catalogue row per source; a user's own custom food
-- may reuse a barcode without colliding with the cache.
CREATE UNIQUE INDEX idx_foods_barcode ON foods (barcode, source)
  WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_foods_source_id ON foods (source, source_id)
  WHERE source_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_foods_recent ON foods (user_id, last_used_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_foods_favorite ON foods (user_id, name)
  WHERE is_favorite = 1 AND deleted_at IS NULL;
CREATE INDEX idx_foods_search ON foods (search_text) WHERE deleted_at IS NULL;

-- Prefix/token search. The fuzzy ranking is a pure TS function applied to the
-- candidate set FTS returns, so ranking stays unit-testable without a database.
CREATE VIRTUAL TABLE foods_fts USING fts5 (
  name, brand, search_text,
  content = 'foods',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER foods_ai AFTER INSERT ON foods BEGIN
  INSERT INTO foods_fts (rowid, name, brand, search_text)
    VALUES (new.rowid, new.name, new.brand, new.search_text);
END;
CREATE TRIGGER foods_ad AFTER DELETE ON foods BEGIN
  INSERT INTO foods_fts (foods_fts, rowid, name, brand, search_text)
    VALUES ('delete', old.rowid, old.name, old.brand, old.search_text);
END;
CREATE TRIGGER foods_au AFTER UPDATE ON foods BEGIN
  INSERT INTO foods_fts (foods_fts, rowid, name, brand, search_text)
    VALUES ('delete', old.rowid, old.name, old.brand, old.search_text);
  INSERT INTO foods_fts (rowid, name, brand, search_text)
    VALUES (new.rowid, new.name, new.brand, new.search_text);
END;

-- ---------------------------------------------------------------------------
-- food_portions
-- The named servings a food can be logged in: "1 medium (118 g)", "1 cup",
-- "1 slice", plus the generic g/oz/ml/cup rows the app adds for every food.
-- Without this table the unit picker cannot offer '1 medium', so it is a
-- required addition to the eight tables in the brief.
-- ---------------------------------------------------------------------------
CREATE TABLE food_portions (
  id                  TEXT PRIMARY KEY NOT NULL,
  food_id             TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,

  label               TEXT NOT NULL,              -- '1 medium', 'cup', 'g', 'slice'
  -- How much of the food's basis_unit one of this portion is.
  -- A 118 g medium banana on a 'g' basis food: quantity 1, grams_or_ml 118.
  quantity            REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_in_basis     REAL NOT NULL CHECK (amount_in_basis > 0),

  is_default          INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  sort_order          INTEGER NOT NULL DEFAULT 0,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

CREATE INDEX idx_food_portions_food ON food_portions (food_id, sort_order)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- recipes
-- A saved multi-ingredient dish. Per-serving nutrition is *derived* from
-- recipe_ingredients rather than stored, so editing an ingredient cannot leave
-- a stale total behind. The derived values are cached in the columns below and
-- recomputed on every ingredient write.
-- ---------------------------------------------------------------------------
CREATE TABLE recipes (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name                TEXT NOT NULL,
  search_text         TEXT NOT NULL DEFAULT '',
  notes               TEXT,
  servings            REAL NOT NULL DEFAULT 1 CHECK (servings > 0),
  serving_label       TEXT,                       -- 'bowl', 'slice'
  photo_uri           TEXT,                       -- local file URI

  -- Cached rollup (per whole recipe, not per serving). Recomputed, never typed.
  total_grams         REAL,
  total_kcal          REAL,
  total_protein_g     REAL,
  total_carbs_g       REAL,
  total_fat_g         REAL,
  totals_stale        INTEGER NOT NULL DEFAULT 1 CHECK (totals_stale IN (0,1)),

  is_favorite         INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0,1)),
  last_used_at        INTEGER,
  use_count           INTEGER NOT NULL DEFAULT 0,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

CREATE INDEX idx_recipes_user ON recipes (user_id, last_used_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- recipe_ingredients
-- ---------------------------------------------------------------------------
CREATE TABLE recipe_ingredients (
  id                  TEXT PRIMARY KEY NOT NULL,
  recipe_id           TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_id             TEXT NOT NULL REFERENCES foods(id) ON DELETE RESTRICT,
  portion_id          TEXT REFERENCES food_portions(id) ON DELETE SET NULL,

  quantity            REAL NOT NULL CHECK (quantity > 0),
  unit_label          TEXT NOT NULL,              -- what the user picked, for redisplay
  amount_in_basis     REAL NOT NULL CHECK (amount_in_basis > 0),
                        -- resolved g or ml, the only value the math reads
  sort_order          INTEGER NOT NULL DEFAULT 0,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

CREATE INDEX idx_recipe_ingredients_recipe
  ON recipe_ingredients (recipe_id, sort_order) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- log_entries
-- The heart of the app. Every row carries a full snapshot of the nutrition it
-- contributed at the moment it was logged, plus the food's name and brand.
-- Nothing in this table is recomputed from foods/recipes later, so correcting a
-- food tomorrow leaves yesterday's totals exactly as they were.
--
-- food_id / recipe_id are provenance links only (nullable, ON DELETE SET NULL)
-- and exist for "log again" and "edit", never for arithmetic.
-- ---------------------------------------------------------------------------
CREATE TABLE log_entries (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  log_date            TEXT NOT NULL,              -- 'YYYY-MM-DD', user-local
  meal                TEXT NOT NULL
                        CHECK (meal IN ('breakfast','lunch','dinner','snacks')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  logged_at           INTEGER NOT NULL,           -- exact instant, for ordering

  food_id             TEXT REFERENCES foods(id) ON DELETE SET NULL,
  recipe_id           TEXT REFERENCES recipes(id) ON DELETE SET NULL,

  -- ---- immutable snapshot ------------------------------------------------
  name_snapshot       TEXT NOT NULL,
  brand_snapshot      TEXT,
  quantity            REAL NOT NULL CHECK (quantity > 0),
  unit_label          TEXT NOT NULL,              -- '1 medium', 'g', 'serving'
  amount_in_basis     REAL,                       -- g or ml; NULL for recipe servings
  basis_unit          TEXT CHECK (basis_unit IN ('g','ml')),

  kcal                REAL NOT NULL CHECK (kcal >= 0),
  protein_g           REAL NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
  carbs_g             REAL NOT NULL DEFAULT 0 CHECK (carbs_g >= 0),
  fat_g               REAL NOT NULL DEFAULT 0 CHECK (fat_g >= 0),
  fiber_g             REAL,
  sugar_g             REAL,
  sat_fat_g           REAL,
  sodium_mg           REAL,
  -- ------------------------------------------------------------------------

  -- How this row got here. 'photo_ai' rows render with the estimate label.
  entry_source        TEXT NOT NULL DEFAULT 'manual'
                        CHECK (entry_source IN
                          ('manual','search','barcode','photo_ai','recipe','copied','quick_add')),
  is_estimate         INTEGER NOT NULL DEFAULT 0 CHECK (is_estimate IN (0,1)),
  ai_confidence       REAL CHECK (ai_confidence BETWEEN 0 AND 1),
  ai_photo_uri        TEXT,
  notes               TEXT,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

-- The dashboard's only hot query: one day, grouped by meal.
CREATE INDEX idx_log_entries_day
  ON log_entries (user_id, log_date, meal, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_log_entries_history
  ON log_entries (user_id, logged_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- weight_entries
-- One weight per day; a second entry for the same day replaces the first.
-- Always stored in kg, converted at the edge for imperial users.
-- ---------------------------------------------------------------------------
CREATE TABLE weight_entries (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            TEXT NOT NULL,              -- 'YYYY-MM-DD', local
  weight_kg           REAL NOT NULL CHECK (weight_kg > 0),
  body_fat_pct        REAL CHECK (body_fat_pct BETWEEN 0 AND 100),
  note                TEXT,
  recorded_at         INTEGER NOT NULL,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1)),

  UNIQUE (user_id, log_date)
);

CREATE INDEX idx_weight_entries_trend ON weight_entries (user_id, log_date DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- water_entries
-- One row per tap, not one running total per day, so a mis-tap can be undone
-- without arithmetic and the sync merge is append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE water_entries (
  id                  TEXT PRIMARY KEY NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            TEXT NOT NULL,              -- 'YYYY-MM-DD', local
  amount_ml           REAL NOT NULL CHECK (amount_ml > 0),
  logged_at           INTEGER NOT NULL,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  server_updated_at   INTEGER,
  dirty               INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0,1))
);

CREATE INDEX idx_water_entries_day ON water_entries (user_id, log_date)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Infrastructure
-- ---------------------------------------------------------------------------

-- Applied migrations. Checked on every app start before any query runs.
CREATE TABLE schema_migrations (
  version             INTEGER PRIMARY KEY NOT NULL,
  name                TEXT NOT NULL,
  applied_at          INTEGER NOT NULL
);

-- Small key/value store for things that are not user data: last sync cursor,
-- cached device timezone, feature flags.
CREATE TABLE app_meta (
  key                 TEXT PRIMARY KEY NOT NULL,
  value               TEXT,
  updated_at          INTEGER NOT NULL
);

-- Ordered outbox of local changes awaiting push. Written by repositories in the
-- same transaction as the change itself, so a crash cannot lose a mutation.
-- (Populated in Phase 5; created now so no migration is needed later.)
CREATE TABLE sync_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name          TEXT NOT NULL,
  row_id              TEXT NOT NULL,
  op                  TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  queued_at           INTEGER NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT
);

CREATE INDEX idx_sync_queue_order ON sync_queue (queued_at);

-- ---------------------------------------------------------------------------
-- Convenience views (read-only; no business logic lives here)
-- ---------------------------------------------------------------------------

-- Per-day, per-meal totals for the dashboard.
CREATE VIEW v_daily_meal_totals AS
SELECT
  user_id, log_date, meal,
  COUNT(*)            AS entry_count,
  SUM(kcal)           AS kcal,
  SUM(protein_g)      AS protein_g,
  SUM(carbs_g)        AS carbs_g,
  SUM(fat_g)          AS fat_g
FROM log_entries
WHERE deleted_at IS NULL
GROUP BY user_id, log_date, meal;

-- Per-day totals for the progress charts and the streak counter.
CREATE VIEW v_daily_totals AS
SELECT
  user_id, log_date,
  COUNT(*)            AS entry_count,
  SUM(kcal)           AS kcal,
  SUM(protein_g)      AS protein_g,
  SUM(carbs_g)        AS carbs_g,
  SUM(fat_g)          AS fat_g
FROM log_entries
WHERE deleted_at IS NULL
GROUP BY user_id, log_date;
