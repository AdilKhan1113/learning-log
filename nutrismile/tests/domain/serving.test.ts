import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FoodLike } from '../../src/domain/types.ts';
import {
  availableUnits,
  divideNutrition,
  nutritionForServing,
  recipePerServing,
  recipeTotals,
  resolveAmountInBasis,
  roundNutrition,
  scaleNutrition,
  sumNutrition,
} from '../../src/domain/nutrition/serving.ts';
import { convertToBasis, feetInchesToCm, lbToKg, toGrams } from '../../src/domain/nutrition/units.ts';

const banana: FoodLike = {
  id: 'f1',
  name: 'Banana',
  per100: { basisUnit: 'g', kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6 },
  portions: [
    { id: 'p1', label: '1 medium', amountInBasis: 118, isDefault: true },
    { id: 'p2', label: '1 large', amountInBasis: 136, isDefault: false },
  ],
};

const milk: FoodLike = {
  id: 'f2',
  name: 'Whole milk',
  per100: { basisUnit: 'ml', kcal: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3 },
  gramsPerMl: 1.03,
};

const flour: FoodLike = {
  id: 'f3',
  name: 'Plain flour',
  per100: { basisUnit: 'g', kcal: 364, proteinG: 10, carbsG: 76, fatG: 1 },
  // no density: volume units cannot be resolved
};

const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);

describe('unit conversion', () => {
  test('ounces to grams', () => near(toGrams(1, 'oz'), 28.3495));
  test('pounds to kilograms', () => near(lbToKg(150), 68.0389));
  test('feet and inches to cm', () => near(feetInchesToCm(5, 9), 175.26));

  test('a cup is US customary, not metric', () => {
    const result = convertToBasis(1, 'cup', 'ml');
    assert.ok(result.ok && Math.abs(result.value - 236.588) < 0.01);
  });

  test('crossing mass and volume without a density is refused, not guessed', () => {
    const result = convertToBasis(1, 'cup', 'g');
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.code === 'density_required');
  });

  test('an unknown unit is reported, not silently zero', () => {
    const result = convertToBasis(1, 'handful', 'g');
    assert.ok(!result.ok && result.error.code === 'unknown_unit');
  });
});

describe('resolving a serving', () => {
  test('a named portion resolves to its gram weight', () => {
    const result = resolveAmountInBasis(banana, 1, '1 medium');
    assert.ok(result.ok && result.value === 118);
  });

  test('two of a portion doubles it', () => {
    const result = resolveAmountInBasis(banana, 2, '1 medium');
    assert.ok(result.ok && result.value === 236);
  });

  test('a portion can be selected by id as well as by label', () => {
    const result = resolveAmountInBasis(banana, 1, 'p2');
    assert.ok(result.ok && result.value === 136);
  });

  test('grams pass straight through', () => {
    const result = resolveAmountInBasis(banana, 150, 'g');
    assert.ok(result.ok && result.value === 150);
  });

  test('ounces convert to the gram basis', () => {
    const result = resolveAmountInBasis(banana, 4, 'oz');
    assert.ok(result.ok);
    if (result.ok) near(result.value, 113.398);
  });

  test('a cup of a food with a density converts', () => {
    const result = resolveAmountInBasis(milk, 1, 'cup');
    assert.ok(result.ok && Math.abs(result.value - 236.588) < 0.01);
  });

  test('a cup of a food without a density is refused', () => {
    const result = resolveAmountInBasis(flour, 1, 'cup');
    assert.ok(!result.ok && result.error.code === 'density_required');
  });

  test('zero and negative quantities are rejected', () => {
    for (const q of [0, -1, Number.NaN]) {
      const result = resolveAmountInBasis(banana, q, 'g');
      assert.ok(!result.ok && result.error.code === 'invalid_quantity');
    }
  });

  test('an unknown portion label is reported', () => {
    const result = resolveAmountInBasis(banana, 1, '1 enormous');
    assert.ok(!result.ok && result.error.code === 'unknown_portion');
  });

  test("a food's own portion wins over the generic unit of the same name", () => {
    const rice: FoodLike = {
      id: 'f4',
      name: 'Cooked rice',
      per100: { basisUnit: 'g', kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 },
      portions: [{ id: 'p', label: 'cup', amountInBasis: 158, isDefault: true }],
    };
    const result = resolveAmountInBasis(rice, 1, 'cup');
    assert.ok(result.ok && result.value === 158, 'should use 158 g, not 236.6 ml');
  });
});

describe('scaling nutrition', () => {
  test('one medium banana', () => {
    const result = nutritionForServing(banana, 1, '1 medium');
    assert.ok(result.ok);
    if (!result.ok) return;
    near(result.value.nutrition.kcal, 105.02);
    near(result.value.nutrition.proteinG, 1.298);
    near(result.value.nutrition.carbsG, 26.904);
    near(result.value.nutrition.fatG, 0.354);
  });

  test('100 g of a per-100 food is exactly the stored values', () => {
    const result = nutritionForServing(banana, 100, 'g');
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.value.nutrition.kcal, 89);
  });

  test('scaling is linear', () => {
    const one = scaleNutrition(banana.per100, 100);
    const three = scaleNutrition(banana.per100, 300);
    near(three.kcal, one.kcal * 3);
  });

  test('an absent micronutrient stays absent rather than becoming zero', () => {
    const scaled = scaleNutrition(milk.per100, 200);
    assert.equal(scaled.fiberG, undefined);
  });

  test('a present micronutrient scales', () => {
    const scaled = scaleNutrition(banana.per100, 200);
    near(scaled.fiberG!, 5.2);
  });
});

describe('the unit picker', () => {
  test("offers the food's named portions first", () => {
    const units = availableUnits(banana);
    assert.equal(units[0]?.label, '1 medium');
    assert.equal(units[0]?.kind, 'portion');
  });

  test('hides volume units for a solid with no density', () => {
    const labels = availableUnits(flour).map((u) => u.label);
    assert.ok(labels.includes('g'));
    assert.ok(!labels.includes('cup'), 'must not offer a conversion it cannot do');
  });

  test('offers volume units once a density is known', () => {
    const labels = availableUnits(milk).map((u) => u.label);
    assert.ok(labels.includes('cup'));
    assert.ok(labels.includes('g'), 'density also unlocks mass for an ml-basis food');
  });

  test('always marks exactly one default', () => {
    for (const food of [banana, milk, flour]) {
      const defaults = availableUnits(food).filter((u) => u.isDefault);
      assert.equal(defaults.length, 1, food.name);
    }
  });

  test('falls back to the basis unit when the food has no portions', () => {
    const units = availableUnits(flour);
    assert.equal(units.find((u) => u.isDefault)?.label, 'g');
  });
});

describe('summing', () => {
  test('an empty day is all zeroes, not NaN', () => {
    const total = sumNutrition([]);
    assert.deepEqual(
      { kcal: total.kcal, proteinG: total.proteinG, carbsG: total.carbsG, fatG: total.fatG },
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
  });

  test('adds the core macros', () => {
    const total = sumNutrition([
      { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
      { kcal: 250, proteinG: 20, carbsG: 15, fatG: 8 },
    ]);
    assert.equal(total.kcal, 350);
    assert.equal(total.proteinG, 25);
  });

  test('fibre stays undefined when nothing reported it', () => {
    const total = sumNutrition([
      { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
      { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
    ]);
    assert.equal(total.fiberG, undefined, 'an unknown value must not read as zero');
  });

  test('fibre sums the foods that did report it', () => {
    const total = sumNutrition([
      { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 3 },
      { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
      { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 1.5 },
    ]);
    near(total.fiberG!, 4.5);
  });
});

describe('recipes', () => {
  const ingredients = [
    { per100: banana.per100, amountInBasis: 236 }, // two bananas
    { per100: milk.per100, amountInBasis: 250 },
  ];

  test('totals are the sum of the ingredients', () => {
    const total = recipeTotals(ingredients);
    near(total.kcal, 89 * 2.36 + 61 * 2.5);
  });

  test('per serving divides the total', () => {
    const total = recipeTotals(ingredients);
    const perServing = recipePerServing(ingredients, 2);
    assert.ok(perServing.ok);
    if (perServing.ok) near(perServing.value.kcal, total.kcal / 2);
  });

  test('zero servings is refused rather than dividing by zero', () => {
    const result = recipePerServing(ingredients, 0);
    assert.ok(!result.ok && result.error.code === 'invalid_quantity');
  });

  test('an empty recipe is zero, not NaN', () => {
    const result = recipePerServing([], 4);
    assert.ok(result.ok && result.value.kcal === 0);
  });

  test('dividing preserves absent micronutrients', () => {
    const divided = divideNutrition({ kcal: 100, proteinG: 4, carbsG: 4, fatG: 4 }, 2);
    assert.equal(divided.fiberG, undefined);
    assert.equal(divided.kcal, 50);
  });
});

describe('rounding for storage', () => {
  test('trims float noise to two decimals', () => {
    const rounded = roundNutrition({
      kcal: 105.02000000000001,
      proteinG: 1.2980000000000003,
      carbsG: 26.904,
      fatG: 0.354,
    });
    assert.equal(rounded.kcal, 105.02);
    assert.equal(rounded.proteinG, 1.3);
  });

  test('leaves absent values absent', () => {
    const rounded = roundNutrition({ kcal: 1.005, proteinG: 0, carbsG: 0, fatG: 0 });
    assert.equal(rounded.fiberG, undefined);
  });
});
