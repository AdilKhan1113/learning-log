# NutriSmile — data model

The local SQLite database is defined in `src/db/schema/001_init.sql` and mirrored
by row types in `src/db/types.ts`. `tests/db/schema.smoke.mjs` runs the real file
against an in-memory database and asserts the behaviour described here.

## Tables

| Table | Holds | Notes |
|---|---|---|
| `users` | one profile per device | onboarding inputs + display preferences |
| `daily_goals` | calorie and macro targets | effective-dated, never overwritten |
| `foods` | every food, cached or custom | nutrition normalised per 100 g/ml |
| `food_portions` | named servings for a food | `1 medium`, `cup`, `slice` |
| `recipes` | saved multi-ingredient dishes | per-serving nutrition is derived |
| `recipe_ingredients` | lines within a recipe | resolved to grams at write time |
| `log_entries` | what was eaten | carries an immutable nutrition snapshot |
| `weight_entries` | one weight per day | always kg internally |
| `water_entries` | one row per tap | append-only |
| `schema_migrations` | applied migrations | checked before any query |
| `app_meta` | non-user key/value | sync cursor, cached timezone |
| `sync_queue` | outbox of local changes | written in the mutation's transaction |

Views `v_daily_totals` and `v_daily_meal_totals` roll `log_entries` up for the
dashboard, streak counter and charts.

`food_portions` is an addition to the eight tables in the brief. Without it
"1 medium" cannot be offered as a unit, because there is nowhere to record that
one medium banana is 118 g.

## Decisions worth knowing

**Every log entry snapshots its nutrition.** `log_entries` stores
`name_snapshot`, `kcal`, `protein_g`, `carbs_g`, `fat_g` and the rest as values,
and `food_id` / `recipe_id` are nullable provenance links (`ON DELETE SET NULL`)
used for "log again" and "edit" — never for arithmetic. Fixing a food's calories
tomorrow, or deleting it entirely, leaves every past day exactly as it was
displayed. The smoke test asserts both cases.

**Nutrition is stored per 100 g or per 100 ml, never per serving.** One basis for
every food means each serving calculation is a single multiplication, and the
unit picker can offer grams, ounces, and any named portion without a special
case. `grams_per_ml` is what unlocks volume units for a solid food; when it is
NULL, cups are simply not offered rather than silently guessed.

**Goals are effective-dated, not mutable.** A new target inserts a row with
today's `effective_date`; the target in force for any day is the newest row on or
before it. Changing your goal today therefore does not restate last month's
"consumed vs target". Each row also keeps the inputs it was calculated from
(`bmr_kcal`, `tdee_kcal`, `calc_weight_kg`, `floor_applied`) so the Profile
screen can explain a number instead of just asserting it.

**Days are local calendar strings, instants are epoch milliseconds.**
`log_date` is `'YYYY-MM-DD'` in the user's own timezone, so a day boundary does
not move under someone who flies overnight; `logged_at` keeps the true instant
for ordering. Doing it the other way round makes "what did I eat Tuesday" depend
on where you were standing.

**Deletes are soft, everywhere that syncs.** `deleted_at` marks a row gone, which
is what lets a delete on one device propagate to another. Every read filters
`deleted_at IS NULL`, and the partial indexes are built over that same
predicate — including the barcode uniqueness index, so deleting a bad cached
product frees its barcode for a rescan.

**Search is split in two.** `foods_fts` (FTS5, kept in sync by triggers) narrows
thousands of rows to a candidate set; the fuzzy ranking that decides what the
user actually sees is a pure function in `src/domain/search`, testable without a
database. Typo tolerance belongs in the tested code, not in a SQL string.

**Water is one row per tap.** A mis-tap is undone by deleting a row rather than
by subtracting from a running total, and two devices adding water offline merge
by union instead of fighting over one number.

**Sync fields are on the tables from day one.** `updated_at`, `dirty`,
`server_updated_at` and the `sync_queue` table exist now, unused, so Phase 5 adds
sync without a migration that touches every row on every device.

## Constraint coverage

`CHECK` constraints reject the values that would corrupt a day's totals:
unknown meal names, non-positive quantities, negative calories or macros,
confidence outside 0–1, a zero calorie target. `UNIQUE (user_id, log_date)` on
`weight_entries` keeps the trend chart to one point per day. Foreign keys are on
(`PRAGMA foreign_keys = ON`), and a food still used by a recipe cannot be
hard-deleted out from under it.

## Cloud mirror

`supabase/migrations/` will carry the same tables with `user_id` foreign-keyed to
`auth.users` and row-level security limiting every row to its owner. Cached
catalogue foods (`user_id IS NULL`) are the one shared read surface. That lands
in Phase 5; the local schema is written so nothing has to change when it does.
