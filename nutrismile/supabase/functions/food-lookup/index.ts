/**
 * food-lookup — barcode lookup against USDA FoodData Central.
 *
 * This function exists for one reason: FoodData Central requires an API key,
 * and a key shipped in a mobile bundle is a key that has been published. The
 * device calls this; this holds the key.
 *
 * It is deliberately a thin proxy. It does not interpret nutrition data — the
 * mapping lives in the app at src/services/usda/normalize.ts, where it is pure
 * and covered by unit tests. Putting it here would move it somewhere harder to
 * test for no benefit.
 *
 * Deploy:
 *   supabase secrets set USDA_API_KEY=...
 *   supabase functions deploy food-lookup
 */

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/** Fields the app actually reads. Anything else is dropped before it is sent. */
interface TrimmedFood {
  fdcId: number | undefined;
  description: string | undefined;
  brandOwner: string | undefined;
  brandName: string | undefined;
  gtinUpc: string | undefined;
  servingSize: number | undefined;
  servingSizeUnit: string | undefined;
  foodNutrients: {
    nutrientId: number | undefined;
    unitName: string | undefined;
    value: number | undefined;
  }[];
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function trim(food: Record<string, unknown>): TrimmedFood {
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  return {
    fdcId: food.fdcId as number | undefined,
    description: food.description as string | undefined,
    brandOwner: food.brandOwner as string | undefined,
    brandName: food.brandName as string | undefined,
    gtinUpc: food.gtinUpc as string | undefined,
    servingSize: food.servingSize as number | undefined,
    servingSizeUnit: food.servingSizeUnit as string | undefined,
    foodNutrients: nutrients.map((n: Record<string, unknown>) => ({
      nutrientId: n.nutrientId as number | undefined,
      unitName: n.unitName as string | undefined,
      value: n.value as number | undefined,
    })),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const apiKey = Deno.env.get('USDA_API_KEY');
  if (!apiKey) {
    // Misconfiguration on our side, not the caller's. Say so without leaking
    // anything about the environment.
    return json({ error: 'lookup_unconfigured' }, 503);
  }

  const barcode = new URL(request.url).searchParams.get('barcode')?.trim() ?? '';
  if (!/^\d{6,14}$/.test(barcode)) return json({ error: 'invalid_barcode' }, 400);

  const url = new URL(USDA_SEARCH_URL);
  url.searchParams.set('query', barcode);
  url.searchParams.set('dataType', 'Branded');
  url.searchParams.set('pageSize', '10');
  url.searchParams.set('api_key', apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502);
  }

  if (!upstream.ok) {
    // Never forward the upstream body: it can echo the query string, and the
    // query string is built from our key.
    return json({ error: 'upstream_error', status: upstream.status }, 502);
  }

  let body: { foods?: Record<string, unknown>[] };
  try {
    body = await upstream.json();
  } catch {
    return json({ error: 'upstream_malformed' }, 502);
  }

  const foods = Array.isArray(body.foods) ? body.foods.map(trim) : [];
  return json({ foods });
});
