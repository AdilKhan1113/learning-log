/**
 * USDA FoodData Central, reached through our own Edge Function.
 *
 * FDC requires an API key. A key in the app bundle is a key that has been
 * published, so the device never sees it: it calls a Supabase Edge Function
 * that holds the key and forwards the request. That function is a thin proxy
 * and returns USDA's payload untouched, which keeps the mapping here on the
 * device where it is pure and testable.
 *
 * When no Supabase URL is configured — which is the case until the project is
 * deployed — this reports `unavailable` rather than failing. A missing
 * fallback is a feature that is not there yet, not an error to show anyone.
 */
import { type Result, err, ok } from '../../domain/result.ts';
import type { MappedFood } from '../openfoodfacts/normalize.ts';
import { mapUsdaFood, selectByBarcode } from './normalize.ts';
import type { UsdaSearchResponse } from './types.ts';

/**
 * Public config only: the project URL and the anon key are both meant to be
 * client-visible. The USDA key is not, and is never read here.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const TIMEOUT_MS = 8000;

export type FallbackError =
  | { code: 'unavailable' }
  | { code: 'offline' }
  | { code: 'timeout' }
  | { code: 'http'; status: number }
  | { code: 'malformed' };

export function describeFallbackError(error: FallbackError): string {
  switch (error.code) {
    case 'unavailable':
      return 'The backup food database isn’t set up yet.';
    case 'offline':
      return 'The backup food database is unreachable offline.';
    case 'timeout':
      return 'The backup food database took too long to answer.';
    case 'http':
      return `The backup food database returned an error (${error.status}).`;
    case 'malformed':
      return 'The backup food database sent something this app couldn’t read.';
  }
}

export function isConfigured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
}

export function buildLookupUrl(barcode: string, baseUrl = SUPABASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}/functions/v1/food-lookup?barcode=${encodeURIComponent(barcode)}`;
}

interface FetchOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Injected in tests so the proxy can be exercised without a deployment. */
  baseUrl?: string;
  anonKey?: string;
}

/**
 * Look a barcode up in USDA. `null` means USDA answered and has nothing
 * matching that GTIN.
 */
export async function lookupBarcode(
  candidates: readonly string[],
  options: FetchOptions = {},
): Promise<Result<MappedFood | null, FallbackError>> {
  const baseUrl = options.baseUrl ?? SUPABASE_URL;
  const anonKey = options.anonKey ?? SUPABASE_ANON_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!baseUrl || !anonKey) return err({ code: 'unavailable' });
  const first = candidates[0];
  if (!first) return ok(null);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  try {
    const response = await fetchImpl(buildLookupUrl(first, baseUrl), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
    });

    if (response.status === 404) return ok(null);
    if (!response.ok) return err({ code: 'http', status: response.status });

    let body: UsdaSearchResponse;
    try {
      body = (await response.json()) as UsdaSearchResponse;
    } catch {
      return err({ code: 'malformed' });
    }

    const foods = body?.foods;
    if (!Array.isArray(foods)) return err({ code: 'malformed' });

    // USDA's search is textual, so only a food whose own GTIN matches counts.
    const match = selectByBarcode(foods, candidates);
    if (!match) return ok(null);

    const mapped = mapUsdaFood(match);
    return ok(mapped.ok ? mapped.value : null);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof Error && error.name === 'AbortError') return err({ code: 'timeout' });
    return err({ code: 'offline' });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
