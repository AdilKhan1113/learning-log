/**
 * The icon generator hard-codes its colours, because it runs as a standalone
 * .mjs script and importing the app's TypeScript palette from it would drag a
 * loader into a build step that has no other need for one. That is a copy, and
 * a copy drifts silently — so this is the test that makes the copy safe.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { palette } from '../../src/ui/theme/colors.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = join(ROOT, 'scripts', 'make-icons.mjs');
const source = readFileSync(GENERATOR, 'utf8');

/** Reads `const NAME = '#RRGGBB';` out of the generator. */
function constant(name: string): string {
  const value = source.match(new RegExp(`const ${name} = '(#[0-9A-Fa-f]{6})'`))?.[1];
  assert.ok(value, `${name} not found in make-icons.mjs`);
  return value;
}

describe('icon generator', () => {
  test('draws with the app palette, not colours of its own', () => {
    assert.equal(constant('BACKGROUND'), palette.background);
    assert.equal(constant('TRACK'), palette.track);
    assert.equal(constant('ACCENT'), palette.accent);
  });

  test('the committed assets match what the generator produces', () => {
    // Fails if someone edits the generator and forgets to re-run it, or edits
    // a PNG by hand. Assets ship in the build, so a stale one is shipped.
    execFileSync('node', [GENERATOR, '--check'], { cwd: ROOT, stdio: 'pipe' });
  });

  test('the Android foreground keeps the mark inside the safe zone', () => {
    // Android shows only the centre 72/108 of an adaptive icon and guarantees
    // just the centre 66/108 circle. The ratio is derived rather than typed,
    // so this pins the derivation itself.
    const visible = Number(source.match(/const VISIBLE_RATIO = ([\d.]+)/)?.[1]);
    const viewport = 72 / 108;
    assert.ok(visible > 0, 'VISIBLE_RATIO not found');
    assert.ok(
      visible * viewport <= 66 / 108,
      `adaptive foreground ${(visible * viewport).toFixed(3)} exceeds the 0.611 safe zone`,
    );
  });
});
