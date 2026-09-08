import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseBarcode } from '../../src/domain/barcode.ts';
import { err, ok } from '../../src/domain/result.ts';
import {
  type BarcodeOutcome,
  type LookupDeps,
  describeOutcome,
  resolveBarcode,
} from '../../src/services/catalog/lookupBarcode.ts';
import type { MappedFood, PartialFood } from '../../src/services/openfoodfacts/normalize.ts';

/** OFF answering "no such product". */
const absent = () => ok({ kind: 'absent' as const });
/** OFF answering with a loggable product. */
const found = (food: MappedFood) => ok({ kind: 'found' as const, food });

const cola: MappedFood = {
  sourceId: '5000112637922',
  barcode: '5000112637922',
  name: 'Coca-Cola',
  brand: 'Coca-Cola',
  basisUnit: 'ml',
  kcalPer100: 42,
  proteinGPer100: 0,
  carbsGPer100: 10.6,
  fatGPer100: 0,
  fiberGPer100: null,
  sugarGPer100: 10.6,
  satFatGPer100: null,
  sodiumMgPer100: null,
  portions: [],
};

function parsed(code = '5000112637922') {
  const result = parseBarcode(code);
  assert.ok(result.ok, `fixture barcode ${code} must be valid`);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** Deps that find nothing anywhere, overridden per test. */
function deps(overrides: Partial<LookupDeps> = {}): LookupDeps & { cached: MappedFood[] } {
  const cachedFoods: MappedFood[] = [];
  return {
    cached: cachedFoods,
    findCached: async () => null,
    lookupOff: async () => absent(),
    lookupFallback: async () => ok(null),
    cache: async (food) => {
      cachedFoods.push(food);
      return `local-${food.sourceId}`;
    },
    describeError: () => 'The food database is unreachable.',
    ...overrides,
  };
}

describe('the cache comes first', () => {
  test('a previously scanned product needs no network at all', async () => {
    let offCalls = 0;
    let fallbackCalls = 0;
    const d = deps({
      findCached: async () => ({ id: 'food-1', name: 'Coca-Cola' }),
      lookupOff: async () => {
        offCalls++;
        return absent();
      },
      lookupFallback: async () => {
        fallbackCalls++;
        return ok(null);
      },
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.deepEqual(outcome, { kind: 'cached', foodId: 'food-1', name: 'Coca-Cola' });
    assert.equal(offCalls, 0, 'a cache hit must not hit the network');
    assert.equal(fallbackCalls, 0);
  });

  test('the cache is asked with every candidate form of the barcode', async () => {
    let asked: readonly string[] = [];
    const d = deps({
      findCached: async (candidates) => {
        asked = candidates;
        return null;
      },
    });

    await resolveBarcode(parsed('036000291452'), d);
    assert.ok(asked.includes('0036000291452'));
    assert.ok(asked.includes('036000291452'), 'a UPC-A may be cached in either form');
  });
});

describe('Open Food Facts', () => {
  test('a hit is returned and cached for next time', async () => {
    const d = deps({ lookupOff: async () => found(cola) });
    const outcome = await resolveBarcode(parsed(), d);

    assert.equal(outcome.kind, 'found');
    if (outcome.kind !== 'found') return;
    assert.equal(outcome.source, 'openfoodfacts');
    assert.equal(outcome.foodId, 'local-5000112637922', 'the local id opens the serving sheet');
    assert.equal(d.cached.length, 1, 'the next scan of this item must be instant');
  });

  test('the fallback is not consulted when OFF has the product', async () => {
    let fallbackCalls = 0;
    const d = deps({
      lookupOff: async () => found(cola),
      lookupFallback: async () => {
        fallbackCalls++;
        return ok(null);
      },
    });

    await resolveBarcode(parsed(), d);
    assert.equal(fallbackCalls, 0);
  });

  test('every candidate form is tried before giving up', async () => {
    const tried: string[] = [];
    const d = deps({
      lookupOff: async (code) => {
        tried.push(code);
        // Only the unpadded UPC-A is present, as some catalogues store it.
        return code === '036000291452' ? found(cola) : absent();
      },
    });

    const outcome = await resolveBarcode(parsed('036000291452'), d);
    assert.equal(outcome.kind, 'found');
    assert.ok(tried.length > 1, 'must not give up after the canonical form alone');
  });

  test('a source that is down is not retried for each candidate form', async () => {
    let calls = 0;
    const d = deps({
      lookupOff: async () => {
        calls++;
        return err({ code: 'offline' as const });
      },
    });

    await resolveBarcode(parsed('036000291452'), d);
    assert.equal(calls, 1, 'a down service will be down for the other forms too');
  });
});

describe('the USDA fallback', () => {
  test('is used when OFF has nothing', async () => {
    const d = deps({
      lookupOff: async () => absent(),
      lookupFallback: async () => ok({ ...cola, sourceId: '123456' }),
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.equal(outcome.kind, 'found');
    if (outcome.kind === 'found') assert.equal(outcome.source, 'usda');
  });

  test('a fallback hit is cached too', async () => {
    const d = deps({ lookupFallback: async () => ok({ ...cola, sourceId: '123456' }) });
    await resolveBarcode(parsed(), d);
    assert.equal(d.cached.length, 1);
  });
});

describe('not found versus unreachable', () => {
  test('every source answering "no" means the product is genuinely absent', async () => {
    const outcome = await resolveBarcode(parsed(), deps());
    assert.equal(outcome.kind, 'not_found');
  });

  test('no source reachable is never reported as "not found"', async () => {
    const d = deps({
      lookupOff: async () => err({ code: 'offline' as const }),
      lookupFallback: async () => err({ code: 'offline' as const }),
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.equal(
      outcome.kind,
      'unreachable',
      'inviting someone to retype a label the database already has is the wrong instruction',
    );
  });

  test('an unconfigured fallback does not count as an answer', async () => {
    // This is the state the app actually ships in until Supabase is deployed:
    // OFF is down and USDA does not exist yet. Nothing has said "no".
    const d = deps({
      lookupOff: async () => err({ code: 'timeout' as const }),
      lookupFallback: async () => err({ code: 'unavailable' as const }),
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.equal(outcome.kind, 'unreachable');
  });

  test('an unconfigured fallback still allows a definite answer from OFF', async () => {
    const d = deps({
      lookupOff: async () => absent(),
      lookupFallback: async () => err({ code: 'unavailable' as const }),
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.equal(outcome.kind, 'not_found', 'OFF answered, so the product is absent');
  });

  test('the failure reason reaches the user', async () => {
    const d = deps({
      lookupOff: async () => err({ code: 'offline' as const }),
      lookupFallback: async () => err({ code: 'unavailable' as const }),
      describeError: () => "You're offline.",
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.ok(outcome.kind === 'unreachable' && outcome.reason.includes('offline'));
  });

  test('a fallback failure is reported when OFF simply had nothing', async () => {
    const d = deps({
      lookupOff: async () => absent(),
      lookupFallback: async () => err({ code: 'timeout' as const }),
    });

    // OFF answered, so this is still a definite absence rather than a failure.
    const outcome = await resolveBarcode(parsed(), d);
    assert.equal(outcome.kind, 'not_found');
  });
});

describe('a product that exists but cannot be logged', () => {
  const partial: PartialFood = {
    barcode: '5000112637922',
    name: 'Artisan Sourdough',
    brand: 'Local Bakery',
    basisUnit: 'g',
    proteinGPer100: 9,
    carbsGPer100: null,
    fatGPer100: null,
  };

  test('its details are carried through to the create form', async () => {
    const d = deps({ lookupOff: async () => ok({ kind: 'unusable' as const, partial }) });
    const outcome = await resolveBarcode(parsed(), d);

    assert.equal(outcome.kind, 'not_found');
    if (outcome.kind !== 'not_found') return;
    assert.equal(outcome.partial?.name, 'Artisan Sourdough');
    assert.equal(outcome.partial?.proteinGPer100, 9);
  });

  test('it is never cached, since it has nothing loggable in it', async () => {
    const d = deps({ lookupOff: async () => ok({ kind: 'unusable' as const, partial }) });
    await resolveBarcode(parsed(), d);
    assert.equal(d.cached.length, 0);
  });

  test('the fallback still gets a chance to have a complete record', async () => {
    const d = deps({
      lookupOff: async () => ok({ kind: 'unusable' as const, partial }),
      lookupFallback: async () => ok({ ...cola, sourceId: '99' }),
    });

    const outcome = await resolveBarcode(parsed(), d);
    assert.equal(outcome.kind, 'found', 'a complete USDA record beats a partial OFF one');
  });

  test('the copy says the product is listed rather than missing', async () => {
    const d = deps({ lookupOff: async () => ok({ kind: 'unusable' as const, partial }) });
    const outcome = await resolveBarcode(parsed(), d);
    const message = describeOutcome(outcome);
    assert.ok(message.includes('Artisan Sourdough'));
    assert.ok(message.includes('without nutrition information'));
  });
});

describe('outcome copy', () => {
  const outcomes: BarcodeOutcome[] = [
    { kind: 'cached', foodId: '1', name: 'Coca-Cola' },
    { kind: 'found', foodId: 'local-1', food: cola, source: 'openfoodfacts' },
    { kind: 'not_found', barcode: '5000112637922', partial: null },
    { kind: 'unreachable', barcode: '5000112637922', reason: "You're offline." },
  ];

  test('every outcome says something', () => {
    for (const outcome of outcomes) {
      assert.ok(describeOutcome(outcome).length > 0, outcome.kind);
    }
  });

  test('not found offers the way forward rather than stopping', () => {
    assert.ok(describeOutcome(outcomes[2]!).includes('add it yourself'));
  });

  test('unreachable does not tell the user to type out a label', () => {
    const message = describeOutcome(outcomes[3]!);
    assert.ok(message.includes('back online'));
  });

  test('no message blames the user', () => {
    const forbidden = /you should have|your fault|invalid|failed/i;
    for (const outcome of outcomes) {
      assert.ok(!forbidden.test(describeOutcome(outcome)), outcome.kind);
    }
  });
});
