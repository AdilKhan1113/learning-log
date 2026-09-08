import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_MULTIPLIERS,
  ageInYears,
  calculateBmr,
  calculateTdee,
  tdeeFromMetrics,
} from '../../src/domain/nutrition/energy.ts';

/** Rounded comparison, since these are estimates not exact quantities. */
const near = (actual: number, expected: number, tolerance = 0.5) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

describe('Mifflin-St Jeor', () => {
  test('male worked example', () => {
    // 10(80) + 6.25(180) - 5(30) + 5 = 800 + 1125 - 150 + 5
    near(
      calculateBmr({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 }),
      1780,
    );
  });

  test('female worked example', () => {
    // 10(65) + 6.25(165) - 5(30) - 161 = 650 + 1031.25 - 150 - 161
    near(
      calculateBmr({ sex: 'female', weightKg: 65, heightCm: 165, ageYears: 30 }),
      1370.25,
    );
  });

  test('unspecified sits between the two', () => {
    const args = { weightKg: 70, heightCm: 170, ageYears: 35 } as const;
    const male = calculateBmr({ ...args, sex: 'male' });
    const female = calculateBmr({ ...args, sex: 'female' });
    const unspecified = calculateBmr({ ...args, sex: 'unspecified' });
    assert.ok(unspecified < male && unspecified > female);
    near(unspecified, (male + female) / 2);
  });

  test('BMR rises with weight and height, falls with age', () => {
    const base = { sex: 'female', weightKg: 65, heightCm: 165, ageYears: 30 } as const;
    assert.ok(calculateBmr({ ...base, weightKg: 75 }) > calculateBmr(base));
    assert.ok(calculateBmr({ ...base, heightCm: 175 }) > calculateBmr(base));
    assert.ok(calculateBmr({ ...base, ageYears: 50 }) < calculateBmr(base));
  });
});

describe('TDEE', () => {
  test('applies the activity multiplier', () => {
    near(calculateTdee(1800, 'moderate'), 1800 * 1.55);
  });

  test('multipliers increase monotonically', () => {
    const values = Object.values(ACTIVITY_MULTIPLIERS);
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i]! > values[i - 1]!);
    }
  });

  test('end to end from metrics', () => {
    const tdee = tdeeFromMetrics({
      sex: 'male',
      weightKg: 80,
      heightCm: 180,
      ageYears: 30,
      activityLevel: 'sedentary',
    });
    near(tdee, 1780 * 1.2);
  });
});

describe('ageInYears', () => {
  test('counts whole years elapsed', () => {
    assert.equal(ageInYears('1995-04-02', new Date('2026-09-08')), 31);
  });

  test('the birthday itself counts', () => {
    assert.equal(ageInYears('1995-04-02', new Date('2026-04-02')), 31);
  });

  test('the day before it does not', () => {
    assert.equal(ageInYears('1995-04-02', new Date('2026-04-01')), 30);
  });

  test('handles a birthday later in the year', () => {
    assert.equal(ageInYears('1995-12-31', new Date('2026-09-08')), 30);
  });
});
