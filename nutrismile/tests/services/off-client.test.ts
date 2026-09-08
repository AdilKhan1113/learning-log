import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_REMOTE_QUERY_LENGTH,
  buildSearchUrl,
  describeLookupError,
  searchProducts,
} from '../../src/services/openfoodfacts/client.ts';

/** A fetch that returns a given JSON body. */
function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** A fetch that fails the way a given condition would. */
function failingFetch(kind: 'offline' | 'timeout' | 'bad-json'): typeof fetch {
  if (kind === 'bad-json') {
    return (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    })) as unknown as typeof fetch;
  }

  return (async () => {
    if (kind === 'offline') throw new TypeError('Network request failed');
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }) as unknown as typeof fetch;
}

const product = {
  code: '5000000000017',
  product_name: 'Greek Style Yogurt',
  nutriments: { 'energy-kcal_100g': 133, proteins_100g: 5.2 },
};

describe('the search URL', () => {
  test('carries the query and asks only for the fields used', () => {
    const url = buildSearchUrl('greek yogurt');
    assert.ok(url.startsWith('https://world.openfoodfacts.org/cgi/search.pl?'));
    assert.ok(url.includes('search_terms=greek+yogurt'));
    assert.ok(url.includes('fields=code'), 'must request a field list');
    assert.ok(!url.includes('fields=&'), 'field list must not be empty');
  });

  test('escapes characters that would break the query string', () => {
    assert.ok(buildSearchUrl('ben & jerry').includes('ben+%26+jerry'));
  });
});

describe('searching', () => {
  test('returns mapped products on success', async () => {
    const result = await searchProducts('yogurt', {
      fetchImpl: jsonFetch({ products: [product] }),
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.foods.length, 1);
    assert.equal(result.value.foods[0]?.name, 'Greek Style Yogurt');
  });

  test('normalises the query before sending it', async () => {
    let requested = '';
    const spy = (async (url: string) => {
      requested = url;
      return { ok: true, status: 200, json: async () => ({ products: [] }) };
    }) as unknown as typeof fetch;

    await searchProducts('  Gréek  Yogurt!  ', { fetchImpl: spy });
    assert.ok(requested.includes('greek+yogurt'), requested);
  });

  test('a short query is refused without a round trip', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const result = await searchProducts('yo', { fetchImpl: spy });
    assert.ok(!result.ok && result.error.code === 'query_too_short');
    assert.equal(called, false, 'must not hit the network for a short query');
    assert.ok(MIN_REMOTE_QUERY_LENGTH > 0);
  });

  test('no network is reported as offline, not as no results', async () => {
    const result = await searchProducts('yogurt', { fetchImpl: failingFetch('offline') });
    assert.ok(!result.ok && result.error.code === 'offline');
  });

  test('a timeout is distinguished from being offline', async () => {
    const result = await searchProducts('yogurt', { fetchImpl: failingFetch('timeout') });
    assert.ok(!result.ok && result.error.code === 'timeout');
  });

  test('a server error carries its status', async () => {
    const result = await searchProducts('yogurt', {
      fetchImpl: jsonFetch({}, 503),
    });
    assert.ok(!result.ok && result.error.code === 'http');
    assert.ok(!result.ok && result.error.code === 'http' && result.error.status === 503);
  });

  test('an HTML error page instead of JSON is reported as malformed', async () => {
    const result = await searchProducts('yogurt', { fetchImpl: failingFetch('bad-json') });
    assert.ok(!result.ok && result.error.code === 'malformed');
  });

  test('a response with no products array is malformed, not empty', async () => {
    const result = await searchProducts('yogurt', {
      fetchImpl: jsonFetch({ count: 0 }),
    });
    assert.ok(!result.ok && result.error.code === 'malformed');
  });

  test('zero results is a success with nothing in it', async () => {
    const result = await searchProducts('asdfghjkl', {
      fetchImpl: jsonFetch({ products: [] }),
    });
    assert.ok(result.ok && result.value.foods.length === 0);
  });

  test('unusable products are dropped, not fatal', async () => {
    const result = await searchProducts('yogurt', {
      fetchImpl: jsonFetch({ products: [product, { code: 'x' }, { product_name: 'y' }] }),
    });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.value.foods.length, 1);
    assert.ok(result.value.skipped.length > 0, 'skips are counted for diagnostics');
  });

  test('the caller aborting is rethrown, not reported as a failure', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() =>
      searchProducts('yogurt', {
        signal: controller.signal,
        fetchImpl: failingFetch('timeout'),
      }),
    );
  });
});

describe('failure messages', () => {
  const codes = [
    { code: 'offline' as const },
    { code: 'timeout' as const },
    { code: 'http' as const, status: 500 },
    { code: 'malformed' as const },
    { code: 'query_too_short' as const },
  ];

  test('every failure has a message', () => {
    for (const error of codes) {
      const message = describeLookupError(error);
      assert.ok(message.length > 0, error.code);
    }
  });

  test('messages say what still works rather than just what broke', () => {
    assert.ok(describeLookupError({ code: 'offline' }).includes('your own foods'));
    assert.ok(describeLookupError({ code: 'timeout' }).includes('still here'));
  });

  test('no message blames the user or their connection', () => {
    const forbidden = /you should|your fault|bad connection|invalid|failed to|error occurred/i;
    for (const error of codes) {
      const message = describeLookupError(error);
      assert.ok(!forbidden.test(message), `${error.code}: ${message}`);
    }
  });
});
