import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { OffProduct } from '../../src/services/openfoodfacts/types.ts';
import {
  detectBasisUnit,
  energyKcalPer100,
  mapProduct,
  mapProducts,
  parseServingSize,
  sodiumMgPer100,
} from '../../src/services/openfoodfacts/normalize.ts';

const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);

/** A well-formed product, as OFF returns them at their best. */
const yogurt: OffProduct = {
  code: '5000000000017',
  product_name: 'Greek Style Yogurt',
  brands: 'Arla, Arla Foods',
  serving_size: '150 g',
  quantity: '500 g',
  nutriments: {
    'energy-kcal_100g': 133,
    proteins_100g: 5.2,
    carbohydrates_100g: 4.6,
    fat_100g: 10.2,
    sugars_100g: 4.6,
    'saturated-fat_100g': 7,
    salt_100g: 0.12,
  },
};

describe('energy', () => {
  test('uses the kcal field when present', () => {
    assert.equal(energyKcalPer100({ 'energy-kcal_100g': 133 }), 133);
  });

  test('converts kilojoules when kcal is missing', () => {
    near(energyKcalPer100({ 'energy-kj_100g': 556 })!, 132.89);
  });

  test('treats the generic energy field as kilojoules', () => {
    near(energyKcalPer100({ energy_100g: 556 })!, 132.89);
  });

  test('respects an explicit kcal unit on the generic field', () => {
    assert.equal(energyKcalPer100({ energy_100g: 133, energy_unit: 'kcal' }), 133);
  });

  test('prefers kcal over kJ when both are present', () => {
    assert.equal(energyKcalPer100({ 'energy-kcal_100g': 100, 'energy-kj_100g': 999 }), 100);
  });

  test('zero energy is a real value, not a missing one', () => {
    assert.equal(energyKcalPer100({ 'energy-kcal_100g': 0 }), 0);
  });

  test('missing energy is null', () => {
    assert.equal(energyKcalPer100({}), null);
  });

  test('negative and non-numeric energy is rejected', () => {
    assert.equal(energyKcalPer100({ 'energy-kcal_100g': -50 }), null);
    assert.equal(energyKcalPer100({ 'energy-kcal_100g': 'lots' as never }), null);
    assert.equal(energyKcalPer100({ 'energy-kcal_100g': Number.NaN }), null);
  });
});

describe('sodium', () => {
  test('OFF records sodium in grams, so it is scaled to mg', () => {
    assert.equal(sodiumMgPer100({ sodium_100g: 0.4 }), 400);
  });

  test('falls back to salt, divided by 2.5', () => {
    near(sodiumMgPer100({ salt_100g: 1 })!, 400);
  });

  test('prefers sodium over salt when both are given', () => {
    assert.equal(sodiumMgPer100({ sodium_100g: 0.4, salt_100g: 5 }), 400);
  });

  test('absent when neither is recorded', () => {
    assert.equal(sodiumMgPer100({}), null);
  });
});

describe('basis unit', () => {
  test('a solid is measured per 100 g', () => {
    assert.equal(detectBasisUnit({ quantity: '500 g' }), 'g');
  });

  test('a drink is measured per 100 ml', () => {
    assert.equal(detectBasisUnit({ quantity: '1 l' }), 'ml');
    assert.equal(detectBasisUnit({ quantity: '330 ml' }), 'ml');
  });

  test('the serving size is used when the package size says nothing', () => {
    assert.equal(detectBasisUnit({ serving_size: '250 ml' }), 'ml');
  });

  test('defaults to grams when nothing indicates otherwise', () => {
    assert.equal(detectBasisUnit({}), 'g');
  });

  test('a gram figure does not make a drink of a solid', () => {
    assert.equal(detectBasisUnit({ quantity: '500 g', serving_size: '30 g' }), 'g');
  });
});

describe('serving sizes', () => {
  test('a plain gram serving', () => {
    assert.equal(parseServingSize('30 g', 'g'), 30);
    assert.equal(parseServingSize('30g', 'g'), 30);
  });

  test('prefers the measurement in brackets over a count', () => {
    // "2 biscuits" is a count, not a measurement; 25 g is the real amount.
    assert.equal(parseServingSize('2 biscuits (25 g)', 'g'), 25);
  });

  test('a volume serving on a volume-basis food', () => {
    assert.equal(parseServingSize('250 ml', 'ml'), 250);
  });

  test('a cup resolves to millilitres', () => {
    near(parseServingSize('1 cup (240 ml)', 'ml')!, 240);
  });

  test('ounces convert to grams', () => {
    near(parseServingSize('1 oz (28 g)', 'g')!, 28);
  });

  test('decimal commas are handled', () => {
    near(parseServingSize('28,3 g', 'g')!, 28.3);
  });

  test('a volume serving for a mass-basis food yields null, not a guess', () => {
    assert.equal(parseServingSize('1 cup', 'g'), null);
  });

  test('unparseable text yields null', () => {
    assert.equal(parseServingSize('1 biscuit', 'g'), null);
    assert.equal(parseServingSize('', 'g'), null);
    assert.equal(parseServingSize(undefined, 'g'), null);
  });

  test('a zero serving is not a serving', () => {
    assert.equal(parseServingSize('0 g', 'g'), null);
  });
});

describe('mapping a product', () => {
  test('maps a complete product', () => {
    const result = mapProduct(yogurt);
    assert.ok(result.ok);
    if (!result.ok) return;

    const food = result.value;
    assert.equal(food.name, 'Greek Style Yogurt');
    assert.equal(food.brand, 'Arla', 'only the first brand is kept');
    assert.equal(food.basisUnit, 'g');
    assert.equal(food.kcalPer100, 133);
    assert.equal(food.proteinGPer100, 5.2);
    near(food.sodiumMgPer100!, 48);
    assert.equal(food.barcode, '5000000000017');
  });

  test('records the serving as a portion', () => {
    const result = mapProduct(yogurt);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.portions.length, 1);
    assert.equal(result.value.portions[0]?.amountInBasis, 150);
  });

  test('missing macros become zero, missing micros stay absent', () => {
    const result = mapProduct({
      code: '1',
      product_name: 'Sparkling water',
      nutriments: { 'energy-kcal_100g': 0 },
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.proteinGPer100, 0);
    assert.equal(result.value.fiberGPer100, null, 'unknown fibre must not read as zero');
  });

  test('falls back through the name fields', () => {
    const result = mapProduct({
      code: '1',
      product_name: '   ',
      generic_name: 'Rolled oats',
      nutriments: { 'energy-kcal_100g': 379 },
    });
    assert.ok(result.ok && result.value.name === 'Rolled oats');
  });

  test('a non-numeric code is not treated as a barcode', () => {
    const result = mapProduct({
      code: 'abc-123',
      product_name: 'Something',
      nutriments: { 'energy-kcal_100g': 100 },
    });
    assert.ok(result.ok && result.value.barcode === null);
    assert.ok(result.ok && result.value.sourceId === 'abc-123');
  });
});

describe('rejecting products that would poison the catalogue', () => {
  const base = { code: '1', product_name: 'X' };

  test('no code', () => {
    const result = mapProduct({ product_name: 'X', nutriments: { 'energy-kcal_100g': 1 } });
    assert.ok(!result.ok && result.error.code === 'no_code');
  });

  test('no name', () => {
    const result = mapProduct({ code: '1', nutriments: { 'energy-kcal_100g': 1 } });
    assert.ok(!result.ok && result.error.code === 'no_name');
  });

  test('no energy at all', () => {
    const result = mapProduct({ ...base, nutriments: { proteins_100g: 5 } });
    assert.ok(!result.ok && result.error.code === 'no_energy');
  });

  test('missing nutriments entirely', () => {
    const result = mapProduct(base);
    assert.ok(!result.ok && result.error.code === 'no_energy');
  });

  test('energy beyond what any food contains', () => {
    // A per-package value entered as if it were per 100 g.
    const result = mapProduct({ ...base, nutriments: { 'energy-kcal_100g': 2400 } });
    assert.ok(!result.ok && result.error.code === 'implausible');
  });

  test('more than 100 g of one macro per 100 g', () => {
    const result = mapProduct({
      ...base,
      nutriments: { 'energy-kcal_100g': 400, proteins_100g: 150 },
    });
    assert.ok(!result.ok && result.error.code === 'implausible');
  });

  test('macros summing past 100 g per 100 g', () => {
    const result = mapProduct({
      ...base,
      nutriments: {
        'energy-kcal_100g': 500,
        proteins_100g: 40,
        carbohydrates_100g: 40,
        fat_100g: 40,
      },
    });
    assert.ok(!result.ok && result.error.code === 'implausible');
  });

  test('macros with no energy recorded', () => {
    const result = mapProduct({
      ...base,
      nutriments: { 'energy-kcal_100g': 0, proteins_100g: 20, carbohydrates_100g: 30 },
    });
    assert.ok(!result.ok && result.error.code === 'implausible');
  });

  test('rounding slack is allowed, so real foods are not rejected', () => {
    // Pure oil: 100 g of fat per 100 g, at 884 kcal.
    const result = mapProduct({
      ...base,
      nutriments: { 'energy-kcal_100g': 884, fat_100g: 100 },
    });
    assert.ok(result.ok, 'olive oil must map');
  });

  test('a genuinely zero-calorie drink is kept', () => {
    const result = mapProduct({
      code: '1',
      product_name: 'Still water',
      quantity: '500 ml',
      nutriments: { 'energy-kcal_100g': 0 },
    });
    assert.ok(result.ok && result.value.basisUnit === 'ml');
  });
});

describe('mapping a page', () => {
  test('keeps the good products and counts the rest by reason', () => {
    const page = mapProducts([
      yogurt,
      { code: '2', nutriments: { 'energy-kcal_100g': 100 } }, // no name
      { code: '3', product_name: 'Y' }, // no energy
      { code: '4', product_name: 'Z', nutriments: { 'energy-kcal_100g': 5000 } },
      { product_name: 'W', nutriments: { 'energy-kcal_100g': 100 } }, // no code
    ]);

    assert.equal(page.foods.length, 1);
    const byCode = Object.fromEntries(page.skipped.map((s) => [s.code, s.count]));
    assert.deepEqual(byCode, { no_name: 1, no_energy: 1, implausible: 1, no_code: 1 });
  });

  test('one bad product never fails the whole page', () => {
    const page = mapProducts([{ code: 'x' }, yogurt]);
    assert.equal(page.foods.length, 1);
  });

  test('an empty page is empty, not an error', () => {
    assert.deepEqual(mapProducts([]), { foods: [], skipped: [] });
  });
});
