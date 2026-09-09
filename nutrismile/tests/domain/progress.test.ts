import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summariseStreak } from '../../src/domain/progress/streak.ts';
import {
  type DailyTotal,
  averageByPeriod,
  linearSlopePerDay,
  movingAverage,
  startOfMonth,
  startOfWeek,
  weightTrend,
} from '../../src/domain/progress/trends.ts';

const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);

describe('streaks', () => {
  test('counts consecutive days up to today', () => {
    const streak = summariseStreak(
      ['2026-09-07', '2026-09-08', '2026-09-09'],
      '2026-09-09',
    );
    assert.equal(streak.current, 3);
    assert.equal(streak.todayPending, false);
  });

  test('a gap ends the run', () => {
    const streak = summariseStreak(
      ['2026-09-01', '2026-09-02', '2026-09-08', '2026-09-09'],
      '2026-09-09',
    );
    assert.equal(streak.current, 2);
  });

  test('yesterday still counts when today is not logged yet', () => {
    // At nine in the morning a user has usually not eaten. Reporting zero
    // would be wrong as well as discouraging.
    const streak = summariseStreak(['2026-09-07', '2026-09-08'], '2026-09-09');
    assert.equal(streak.current, 2);
    assert.equal(streak.todayPending, true);
  });

  test('two days without a log ends the streak', () => {
    const streak = summariseStreak(['2026-09-06', '2026-09-07'], '2026-09-09');
    assert.equal(streak.current, 0);
    assert.equal(streak.todayPending, false);
  });

  test('tracks the longest run separately from the current one', () => {
    const streak = summariseStreak(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-09-09'],
      '2026-09-09',
    );
    assert.equal(streak.current, 1);
    assert.equal(streak.longest, 4);
  });

  test('no data is zero, not an error', () => {
    assert.deepEqual(summariseStreak([], '2026-09-09'), {
      current: 0,
      longest: 0,
      todayPending: false,
    });
  });

  test('duplicate dates do not inflate a streak', () => {
    const streak = summariseStreak(
      ['2026-09-09', '2026-09-09', '2026-09-08'],
      '2026-09-09',
    );
    assert.equal(streak.current, 2);
  });

  test('unsorted input is handled', () => {
    const streak = summariseStreak(
      ['2026-09-09', '2026-09-07', '2026-09-08'],
      '2026-09-09',
    );
    assert.equal(streak.current, 3);
  });

  test('a single day is a streak of one', () => {
    assert.equal(summariseStreak(['2026-09-09'], '2026-09-09').current, 1);
  });
});

describe('moving average', () => {
  const series = [
    { date: '2026-09-01', value: 10 },
    { date: '2026-09-02', value: 20 },
    { date: '2026-09-03', value: 30 },
  ];

  test('averages the trailing window', () => {
    const smoothed = movingAverage(series, 3);
    assert.equal(smoothed[0]?.value, 10);
    assert.equal(smoothed[1]?.value, 15);
    assert.equal(smoothed[2]?.value, 20);
  });

  test('uses a shorter window at the start rather than skipping points', () => {
    const smoothed = movingAverage(series, 7);
    assert.equal(smoothed.length, 3, 'every point keeps a smoothed value');
  });

  test('an empty series stays empty', () => {
    assert.deepEqual(movingAverage([], 7), []);
  });
});

describe('slope', () => {
  test('a steady rise has a positive slope per day', () => {
    const slope = linearSlopePerDay([
      { date: '2026-09-01', value: 100 },
      { date: '2026-09-02', value: 101 },
      { date: '2026-09-03', value: 102 },
    ]);
    near(slope!, 1);
  });

  test('a steady fall is negative', () => {
    const slope = linearSlopePerDay([
      { date: '2026-09-01', value: 100 },
      { date: '2026-09-11', value: 95 },
    ]);
    near(slope!, -0.5);
  });

  test('one point is not a line', () => {
    assert.equal(linearSlopePerDay([{ date: '2026-09-01', value: 80 }]), null);
    assert.equal(linearSlopePerDay([]), null);
  });

  test('several readings on one day is not a line either', () => {
    const slope = linearSlopePerDay([
      { date: '2026-09-01', value: 80 },
      { date: '2026-09-01', value: 81 },
    ]);
    assert.equal(slope, null, 'a vertical fit must not divide by zero');
  });
});

describe('weight trend', () => {
  const entries = [
    { date: '2026-09-05', weightKg: 80.5 },
    { date: '2026-09-01', weightKg: 82 },
    { date: '2026-09-03', weightKg: 81.2 },
  ];

  test('sorts by date whatever order it is given', () => {
    const trend = weightTrend(entries);
    assert.equal(trend.first?.date, '2026-09-01');
    assert.equal(trend.latest?.date, '2026-09-05');
  });

  test('reports a weekly rate', () => {
    const trend = weightTrend(entries);
    assert.ok(trend.rateKgPerWeek !== null && trend.rateKgPerWeek < 0, 'this data falls');
  });

  test('one reading gives no rate rather than a fabricated one', () => {
    const trend = weightTrend([{ date: '2026-09-01', weightKg: 80 }]);
    assert.equal(trend.rateKgPerWeek, null);
    assert.equal(trend.points.length, 1);
  });

  test('no readings is empty, not an error', () => {
    const trend = weightTrend([]);
    assert.deepEqual(trend.points, []);
    assert.equal(trend.latest, null);
  });

  test('the smoothed line is as long as the raw series', () => {
    const trend = weightTrend(entries);
    assert.equal(trend.trend.length, trend.points.length);
  });
});

describe('period boundaries', () => {
  test('weeks start on Monday', () => {
    // 2026-09-09 is a Wednesday.
    assert.equal(startOfWeek('2026-09-09'), '2026-09-07');
  });

  test('a Monday is its own week start', () => {
    assert.equal(startOfWeek('2026-09-07'), '2026-09-07');
  });

  test('a Sunday belongs to the week that began six days earlier', () => {
    assert.equal(startOfWeek('2026-09-13'), '2026-09-07');
  });

  test('months start on the first', () => {
    assert.equal(startOfMonth('2026-09-09'), '2026-09-01');
    assert.equal(startOfMonth('2026-12-31'), '2026-12-01');
  });
});

describe('period averages', () => {
  const day = (date: string, kcal: number, entryCount = 3): DailyTotal => ({
    date,
    kcal,
    proteinG: kcal / 20,
    carbsG: kcal / 10,
    fatG: kcal / 30,
    entryCount,
  });

  test('averages over the days logged, not the calendar period', () => {
    // Two days logged in a week. Dividing by seven would show a third of what
    // was actually eaten.
    const weeks = averageByPeriod([day('2026-09-07', 2000), day('2026-09-08', 2200)], 'week');
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]?.average.kcal, 2100);
    assert.equal(weeks[0]?.daysLogged, 2);
  });

  test('groups into separate weeks', () => {
    const weeks = averageByPeriod(
      [day('2026-09-06', 1800), day('2026-09-07', 2000)],
      'week',
    );
    assert.equal(weeks.length, 2, 'Sunday and Monday are different weeks');
  });

  test('groups into months', () => {
    const months = averageByPeriod(
      [day('2026-08-31', 1800), day('2026-09-01', 2000), day('2026-09-15', 2200)],
      'month',
    );
    assert.equal(months.length, 2);
    assert.equal(months[1]?.average.kcal, 2100);
  });

  test('days with nothing logged are excluded rather than counted as zero', () => {
    const weeks = averageByPeriod(
      [day('2026-09-07', 2000), day('2026-09-08', 0, 0)],
      'week',
    );
    assert.equal(weeks[0]?.daysLogged, 1);
    assert.equal(weeks[0]?.average.kcal, 2000, 'an empty day must not halve the average');
  });

  test('results come back in chronological order', () => {
    const weeks = averageByPeriod(
      [day('2026-09-21', 2000), day('2026-09-07', 1800), day('2026-09-14', 1900)],
      'week',
    );
    assert.deepEqual(
      weeks.map((w) => w.start),
      ['2026-09-07', '2026-09-14', '2026-09-21'],
    );
  });

  test('no data is an empty list', () => {
    assert.deepEqual(averageByPeriod([], 'week'), []);
  });

  test('macros are averaged too, not just calories', () => {
    const weeks = averageByPeriod([day('2026-09-07', 2000), day('2026-09-08', 2200)], 'week');
    near(weeks[0]!.average.proteinG, 105);
  });
});
