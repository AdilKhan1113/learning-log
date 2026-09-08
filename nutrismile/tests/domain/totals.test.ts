import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEALS,
  dayProgress,
  dayTotals,
  macroDistribution,
  waterProgress,
} from '../../src/domain/nutrition/totals.ts';

const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);

const entries = [
  { meal: 'breakfast' as const, nutrition: { kcal: 320, proteinG: 12, carbsG: 44, fatG: 9 } },
  { meal: 'breakfast' as const, nutrition: { kcal: 90, proteinG: 1, carbsG: 23, fatG: 0.3 } },
  { meal: 'lunch' as const, nutrition: { kcal: 640, proteinG: 38, carbsG: 60, fatG: 24 } },
  { meal: 'snacks' as const, nutrition: { kcal: 180, proteinG: 6, carbsG: 20, fatG: 8 } },
];

describe('day totals', () => {
  test('sums the whole day', () => {
    const totals = dayTotals(entries);
    assert.equal(totals.total.kcal, 1230);
    assert.equal(totals.entryCount, 4);
  });

  test('groups by meal', () => {
    const totals = dayTotals(entries);
    assert.equal(totals.byMeal.breakfast.kcal, 410);
    assert.equal(totals.byMeal.lunch.kcal, 640);
    assert.equal(totals.byMeal.snacks.kcal, 180);
  });

  test('a meal with nothing in it is zero, and still present', () => {
    const totals = dayTotals(entries);
    assert.equal(totals.byMeal.dinner.kcal, 0);
    for (const meal of MEALS) {
      assert.ok(totals.byMeal[meal], `${meal} must always be present`);
    }
  });

  test('an empty day is all zeroes', () => {
    const totals = dayTotals([]);
    assert.equal(totals.total.kcal, 0);
    assert.equal(totals.entryCount, 0);
  });
});

describe('progress', () => {
  const targets = {
    calorieTarget: 1800,
    proteinGTarget: 135,
    carbsGTarget: 180,
    fatGTarget: 60,
  };

  test('reports consumed, target, difference and ratio', () => {
    const progress = dayProgress(dayTotals(entries).total, targets);
    assert.equal(progress.calories.consumed, 1230);
    assert.equal(progress.calories.target, 1800);
    assert.equal(progress.calories.difference, -570);
    near(progress.calories.ratio, 1230 / 1800);
  });

  test('passing the target is reported plainly, not clamped or flagged', () => {
    const over = dayProgress({ kcal: 2200, proteinG: 150, carbsG: 200, fatG: 80 }, targets);
    assert.equal(over.calories.difference, 400);
    assert.ok(over.calories.ratio > 1, 'the ratio must exceed 1 so the UI can draw it');
  });

  test('a zero target does not divide by zero', () => {
    const progress = dayProgress(
      { kcal: 500, proteinG: 20, carbsG: 50, fatG: 15 },
      { calorieTarget: 0, proteinGTarget: 0, carbsGTarget: 0, fatGTarget: 0 },
    );
    assert.equal(progress.calories.ratio, 0);
    assert.ok(Number.isFinite(progress.calories.ratio));
  });
});

describe('macro distribution', () => {
  test('percentages sum to 100', () => {
    const dist = macroDistribution({ kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
    near(dist.proteinPct + dist.carbsPct + dist.fatPct, 100);
  });

  test('uses calories, not grams', () => {
    // Equal grams of fat and carbs are not equal shares: fat is 9 kcal/g.
    const dist = macroDistribution({ kcal: 0, proteinG: 0, carbsG: 100, fatG: 100 });
    near(dist.carbsPct, (400 / 1300) * 100);
    near(dist.fatPct, (900 / 1300) * 100);
  });

  test('an empty day is zeroes, not NaN', () => {
    const dist = macroDistribution({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    assert.deepEqual(dist, { proteinPct: 0, carbsPct: 0, fatPct: 0 });
  });
});

describe('water', () => {
  test('tracks millilitres against the target', () => {
    const progress = waterProgress(1500, 2000);
    assert.equal(progress.difference, -500);
    near(progress.ratio, 0.75);
  });
});
