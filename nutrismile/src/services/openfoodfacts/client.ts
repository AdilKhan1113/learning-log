/**
 * Open Food Facts client.
 *
 * OFF is public and needs no key, so it is called straight from the device.
 * Everything that does need a key — USDA, Nutritionix, the vision model —
 * goes through a Supabase Edge Function instead, which is why none of them
 * appear here.
 *
 * Failures are values, not exceptions: the caller has to render "you're
 * offline" differently from "nothing matched", and both differently from
 * "their server is having a bad day".
 */
import { type Result, err, ok } from '../../domain/result.ts';
import { normalize } from '../../domain/search/normalize.ts';
import { type MapPageResult, mapProducts } from './normalize.ts';
import { OFF_FIELDS, type OffSearchResponse } from './types.ts';

const BASE_URL = 'https://world.openfoodfacts.org';

/**
 * OFF asks clients to identify themselves. An anonymous scraper is liable to
 * be rate-limited, and it is their bandwidth being used.
 */
const USER_AGENT = 'NutriSmile/0.1 (https://github.com/AdilKhan1113/learning-log)';

/** Long enough for a slow connection, short enough not to feel broken. */
export const REQUEST_TIMEOUT_MS = 8000;

/** Enough to rank meaningfully without pulling a large payload over mobile data. */
const PAGE_SIZE = 25;

/** A query shorter than this matches too much to be worth a round trip. */
export const MIN_REMOTE_QUERY_LENGTH = 3;

export type LookupError =
  | { code: 'offline' }
  | { code: 'timeout' }
  | { code: 'http'; status: number }
  | { code: 'malformed' }
  | { code: 'query_too_short' };

/** What to show the user for each failure. Neutral, and never blames them. */
export function describeLookupError(error: LookupError): string {
  switch (error.code) {
    case 'offline':
      return "You're offline, so this is searching your own foods only.";
    case 'timeout':
      return 'The food database took too long to answer. Your own foods are still here.';
    case 'http':
      return `The food database returned an error (${error.status}). Your own foods are still here.`;
    case 'malformed':
      return "The food database sent something this app couldn't read.";
    case 'query_too_short':
      return `Type at least ${MIN_REMOTE_QUERY_LENGTH} characters to search the food database.`;
  }
}

/** Built separately from the request so it can be asserted in tests. */
export function buildSearchUrl(query: string, pageSize = PAGE_SIZE): string {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(pageSize),
    fields: OFF_FIELDS,
  });
  return `${BASE_URL}/cgi/search.pl?${params.toString()}`;
}

interface FetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Run a request with a timeout, classifying anything that goes wrong.
 *
 * A caller-supplied signal (a screen unmounting, a newer query starting) is
 * honoured alongside the timeout, and the two are told apart so an abandoned
 * request is not reported to the user as a failure.
 */
async function getJson<T>(
  url: string,
  options: FetchOptions,
): Promise<Result<T, LookupError>> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, signal, fetchImpl = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });

    if (!response.ok) return err({ code: 'http', status: response.status });

    try {
      return ok((await response.json()) as T);
    } catch {
      return err({ code: 'malformed' });
    }
  } catch (error) {
    // The caller aborting is not a failure to report; rethrow so the caller
    // can discard the result silently.
    if (signal?.aborted) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      return err({ code: 'timeout' });
    }
    // React Native surfaces every connection failure as a TypeError.
    return err({ code: 'offline' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Search the food database by name.
 *
 * Products that cannot be trusted are dropped by the mapper rather than
 * failing the search, so a page with two bad records still returns the other
 * twenty-three.
 */
export async function searchProducts(
  query: string,
  options: FetchOptions = {},
): Promise<Result<MapPageResult, LookupError>> {
  const normalized = normalize(query);
  if (normalized.length < MIN_REMOTE_QUERY_LENGTH) {
    return err({ code: 'query_too_short' });
  }

  const response = await getJson<OffSearchResponse>(
    buildSearchUrl(normalized),
    options,
  );
  if (!response.ok) return response;

  const products = response.value?.products;
  if (!Array.isArray(products)) return err({ code: 'malformed' });

  return ok(mapProducts(products));
}
