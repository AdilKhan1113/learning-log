// Schema smoke test. Runs the migration against an in-memory SQLite database
// and exercises the paths the app depends on. No dependencies:
//   node tests/db/schema.smoke.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(here, '../../src/db/schema/001_init.sql'), 'utf8'));

const now = Date.now();
const run = (sql, ...args) => db.prepare(sql).run(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

// --- fixtures ---------------------------------------------------------------
run(
  `INSERT INTO users (id, display_name, birth_date, sex, height_cm, activity_level,
     goal_type, created_at, updated_at)
   VALUES ('u1', 'Test', '1995-04-02', 'female', 170, 'moderate', 'lose', ?, ?)`,
  now, now,
);

run(
  `INSERT INTO foods (id, user_id, name, brand, search_text, source, barcode,
     basis_unit, kcal_per_100, protein_g_per_100, carbs_g_per_100, fat_g_per_100,
     created_at, updated_at)
   VALUES ('f1', 'u1', 'Banana', NULL, 'banana', 'openfoodfacts', '0123456789012',
     'g', 89, 1.1, 22.8, 0.3, ?, ?)`,
  now, now,
);

run(
  `INSERT INTO food_portions (id, food_id, label, quantity, amount_in_basis,
     is_default, sort_order, created_at, updated_at)
   VALUES ('p1', 'f1', '1 medium', 1, 118, 1, 0, ?, ?)`,
  now, now,
);

console.log('schema smoke test');

// --- assertions -------------------------------------------------------------
check('FTS index is populated by the insert trigger', () => {
  const hits = all(`SELECT rowid FROM foods_fts WHERE foods_fts MATCH 'banana'`);
  assert.equal(hits.length, 1);
});

check('FTS index follows a rename', () => {
  run(`UPDATE foods SET name = 'Plantain', search_text = 'plantain' WHERE id = 'f1'`);
  assert.equal(all(`SELECT rowid FROM foods_fts WHERE foods_fts MATCH 'banana'`).length, 0);
  assert.equal(all(`SELECT rowid FROM foods_fts WHERE foods_fts MATCH 'plantain'`).length, 1);
  run(`UPDATE foods SET name = 'Banana', search_text = 'banana' WHERE id = 'f1'`);
});

check('a log entry stores its own nutrition snapshot', () => {
  run(
    `INSERT INTO log_entries (id, user_id, log_date, meal, logged_at, food_id,
       name_snapshot, quantity, unit_label, amount_in_basis, basis_unit,
       kcal, protein_g, carbs_g, fat_g, entry_source, created_at, updated_at)
     VALUES ('l1', 'u1', '2026-09-08', 'breakfast', ?, 'f1',
       'Banana', 1, '1 medium', 118, 'g',
       105.02, 1.298, 26.904, 0.354, 'search', ?, ?)`,
    now, now, now,
  );
  const [entry] = all(`SELECT kcal, name_snapshot FROM log_entries WHERE id = 'l1'`);
  assert.equal(entry.name_snapshot, 'Banana');
  assert.equal(entry.kcal, 105.02);
});

check('editing the food does not rewrite logged history', () => {
  run(`UPDATE foods SET kcal_per_100 = 200 WHERE id = 'f1'`);
  const [entry] = all(`SELECT kcal FROM log_entries WHERE id = 'l1'`);
  assert.equal(entry.kcal, 105.02, 'snapshot must be untouched by the food edit');
});

check('deleting the food keeps the entry, clearing only the provenance link', () => {
  run(`DELETE FROM foods WHERE id = 'f1'`);
  const [entry] = all(`SELECT food_id, kcal, name_snapshot FROM log_entries WHERE id = 'l1'`);
  assert.equal(entry.food_id, null);
  assert.equal(entry.kcal, 105.02);
  assert.equal(entry.name_snapshot, 'Banana');
});

check('soft-deleted entries drop out of the daily totals view', () => {
  const before = all(`SELECT kcal FROM v_daily_totals WHERE user_id='u1' AND log_date='2026-09-08'`);
  assert.equal(before[0].kcal, 105.02);
  run(`UPDATE log_entries SET deleted_at = ? WHERE id = 'l1'`, now);
  const after = all(`SELECT kcal FROM v_daily_totals WHERE user_id='u1' AND log_date='2026-09-08'`);
  assert.equal(after.length, 0);
  run(`UPDATE log_entries SET deleted_at = NULL WHERE id = 'l1'`);
});

check('one weight entry per day is enforced', () => {
  run(
    `INSERT INTO weight_entries (id, user_id, log_date, weight_kg, recorded_at, created_at, updated_at)
     VALUES ('w1', 'u1', '2026-09-08', 68.4, ?, ?, ?)`,
    now, now, now,
  );
  assert.throws(
    () => run(
      `INSERT INTO weight_entries (id, user_id, log_date, weight_kg, recorded_at, created_at, updated_at)
       VALUES ('w2', 'u1', '2026-09-08', 68.9, ?, ?, ?)`,
      now, now, now,
    ),
    /UNIQUE/,
  );
});

check('water is append-only, so totals come from a sum', () => {
  for (const [id, ml] of [['a', 250], ['b', 250], ['c', 500]]) {
    run(
      `INSERT INTO water_entries (id, user_id, log_date, amount_ml, logged_at, created_at, updated_at)
       VALUES (?, 'u1', '2026-09-08', ?, ?, ?, ?)`,
      id, ml, now, now, now,
    );
  }
  const [{ total }] = all(
    `SELECT SUM(amount_ml) AS total FROM water_entries
     WHERE user_id='u1' AND log_date='2026-09-08' AND deleted_at IS NULL`,
  );
  assert.equal(total, 1000);
});

check('nonsense values are rejected at the storage layer', () => {
  assert.throws(() => run(
    `INSERT INTO log_entries (id, user_id, log_date, meal, logged_at, name_snapshot,
       quantity, unit_label, kcal, entry_source, created_at, updated_at)
     VALUES ('bad1','u1','2026-09-08','brunch',?, 'X', 1, 'g', 10, 'manual', ?, ?)`,
    now, now, now), /CHECK/, 'unknown meal');

  assert.throws(() => run(
    `INSERT INTO log_entries (id, user_id, log_date, meal, logged_at, name_snapshot,
       quantity, unit_label, kcal, entry_source, created_at, updated_at)
     VALUES ('bad2','u1','2026-09-08','lunch',?, 'X', 0, 'g', 10, 'manual', ?, ?)`,
    now, now, now), /CHECK/, 'zero quantity');

  assert.throws(() => run(
    `INSERT INTO log_entries (id, user_id, log_date, meal, logged_at, name_snapshot,
       quantity, unit_label, kcal, entry_source, created_at, updated_at)
     VALUES ('bad3','u1','2026-09-08','lunch',?, 'X', 1, 'g', -10, 'manual', ?, ?)`,
    now, now, now), /CHECK/, 'negative calories');

  assert.throws(() => run(
    `INSERT INTO daily_goals (id, user_id, effective_date, calorie_target,
       protein_g_target, carbs_g_target, fat_g_target, created_at, updated_at)
     VALUES ('g-bad','u1','2026-09-08', 0, 100, 100, 50, ?, ?)`,
    now, now), /CHECK/, 'zero calorie target');
});

check('goals are effective-dated: the newest row on or before a day wins', () => {
  const rows = [
    ['g1', '2026-09-01', 1800],
    ['g2', '2026-09-05', 1750],
    ['g3', '2026-09-20', 1700],
  ];
  for (const [id, date, kcal] of rows) {
    run(
      `INSERT INTO daily_goals (id, user_id, effective_date, calorie_target,
         protein_g_target, carbs_g_target, fat_g_target, created_at, updated_at)
       VALUES (?, 'u1', ?, ?, 135, 180, 60, ?, ?)`,
      id, date, kcal, now, now,
    );
  }
  const [g] = all(
    `SELECT calorie_target FROM daily_goals
     WHERE user_id='u1' AND effective_date <= '2026-09-08' AND deleted_at IS NULL
     ORDER BY effective_date DESC LIMIT 1`,
  );
  assert.equal(g.calorie_target, 1750, 'a future goal must not apply retroactively');
});

check('the same barcode cannot be cached twice from one source', () => {
  run(
    `INSERT INTO foods (id, name, search_text, source, source_id, barcode,
       kcal_per_100, created_at, updated_at)
     VALUES ('f2', 'Oat Milk', 'oat milk', 'openfoodfacts', 'off-1', '5000000000001', 45, ?, ?)`,
    now, now,
  );
  assert.throws(() => run(
    `INSERT INTO foods (id, name, search_text, source, source_id, barcode,
       kcal_per_100, created_at, updated_at)
     VALUES ('f3', 'Oat Milk dup', 'oat milk dup', 'openfoodfacts', 'off-2', '5000000000001', 45, ?, ?)`,
    now, now), /UNIQUE/);
});

check('a user custom food may reuse a barcode the cache already holds', () => {
  run(
    `INSERT INTO foods (id, user_id, name, search_text, source, barcode,
       kcal_per_100, created_at, updated_at)
     VALUES ('f4', 'u1', 'My Oat Milk', 'my oat milk', 'custom', '5000000000001', 52, ?, ?)`,
    now, now,
  );
  assert.equal(all(`SELECT id FROM foods WHERE barcode='5000000000001' AND deleted_at IS NULL`).length, 2);
});

check('a soft-deleted food frees its barcode for a rescan', () => {
  run(`UPDATE foods SET deleted_at = ? WHERE id = 'f2'`, now);
  run(
    `INSERT INTO foods (id, name, search_text, source, source_id, barcode,
       kcal_per_100, created_at, updated_at)
     VALUES ('f5', 'Oat Milk v2', 'oat milk v2', 'openfoodfacts', 'off-3', '5000000000001', 46, ?, ?)`,
    now, now,
  );
});

check('deleting a recipe cascades to its ingredients', () => {
  run(
    `INSERT INTO recipes (id, user_id, name, search_text, servings, created_at, updated_at)
     VALUES ('r1', 'u1', 'Overnight Oats', 'overnight oats', 4, ?, ?)`,
    now, now,
  );
  run(
    `INSERT INTO recipe_ingredients (id, recipe_id, food_id, quantity, unit_label,
       amount_in_basis, created_at, updated_at)
     VALUES ('ri1', 'r1', 'f4', 1, 'cup', 240, ?, ?)`,
    now, now,
  );
  run(`DELETE FROM recipes WHERE id = 'r1'`);
  assert.equal(all(`SELECT id FROM recipe_ingredients WHERE recipe_id='r1'`).length, 0);
});

check('a food in use by a recipe cannot be hard-deleted out from under it', () => {
  run(
    `INSERT INTO recipes (id, user_id, name, search_text, servings, created_at, updated_at)
     VALUES ('r2', 'u1', 'Smoothie', 'smoothie', 2, ?, ?)`,
    now, now,
  );
  run(
    `INSERT INTO recipe_ingredients (id, recipe_id, food_id, quantity, unit_label,
       amount_in_basis, created_at, updated_at)
     VALUES ('ri2', 'r2', 'f4', 1, 'cup', 240, ?, ?)`,
    now, now,
  );
  assert.throws(() => run(`DELETE FROM foods WHERE id = 'f4'`), /FOREIGN KEY/);
});

check('the meal-totals view groups a day by meal', () => {
  run(
    `INSERT INTO log_entries (id, user_id, log_date, meal, logged_at, name_snapshot,
       quantity, unit_label, kcal, protein_g, carbs_g, fat_g, entry_source, created_at, updated_at)
     VALUES ('l2','u1','2026-09-08','lunch',?, 'Soup', 1, 'bowl', 220, 9, 30, 7, 'manual', ?, ?)`,
    now, now, now,
  );
  const rows = all(
    `SELECT meal, kcal FROM v_daily_meal_totals
     WHERE user_id='u1' AND log_date='2026-09-08' ORDER BY meal`,
  );
  assert.deepEqual(rows.map(r => r.meal), ['breakfast', 'lunch']);
});

console.log(`\n${passed} checks passed`);
