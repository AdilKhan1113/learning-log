import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEstimateUrl,
  describeEstimateFailure,
  estimateMeal,
} from '../../src/services/vision/client.ts';

const baseUrl = 'https://example.supabase.co';
const anonKey = 'anon-key';

const goodEstimate = {
  foods: [
    { name: 'Grilled chicken', grams: 150, kcal: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4, confidence: 0.8 },
  ],
  confidence: 0.8,
  note: null,
};

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('the estimate endpoint', () => {
  test('calls our Edge Function, never the model directly', () => {
    const url = buildEstimateUrl(baseUrl);
    assert.ok(url.endsWith('/functions/v1/estimate-meal'));
    assert.ok(!url.includes('anthropic.com'), 'the API key must never be on the device');
  });

  test('reports unavailable when the backend is not configured', async () => {
    const result = await estimateMeal('abc', { baseUrl: '', anonKey: '', fetchImpl: jsonFetch({}) });
    assert.ok(!result.ok && result.error.code === 'unavailable');
  });

  test('returns a validated estimate', async () => {
    const result = await estimateMeal('abc', {
      baseUrl,
      anonKey,
      fetchImpl: jsonFetch({ estimate: goodEstimate }),
    });
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.value.foods[0]?.name, 'Grilled chicken');
  });

  test('sends the image in the body, not the URL', async () => {
    let captured: RequestInit | undefined;
    const spy = (async (_url: string, init: RequestInit) => {
      captured = init;
      return { ok: true, status: 200, json: async () => ({ estimate: goodEstimate }) };
    }) as unknown as typeof fetch;

    await estimateMeal('BASE64DATA', { baseUrl, anonKey, fetchImpl: spy });
    assert.equal(captured?.method, 'POST');
    assert.ok(String(captured?.body).includes('BASE64DATA'));
  });

  test('an unusable estimate is reported as no food found, never logged', async () => {
    const result = await estimateMeal('abc', {
      baseUrl,
      anonKey,
      fetchImpl: jsonFetch({ estimate: { foods: [] } }),
    });
    assert.ok(!result.ok && result.error.code === 'no_food_found');
  });

  test('a response that is not an estimate at all is unreadable', async () => {
    const result = await estimateMeal('abc', {
      baseUrl,
      anonKey,
      fetchImpl: jsonFetch({ estimate: 'a plate of chicken' }),
    });
    assert.ok(!result.ok && result.error.code === 'unreadable');
  });

  test('server error codes map to distinct failures', async () => {
    const cases = [
      ['estimator_unconfigured', 503, 'unavailable'],
      ['image_too_large', 413, 'too_large'],
      ['rate_limited', 429, 'rate_limited'],
      ['refused', 422, 'refused'],
      ['no_estimate', 422, 'no_food_found'],
    ] as const;

    for (const [code, status, expected] of cases) {
      const result = await estimateMeal('abc', {
        baseUrl,
        anonKey,
        fetchImpl: jsonFetch({ error: code }, status),
      });
      assert.ok(!result.ok && result.error.code === expected, `${code} -> ${expected}`);
    }
  });

  test('an unrecognised server error keeps its status', async () => {
    const result = await estimateMeal('abc', {
      baseUrl,
      anonKey,
      fetchImpl: jsonFetch({ error: 'something_new' }, 500),
    });
    assert.ok(!result.ok && result.error.code === 'http');
  });

  test('no network is offline, not a bad photo', async () => {
    const failing = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const result = await estimateMeal('abc', { baseUrl, anonKey, fetchImpl: failing });
    assert.ok(!result.ok && result.error.code === 'offline');
  });

  test('a timeout is distinguished from being offline', async () => {
    const timing_out = (async () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;

    const result = await estimateMeal('abc', { baseUrl, anonKey, fetchImpl: timing_out });
    assert.ok(!result.ok && result.error.code === 'timeout');
  });
});

describe('failure messages', () => {
  const failures = [
    { code: 'unavailable' as const },
    { code: 'offline' as const },
    { code: 'timeout' as const },
    { code: 'too_large' as const },
    { code: 'rate_limited' as const },
    { code: 'no_food_found' as const },
    { code: 'refused' as const },
    { code: 'unreadable' as const },
    { code: 'http' as const, status: 500 },
  ];

  test('every failure has a message', () => {
    for (const failure of failures) {
      assert.ok(describeEstimateFailure(failure).length > 0, failure.code);
    }
  });

  test('a failure never blames the user for their photo', () => {
    const forbidden = /bad photo|your fault|you should|poor quality|invalid/i;
    for (const failure of failures) {
      const message = describeEstimateFailure(failure);
      assert.ok(!forbidden.test(message), `${failure.code}: ${message}`);
    }
  });

  test('failures that logged nothing say so', () => {
    assert.ok(describeEstimateFailure({ code: 'unreadable' }).includes('Nothing was logged'));
    assert.ok(describeEstimateFailure({ code: 'http', status: 500 }).includes('Nothing was logged'));
  });
});
