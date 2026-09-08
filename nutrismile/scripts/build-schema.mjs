/**
 * Generates src/db/schema/init.ts from src/db/schema/001_init.sql.
 *
 * Metro cannot require a .sql file at runtime, but a schema duplicated by hand
 * drifts. So the .sql file stays the single source of truth and this script
 * emits a TypeScript copy of it. `npm run check:schema` fails if the emitted
 * file is out of date, which is what keeps the two honest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = join(root, 'src/db/schema/001_init.sql');
const outPath = join(root, 'src/db/schema/init.ts');

const sql = readFileSync(sqlPath, 'utf8');

const output = `// GENERATED FILE — do not edit.
// Source: src/db/schema/001_init.sql
// Regenerate with: npm run build:schema

export const INIT_SQL = ${JSON.stringify(sql)};
`;

const mode = process.argv[2];
if (mode === '--check') {
  let current = '';
  try {
    current = readFileSync(outPath, 'utf8');
  } catch {
    /* missing counts as out of date */
  }
  if (current !== output) {
    console.error(
      'src/db/schema/init.ts is out of date with 001_init.sql.\nRun: npm run build:schema',
    );
    process.exit(1);
  }
  console.log('schema in sync');
} else {
  writeFileSync(outPath, output);
  console.log(`wrote ${outPath} (${sql.length} chars of SQL)`);
}
