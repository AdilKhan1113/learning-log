import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NUTRIENT_IDS, type UsdaFood } from '../../src/services/usda/types.ts';
import {
  detectBasisUnit,
  mapUsdaFood,
  nutrientValue,
  selectByBarcode,
  servingAmount,
} from '../../src/services/usda/normalize.ts';
import { buildLookupUrl, describeFallbackError, lookupBarcode } from '../../src/services/usda/client.ts';

const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be within ${tol} of ${b}`);

const cereal: UsdaFood = {
  fdcId: 1234567,
  description: 'HONEY NUT CEREAL',
  brandName: 'Generic Brand',
  brandOwner: 'Generic Foods Inc',
  gtinUpc: '016000275287',
  servingSize: 37,
  servingSizeUnit: 'g',
  foodNutrients: [
    { nutrientId: NUTRIENT_IDS.energyKcal, value: 378, unitName: 'KCAL' },
    { nutrientId: NUTRIENT_IDS.protein, value: 8.1 },
    { nutrientId: NUTRIENT_IDS.carbs, value: 78.4 },
    { nutrientId: NUTRIENT_IDS.fat, value: 4.05 },
    { nutrientId: NUTRIENT_IDS.sodiumMg, value: 432 },
  ],
};

describe('reading nutrients', () => {
  test('finds a nutrient by its stable id', () => {
    assert.equal(nutrientValue(cereal.foodNutrients, NUTRIENT_IDS.protein), 8.1);
  });

  test('a nutrient that is absent is null, not zero', () => {
    assert.equal(nutrientValue(cereal.foodNutrients, NUTRIENT_IDS.fiber), null);
  });

  test('rejects nonsense values', () => {
    const nutrients = [{ nutrientId: 1, value: -5 }, { nutrientId: 2, value: Number.NaN }];
    assert.equal(nutrientValue(nutrients, 1), null);
    assert.equal(nutrientValue(nutrients, 2), null);
  });

  test('handles a missing nutrient array', () => {
    assert.equal(nutrientValue(undefined, NUTRIENT_IDS.protein), null);
  });
});

describe('serving size', () => {
  test('uses the structured size and unit', () => {
    assert.equal(servingAmount(cereal, 'g'), 37);
  });

  test('converts a unit that differs from the basis', () => {
    near(servingAmount({ servingSize: 1, servingSizeUnit: 'oz' }, 'g')!, 28.35);
  });

  test('a serving with no unit is unusable', () => {
    assert.equal(servingAmount({ servingSize: 37 }, 'g'), null);
  });

  test('a zero or missing serving is not a serving', () => {
    assert.equal(servingAmount({ servingSize: 0, servingSizeUnit: 'g' }, 'g'), null);
    assert.equal(servingAmount({}, 'g'), null);
  });

  test('a unit that is not a measurement is refused rather than guessed', () => {
    assert.equal(servingAmount({ servingSize: 1, servingSizeUnit: 'piece' }, 'g'), null);
  });
});

describe('basis unit', () => {
  test('a millilitre serving means the food is measured by volume', () => {
    assert.equal(detectBasisUnit({ servingSizeUnit: 'ml' }), 'ml');
  });

  test('anything else is measured by mass', () => {
    assert.equal(detectBasisUnit({ servingSizeUnit: 'g' }), 'g');
    assert.equal(detectBasisUnit({}), 'g');
  });
});

describe('mapping a branded food', () => {
  test('maps into the same shape as an OFF product', () => {
    const result = mapUsdaFood(cereal);
    assert.ok(result.ok);
    if (!result.ok) return;

    const food = result.value;
    assert.equal(food.sourceId, '1234567');
    assert.equal(food.name, 'HONEY NUT CEREAL');
    assert.equal(food.brand, 'Generic Brand', 'the brand name is preferred over the owner');
    assert.equal(food.kcalPer100, 378);
    assert.equal(food.sodiumMgPer100, 432, 'USDA sodium is already in mg');
    assert.equal(food.barcode, '016000275287');
    assert.equal(food.portions.length, 1);
    assert.equal(food.portions[0]?.amountInBasis, 37);
  });

  test('falls back to the brand owner when there is no brand name', () => {
    const { brandName: _omitted, ...withoutBrandName } = cereal;
    const result = mapUsdaFood(withoutBrandName);
    assert.ok(result.ok && result.value.brand === 'Generic Foods Inc');
  });

  test('the same plausibility rules apply as to crowd-sourced data', () => {
    const tooMuchEnergy = mapUsdaFood({
      ...cereal,
      foodNutrients: [{ nutrientId: NUTRIENT_IDS.energyKcal, value: 3800 }],
    });
    assert.ok(!tooMuchEnergy.ok && tooMuchEnergy.error.code === 'implausible');

    const tooManyMacros = mapUsdaFood({
      ...cereal,
      foodNutrients: [
        { nutrientId: NUTRIENT_IDS.energyKcal, value: 500 },
        { nutrientId: NUTRIENT_IDS.protein, value: 50 },
        { nutrientId: NUTRIENT_IDS.carbs, value: 50 },
        { nutrientId: NUTRIENT_IDS.fat, value: 50 },
      ],
    });
    assert.ok(!tooManyMacros.ok && tooManyMacros.error.code === 'implausible');
  });

  test('rejects a record with no id, name or energy', () => {
    assert.ok(!mapUsdaFood({ description: 'X' }).ok);
    assert.ok(!mapUsdaFood({ fdcId: 1 }).ok);
    assert.ok(!mapUsdaFood({ fdcId: 1, description: 'X' }).ok);
  });
});

describe('matching the scanned barcode', () => {
  const other: UsdaFood = { ...cereal, fdcId: 999, gtinUpc: '099999999999' };

  test('picks the food whose own GTIN matches', () => {
    const found = selectByBarcode([other, cereal], ['016000275287']);
    assert.equal(found?.fdcId, 1234567);
  });

  test('ignores leading-zero differences between the forms', () => {
    const found = selectByBarcode([cereal], ['0016000275287']);
    assert.equal(found?.fdcId, 1234567);
  });

  test('returns nothing when no GTIN matches, rather than the first result', () => {
    // USDA search is textual, so it happily returns unrelated products whose
    // description contains those digits. Accepting one would log the wrong food.
    const found = selectByBarcode([other], ['016000275287']);
    assert.equal(found, null);
  });

  test('a food with no GTIN never matches', () => {
    assert.equal(selectByBarcode([{ fdcId: 1, description: 'X' }], ['016000275287']), null);
  });
});

describe('the fallback client', () => {
  const baseUrl = 'https://example.supabase.co';
  const anonKey = 'anon-key';
  const accessToken = 'a-user-session-token';

  function jsonFetch(body: unknown, status = 200): typeof fetch {
    return (async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
  }

  test('calls our Edge Function, never USDA directly', () => {
    const url = buildLookupUrl('016000275287', baseUrl);
    assert.ok(url.includes('/functions/v1/food-lookup'));
    assert.ok(!url.includes('api.nal.usda.gov'), 'the API key must never be on the device');
    assert.ok(!url.includes('api_key'));
  });

  test('reports unavailable when Supabase is not configured', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl: '',
      anonKey: '',
      accessToken,
      fetchImpl: jsonFetch({}),
    });
    assert.ok(!result.ok && result.error.code === 'unavailable');
  });

  test('returns the matching food', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl,
      anonKey,
      accessToken,
      fetchImpl: jsonFetch({ foods: [cereal] }),
    });
    assert.ok(result.ok && result.value?.name === 'HONEY NUT CEREAL');
  });

  test('a textual match with the wrong GTIN is not accepted', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl,
      anonKey,
      accessToken,
      fetchImpl: jsonFetch({ foods: [{ ...cereal, gtinUpc: '000000000000' }] }),
    });
    assert.ok(result.ok && result.value === null);
  });

  test('404 means no such product, not a failure', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl,
      anonKey,
      accessToken,
      fetchImpl: jsonFetch({}, 404),
    });
    assert.ok(result.ok && result.value === null);
  });

  test('a proxy error carries its status', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl,
      anonKey,
      accessToken,
      fetchImpl: jsonFetch({}, 502),
    });
    assert.ok(!result.ok && result.error.code === 'http');
  });

  test('a response with no foods array is malformed', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl,
      anonKey,
      accessToken,
      fetchImpl: jsonFetch({ error: 'nope' }),
    });
    assert.ok(!result.ok && result.error.code === 'malformed');
  });

  test('refuses before the network when there is no session', async () => {
    const result = await lookupBarcode(['016000275287'], {
      baseUrl,
      anonKey,
      accessToken: '',
      fetchImpl: jsonFetch({ foods: [cereal] }),
    });
    assert.ok(!result.ok && result.error.code === 'signed_out');
  });

  test('every failure has a message', () => {
    const errors = [
      { code: 'unavailable' as const },
      { code: 'signed_out' as const },
      { code: 'offline' as const },
      { code: 'timeout' as const },
      { code: 'http' as const, status: 500 },
      { code: 'malformed' as const },
    ];
    for (const error of errors) {
      assert.ok(describeFallbackError(error).length > 0, error.code);
    }
  });
});
