/**
 * Every SQL statement in src/db/repositories is prepared against the real
 * schema.
 *
 * The repositories cannot run under Node — they import expo-sqlite and
 * expo-crypto — but their SQL is just text, and SQLite's prepare step resolves
 * every table, column and function name in it. So a typo like `log_entires` or
 * a column that does not exist fails here rather than on a device.
 *
 * This checks that each statement is valid against the schema. It does not
 * check that the statement does the right thing; that is what the smoke test
 * and the domain tests are for.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = join(here, '../../src/db/repositories');

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(here, '../../src/db/schema/001_init.sql'), 'utf8'));

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|PRAGMA|WITH)\b/i;
// A statement needs a clause keyword too, so bare words that happen to be SQL
// verbs — the 'delete' passed as a sync op, say — are not mistaken for queries.
const SQL_CLAUSE = /\b(FROM|INTO|SET|VALUES|TABLE|PRAGMA)\b/i;

/** Pull every string and template literal that looks like SQL out of a file. */
function extractSql(source) {
  const found = [];

  // Template literals, which is how the multi-line queries are written.
  for (const match of source.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
    found.push(match[1]);
  }
  // Single-quoted one-liners.
  for (const match of source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
    found.push(match[1]);
  }

  return found.filter((s) => SQL_START.test(s) && SQL_CLAUSE.test(s));
}

const files = readdirSync(repoDir).filter((f) => f.endsWith('.ts'));
assert.ok(files.length > 0, 'no repository files found');

let prepared = 0;
let skipped = 0;

describe('repository SQL', () => {
  for (const file of files) {
    const source = readFileSync(join(repoDir, file), 'utf8');
    const statements = extractSql(source);

    for (const [index, sql] of statements.entries()) {
      // Statements built by interpolation cannot be prepared as written.
      // users.update is the only one, and its column names come from a typed
      // Record so a bad name is a compile error rather than a runtime one.
      if (sql.includes('${')) {
        skipped++;
        continue;
      }

      test(`${file} #${index + 1}: ${sql.trim().split('\n')[0].slice(0, 60)}`, () => {
        try {
          db.prepare(sql).finalize?.();
          prepared++;
        } catch (error) {
          assert.fail(`${error.message}\n\n${sql.trim()}`);
        }
      });
    }
  }

  test('every repository file contributed at least one statement', () => {
    for (const file of files) {
      if (file === 'index.ts' || file === 'mappers.ts') continue;
      const statements = extractSql(readFileSync(join(repoDir, file), 'utf8'));
      assert.ok(statements.length > 0, `${file} yielded no SQL — did extraction break?`);
    }
  });

  test('coverage is reported so a silent extraction failure is visible', () => {
    console.log(`    prepared ${prepared} statements, skipped ${skipped} interpolated`);
    assert.ok(prepared >= 20, `only ${prepared} statements prepared`);
  });
});
