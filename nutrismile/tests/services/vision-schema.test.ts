import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeDropReason,
  parseMealEstimate,
  rescaleFood,
  validateFood,
} from '../../src/services/vision/schema.ts';

/** A plausible, internally consistent item. */
const chicken = {
  name: 'Grilled chicken breast',
  grams: 150,
  kcal: 248,
  proteinG: 46.5,
  carbsG: 0,
  fatG: 5.4,
  confidence: 0.8,
};

const rice = {
  name: 'White rice',
  grams: 180,
  kcal: 234,
  proteinG: 4.9,
  carbsG: 50.4,
  fatG: 0.5,
  confidence: 0.6,
};

describe('validating one item', () => {
  test('accepts a consistent item', () => {
    const result = validateFood(chicken, 0);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.value.name, 'Grilled chicken breast');
  });

  test('gives each item a stable id for the review list', () => {
    const a = validateFood(chicken, 0);
    const b = validateFood(chicken, 0);
    assert.ok(a.ok && b.ok && a.value.id === b.value.id);
  });

  test('rejects an item with no name', () => {
    assert.equal(validateFood({ ...chicken, name: '  ' }, 0).ok, false);
    assert.equal(validateFood({ ...chicken, name: 42 }, 0).ok, false);
  });

  test('rejects a portion that is zero, negative or absurd', () => {
    for (const grams of [0, -100, 99999]) {
      const result = validateFood({ ...chicken, grams }, 0);
      assert.ok(!result.ok && result.error === 'bad_portion', String(grams));
    }
  });

  test('rejects calories no food could contain for its weight', () => {
    // 150g of anything cannot be 5000 kcal.
    const result = validateFood({ ...chicken, kcal: 5000 }, 0);
    assert.ok(!result.ok && result.error === 'bad_energy');
  });

  test('rejects macros that outweigh the food', () => {
    const result = validateFood(
      { ...chicken, grams: 100, kcal: 400, proteinG: 60, carbsG: 60, fatG: 40 },
      0,
    );
    assert.ok(!result.ok && result.error === 'impossible_macros');
  });

  test('rejects an item whose calories and macros disagree by a factor', () => {
    // Macros imply ~248 kcal; the model said 900.
    const result = validateFood({ ...chicken, kcal: 900 }, 0);
    assert.ok(!result.ok && result.error === 'energy_mismatch');
  });

  test('tolerates the ordinary gap between stated and implied calories', () => {
    // Fibre and rounding move the real figure; 10% off must still pass.
    const result = validateFood({ ...chicken, kcal: 273 }, 0);
    assert.ok(result.ok, 'a plausible item must not be discarded');
  });

  test('a zero-calorie item with no macros is allowed', () => {
    const result = validateFood(
      { name: 'Black coffee', grams: 240, kcal: 2, proteinG: 0, carbsG: 0, fatG: 0 },
      0,
    );
    assert.ok(result.ok);
  });

  test('missing macros default to zero rather than failing the item', () => {
    const result = validateFood({ name: 'Apple', grams: 150, kcal: 78 }, 0);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.value.proteinG, 0);
  });

  test('a number sent as a string is still read', () => {
    const result = validateFood({ ...chicken, grams: '150' }, 0);
    assert.ok(result.ok && result.value.grams === 150);
  });

  test('confidence is clamped, not rejected', () => {
    const high = validateFood({ ...chicken, confidence: 5 }, 0);
    const low = validateFood({ ...chicken, confidence: -2 }, 0);
    assert.ok(high.ok && high.value.confidence === 1);
    assert.ok(low.ok && low.value.confidence === 0);
  });

  test('missing confidence becomes a neutral value', () => {
    const { confidence: _omitted, ...withoutConfidence } = chicken;
    const result = validateFood(withoutConfidence, 0);
    assert.ok(result.ok && result.value.confidence === 0.5);
  });

  test('a non-object item is rejected rather than crashing', () => {
    for (const junk of [null, 'chicken', 42, []]) {
      assert.equal(validateFood(junk, 0).ok, false);
    }
  });
});

describe('parsing a whole response', () => {
  test('accepts a normal response', () => {
    const result = parseMealEstimate({
      foods: [chicken, rice],
      confidence: 0.7,
      note: null,
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.foods.length, 2);
    assert.equal(result.value.confidence, 0.7);
  });

  test('keeps the good items and counts the dropped ones', () => {
    const result = parseMealEstimate({
      foods: [chicken, { name: '', grams: 10 }, { ...rice, grams: -1 }],
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.foods.length, 1);
    assert.equal(result.value.dropped.length, 2);
  });

  test('a response with nothing usable is an error, not an empty plate', () => {
    const result = parseMealEstimate({ foods: [{ name: '' }, { name: '' }] });
    assert.ok(!result.ok && result.error.code === 'all_dropped');
  });

  test('an empty list is reported as no foods found', () => {
    const result = parseMealEstimate({ foods: [] });
    assert.ok(!result.ok && result.error.code === 'no_foods');
  });

  test('anything that is not a response shape is malformed', () => {
    for (const junk of [null, 'text', 42, {}, { foods: 'chicken' }]) {
      const result = parseMealEstimate(junk);
      assert.ok(!result.ok, JSON.stringify(junk));
    }
  });

  test('overall confidence falls back to the least confident item', () => {
    const result = parseMealEstimate({
      foods: [
        { ...chicken, confidence: 0.9 },
        { ...rice, confidence: 0.3 },
      ],
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.confidence, 0.3, 'a plate is as certain as its worst item');
    }
  });

  test('the source is left for the client to fill in, not read from the model', () => {
    const result = parseMealEstimate({
      foods: [chicken],
      // A model claiming to be something else must not be believed.
      provider: 'not-a-provider',
      model: 'made-up',
    });
    assert.ok(result.ok && result.value.source === null);
  });

  test("the model's note about a difficult photo is kept", () => {
    const result = parseMealEstimate({
      foods: [chicken],
      note: 'The sauce is hard to identify.',
    });
    assert.ok(result.ok && result.value.note === 'The sauce is hard to identify.');
  });

  test('every drop reason has a description', () => {
    const reasons = [
      'no_name',
      'bad_portion',
      'bad_energy',
      'impossible_macros',
      'energy_mismatch',
    ] as const;
    for (const reason of reasons) {
      assert.ok(describeDropReason(reason).length > 0, reason);
    }
  });
});

describe('correcting a portion', () => {
  test('nutrition scales with the portion', () => {
    const parsed = validateFood(chicken, 0);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;

    const doubled = rescaleFood(parsed.value, 300);
    assert.equal(doubled.grams, 300);
    assert.ok(Math.abs(doubled.kcal - 496) < 1);
    assert.ok(Math.abs(doubled.proteinG - 93) < 1);
  });

  test('halving works as well as doubling', () => {
    const parsed = validateFood(chicken, 0);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      const half = rescaleFood(parsed.value, 75);
      assert.ok(Math.abs(half.kcal - 124) < 1);
    }
  });

  test('the name and confidence are untouched by a portion change', () => {
    const parsed = validateFood(chicken, 0);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      const scaled = rescaleFood(parsed.value, 200);
      assert.equal(scaled.name, parsed.value.name);
      assert.equal(scaled.confidence, parsed.value.confidence);
      assert.equal(scaled.id, parsed.value.id);
    }
  });

  test('a nonsense portion leaves the item alone rather than zeroing it', () => {
    const parsed = validateFood(chicken, 0);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      for (const grams of [0, -50, Number.NaN]) {
        assert.deepEqual(rescaleFood(parsed.value, grams), parsed.value);
      }
    }
  });
});
