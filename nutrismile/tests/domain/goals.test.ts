import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { BodyMetrics } from '../../src/domain/types.ts';
import {
  BMR_FLOOR_RATIO,
  KCAL_PER_G,
  KCAL_PER_KG,
  MAX_RATE_KG_WEEK,
  calculateCalorieTarget,
  calculateMacroSplit,
  calorieFloor,
  macroPercentages,
  suggestTargets,
  targetsFromPercentages,
  validateManualTarget,
} from '../../src/domain/nutrition/goals.ts';
import { calculateBmr } from '../../src/domain/nutrition/energy.ts';

const adult: BodyMetrics = {
  sex: 'female',
  ageYears: 30,
  heightCm: 165,
  weightKg: 65,
  activityLevel: 'moderate',
};

describe('calorie floor', () => {
  test('women floor at 1200 when BMR is low enough', () => {
    const { floor, boundBy } = calorieFloor('female', 1200);
    assert.equal(floor, 1200);
    assert.equal(boundBy, 'absolute'); // 85% of 1200 is 1020, below 1200
  });

  test('men floor at 1500', () => {
    const { floor, boundBy } = calorieFloor('male', 1500);
    assert.equal(floor, 1500);
    assert.equal(boundBy, 'absolute'); // 85% of 1500 is 1275
  });

  test('the 85%-of-BMR rule binds for a larger body', () => {
    const { floor, boundBy } = calorieFloor('female', 2000);
    assert.equal(floor, 2000 * BMR_FLOOR_RATIO);
    assert.equal(boundBy, 'bmr');
    assert.ok(floor > 1200, 'the proportional rule must be able to exceed 1200');
  });

  test('unspecified uses the lower absolute floor', () => {
    assert.equal(calorieFloor('unspecified', 1000).absoluteFloor, 1200);
  });
});

describe('calorie target', () => {
  test('maintain lands on TDEE', () => {
    const result = calculateCalorieTarget(adult, 'maintain');
    assert.equal(result.calorieTarget, Math.round(result.tdee / 10) * 10);
    assert.equal(result.requestedDailyDelta, 0);
    assert.equal(result.floorApplied, false);
  });

  test('losing 0.5 kg a week is a 550 kcal daily deficit', () => {
    const result = calculateCalorieTarget(adult, 'lose', -0.5);
    assert.equal(result.requestedDailyDelta, (-0.5 * KCAL_PER_KG) / 7);
    assert.ok(Math.abs(result.requestedDailyDelta + 550) < 1);
    assert.ok(result.calorieTarget < result.tdee);
  });

  test('gaining produces a surplus', () => {
    const result = calculateCalorieTarget(adult, 'gain', 0.25);
    assert.ok(result.calorieTarget > result.tdee);
  });

  test('maintain ignores a rate that was passed anyway', () => {
    const result = calculateCalorieTarget(adult, 'maintain', -0.75);
    assert.equal(result.rateKgWeek, 0);
  });

  test('rates are clamped to 1 kg per week', () => {
    const result = calculateCalorieTarget(adult, 'lose', -5);
    assert.equal(result.rateKgWeek, -MAX_RATE_KG_WEEK);
  });

  test('targets are rounded to the nearest 10', () => {
    const result = calculateCalorieTarget(adult, 'lose', -0.43);
    assert.equal(result.calorieTarget % 10, 0);
  });
});

describe('the floor is never breached', () => {
  // A small, sedentary person asking for the fastest loss: the arithmetic
  // wants to go far below what the app will set.
  const small: BodyMetrics = {
    sex: 'female',
    ageYears: 55,
    heightCm: 152,
    weightKg: 50,
    activityLevel: 'sedentary',
  };

  test('an aggressive deficit is raised to the floor', () => {
    const result = calculateCalorieTarget(small, 'lose', -1);
    const unflooredTarget = result.tdee + result.requestedDailyDelta;

    assert.ok(unflooredTarget < result.floor.floor, 'precondition: raw target is under the floor');
    assert.equal(result.floorApplied, true);
    assert.ok(result.calorieTarget >= result.floor.floor);
  });

  test('the reported deficit is the achievable one, not the requested one', () => {
    const result = calculateCalorieTarget(small, 'lose', -1);
    assert.notEqual(result.effectiveDailyDelta, result.requestedDailyDelta);
    assert.ok(
      result.effectiveDailyDelta > result.requestedDailyDelta,
      'flooring must shrink the deficit, never deepen it',
    );
    assert.ok(Math.abs(result.effectiveDailyDelta - (result.calorieTarget - result.tdee)) < 1e-9);
  });

  test('no metrics produce a target below the floor', () => {
    const sexes = ['female', 'male', 'unspecified'] as const;
    for (const sex of sexes) {
      for (const weightKg of [40, 50, 65, 90, 140]) {
        for (const ageYears of [18, 35, 70]) {
          const metrics: BodyMetrics = {
            sex,
            ageYears,
            heightCm: 160,
            weightKg,
            activityLevel: 'sedentary',
          };
          const result = calculateCalorieTarget(metrics, 'lose', -1);
          const { floor } = calorieFloor(sex, calculateBmr(metrics));
          assert.ok(
            result.calorieTarget >= floor,
            `${sex} ${weightKg}kg ${ageYears}y: ${result.calorieTarget} < ${floor}`,
          );
        }
      }
    }
  });

  test('rounding to the nearest 10 cannot drop under the floor', () => {
    // Contrive a floor that does not sit on a multiple of 10.
    const metrics: BodyMetrics = {
      sex: 'female',
      ageYears: 30,
      heightCm: 163,
      weightKg: 58,
      activityLevel: 'sedentary',
    };
    const result = calculateCalorieTarget(metrics, 'lose', -1);
    assert.ok(result.calorieTarget >= result.floor.floor);
  });
});

describe('macro split', () => {
  test('macros add back up to the calorie target', () => {
    const split = calculateMacroSplit(2000, 70, 'maintain');
    const kcal =
      split.proteinGTarget * 4 + split.carbsGTarget * 4 + split.fatGTarget * 9;
    assert.ok(Math.abs(kcal - 2000) < 5, `got ${kcal}`);
    assert.equal(split.compressed, false);
  });

  test('protein scales with body weight', () => {
    const light = calculateMacroSplit(2000, 55, 'maintain');
    const heavy = calculateMacroSplit(2000, 95, 'maintain');
    assert.ok(heavy.proteinGTarget > light.proteinGTarget);
  });

  test('a deficit sets protein higher than maintenance', () => {
    const losing = calculateMacroSplit(2000, 70, 'lose');
    const maintaining = calculateMacroSplit(2000, 70, 'maintain');
    assert.ok(losing.proteinGTarget > maintaining.proteinGTarget);
  });

  test('fat never falls below the essential minimum', () => {
    const split = calculateMacroSplit(1200, 70, 'lose');
    assert.ok(split.fatGTarget >= 0.6 * 70 - 0.1);
  });

  test('protein is held to a share of calories at higher body weights', () => {
    // Anchoring 1.8 g/kg to total body weight gives 211g here, which is 41% of
    // the day's calories and leaves little room for carbohydrate.
    const split = calculateMacroSplit(2050, 117, 'lose');

    assert.equal(split.proteinCapped, true);
    assert.ok(split.proteinGTarget < 1.8 * 117);
    const proteinShare = (split.proteinGTarget * KCAL_PER_G.protein) / 2050;
    assert.ok(proteinShare <= 0.351, `protein took ${Math.round(proteinShare * 100)}%`);
  });

  test('the ceiling gives the calories it takes back to carbohydrate', () => {
    const split = calculateMacroSplit(2050, 117, 'lose');
    // Uncapped this was 144g of carbs; the ceiling should raise it.
    assert.ok(split.carbsGTarget > 160, `got ${split.carbsGTarget}g of carbs`);
  });

  test('a typical body weight is unaffected by the ceiling', () => {
    for (const weightKg of [55, 65, 70, 85]) {
      const split = calculateMacroSplit(2000, weightKg, 'lose');
      assert.equal(split.proteinCapped, false, `${weightKg}kg should not be capped`);
      assert.ok(Math.abs(split.proteinGTarget - 1.8 * weightKg) < 0.2);
    }
  });

  test('a capped split still adds up to the target exactly', () => {
    const split = calculateMacroSplit(2050, 117, 'lose');
    const kcal =
      split.proteinGTarget * KCAL_PER_G.protein +
      split.carbsGTarget * KCAL_PER_G.carbs +
      split.fatGTarget * KCAL_PER_G.fat;
    assert.ok(Math.abs(kcal - 2050) < 5, `got ${kcal}`);
  });

  test('protein never exceeds its share, whatever the inputs', () => {
    for (const kcal of [1200, 1500, 2000, 2600, 3500]) {
      for (const weight of [45, 70, 100, 140, 200]) {
        for (const goal of ['lose', 'maintain', 'gain'] as const) {
          const split = calculateMacroSplit(kcal, weight, goal);
          const share = (split.proteinGTarget * KCAL_PER_G.protein) / kcal;
          assert.ok(
            share <= 0.351,
            `${goal} ${weight}kg on ${kcal}: protein took ${Math.round(share * 100)}%`,
          );
        }
      }
    }
  });

  test('an impossible target compresses instead of overshooting', () => {
    // A very heavy person on a very low target: protein and fat alone exceed it.
    const split = calculateMacroSplit(1200, 150, 'lose');
    assert.equal(split.compressed, true);
    assert.equal(split.proteinCapped, true, 'both rules can bind at once');
    assert.equal(split.carbsGTarget, 0);
    const kcal =
      split.proteinGTarget * 4 + split.carbsGTarget * 4 + split.fatGTarget * 9;
    assert.ok(Math.abs(kcal - 1200) < 5, `got ${kcal}, must not exceed the target`);
  });

  test('no macro is ever negative', () => {
    for (const kcal of [1200, 1500, 2000, 3500]) {
      for (const weight of [45, 70, 120, 180]) {
        const split = calculateMacroSplit(kcal, weight, 'lose');
        assert.ok(split.proteinGTarget >= 0);
        assert.ok(split.carbsGTarget >= 0);
        assert.ok(split.fatGTarget >= 0);
      }
    }
  });
});

describe('percentages', () => {
  test('round-trip grams to percentages and back', () => {
    const split = calculateMacroSplit(2000, 70, 'maintain');
    const pct = macroPercentages(split);
    assert.ok(Math.abs(pct.proteinPct + pct.carbsPct + pct.fatPct - 100) < 1);

    const back = targetsFromPercentages(2000, pct);
    assert.ok(Math.abs(back.proteinGTarget - split.proteinGTarget) < 1);
    assert.ok(Math.abs(back.fatGTarget - split.fatGTarget) < 1);
  });

  test('percentages that do not sum to 100 are normalised', () => {
    const targets = targetsFromPercentages(2000, {
      proteinPct: 30,
      carbsPct: 30,
      fatPct: 30, // sums to 90
    });
    const kcal =
      targets.proteinGTarget * 4 + targets.carbsGTarget * 4 + targets.fatGTarget * 9;
    assert.ok(Math.abs(kcal - 2000) < 5, `got ${kcal}`);
  });

  test('an empty target does not divide by zero', () => {
    const pct = macroPercentages({
      calorieTarget: 0,
      proteinGTarget: 0,
      carbsGTarget: 0,
      fatGTarget: 0,
    });
    assert.deepEqual(pct, { proteinPct: 0, carbsPct: 0, fatPct: 0 });
  });
});

describe('manual override', () => {
  const bmr = calculateBmr({ sex: 'female', weightKg: 65, heightCm: 165, ageYears: 30 });

  test('a sensible manual target is accepted', () => {
    const result = validateManualTarget(
      { calorieTarget: 1900, proteinGTarget: 140, carbsGTarget: 190, fatGTarget: 60 },
      'female',
      bmr,
    );
    assert.equal(result.valid, true);
  });

  test('a target below the floor is refused, with the reason stated', () => {
    const result = validateManualTarget(
      { calorieTarget: 900, proteinGTarget: 80, carbsGTarget: 80, fatGTarget: 30 },
      'female',
      bmr,
    );
    assert.equal(result.valid, false);
    assert.ok(result.valid === false && result.reason.includes('1200'));
  });

  test('zero and nonsense are refused', () => {
    for (const calorieTarget of [0, -100, Number.NaN]) {
      const result = validateManualTarget(
        { calorieTarget, proteinGTarget: 0, carbsGTarget: 0, fatGTarget: 0 },
        'female',
        bmr,
      );
      assert.equal(result.valid, false);
    }
  });

  test('macros that do not match the target warn but do not block', () => {
    const result = validateManualTarget(
      { calorieTarget: 2000, proteinGTarget: 50, carbsGTarget: 50, fatGTarget: 20 },
      'female',
      bmr,
    );
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 1);
  });

  test('refusal copy states the limit without judging the user', () => {
    const result = validateManualTarget(
      { calorieTarget: 900, proteinGTarget: 80, carbsGTarget: 80, fatGTarget: 30 },
      'female',
      bmr,
    );
    assert.ok(result.valid === false);
    const forbidden = /should|must not|unhealthy|dangerous|too low|bad|wrong/i;
    assert.ok(!forbidden.test(result.reason), `judgmental copy: ${result.reason}`);
  });
});

describe('suggestTargets', () => {
  test('returns targets and the workings behind them', () => {
    const result = suggestTargets(adult, 'lose');
    assert.ok(result.calorieTarget > 0);
    assert.ok(result.bmr > 0);
    assert.ok(result.tdee > result.bmr);
    assert.ok(result.proteinGTarget > 0);
    assert.equal(typeof result.floorApplied, 'boolean');
  });
});
