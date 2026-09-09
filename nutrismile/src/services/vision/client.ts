/**
 * Meal photo estimation, reached through our own Edge Function.
 *
 * The Anthropic key never reaches the device: the image goes to
 * supabase/functions/estimate-meal, which holds the key. Validation of what
 * comes back happens here on the device, in schema.ts, where it is pure and
 * tested.
 */
import { type Result, err, ok } from '../../domain/result.ts';
import { type EstimateSource, type MealEstimate, parseMealEstimate } from './schema.ts';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Vision requests are slower than a database lookup; the user sees progress. */
const TIMEOUT_MS = 45_000;

export type EstimateFailure =
  | { code: 'unavailable' }
  | { code: 'offline' }
  | { code: 'timeout' }
  | { code: 'too_large' }
  | { code: 'rate_limited' }
  | { code: 'no_food_found' }
  | { code: 'refused' }
  | { code: 'unreadable' }
  | { code: 'http'; status: number };

/**
 * What to tell the user. Nothing here blames them for a bad photo — a photo
 * the model cannot read is a limit of the estimator, not a mistake.
 */
export function describeEstimateFailure(failure: EstimateFailure): string {
  switch (failure.code) {
    case 'unavailable':
      return 'Photo estimates need the app’s backend, which isn’t set up yet. You can still search or scan.';
    case 'offline':
      return 'Photo estimates need a connection. You can search or scan offline instead.';
    case 'timeout':
      return 'That took too long to come back. Try again, or add the meal by hand.';
    case 'too_large':
      return 'That photo is too large to send. Try taking it again.';
    case 'rate_limited':
      return 'Too many estimates at once. Give it a moment and try again.';
    case 'no_food_found':
      return 'No food was identified in that photo. A closer shot with the whole plate in frame usually helps.';
    case 'refused':
      return 'The estimator declined to read that image.';
    case 'unreadable':
      return 'The estimate came back in a form this app couldn’t read. Nothing was logged.';
    case 'http':
      return `The estimator returned an error (${failure.status}). Nothing was logged.`;
  }
}

export function isConfigured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
}

export function buildEstimateUrl(baseUrl = SUPABASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}/functions/v1/estimate-meal`;
}

export interface EstimateOptions {
  mediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  anonKey?: string;
}

/**
 * Which provider and model answered, from the response envelope. Reported so
 * the review screen can show it while two providers are being compared.
 */
function readSource(body: { provider?: unknown; model?: unknown }): EstimateSource | null {
  const provider = typeof body.provider === 'string' ? body.provider : null;
  const model = typeof body.model === 'string' ? body.model : null;
  return provider ? { provider, model: model ?? provider } : null;
}

/** Map the function's error codes onto ours. */
function mapServerError(status: number, code: unknown): EstimateFailure {
  switch (code) {
    case 'estimator_unconfigured':
    case 'provider_key_missing':
    case 'unknown_provider':
      return { code: 'unavailable' };
    case 'image_too_large':
      return { code: 'too_large' };
    case 'rate_limited':
      return { code: 'rate_limited' };
    case 'refused':
      return { code: 'refused' };
    case 'no_estimate':
      return { code: 'no_food_found' };
    default:
      return { code: 'http', status };
  }
}

/**
 * Estimate a meal from a base64 image.
 *
 * Returns the validated estimate. Nothing is logged here and nothing is
 * logged by the caller without the user confirming it — an AI estimate is a
 * proposal, never an entry.
 */
export async function estimateMeal(
  base64Image: string,
  options: EstimateOptions = {},
): Promise<Result<MealEstimate, EstimateFailure>> {
  const baseUrl = options.baseUrl ?? SUPABASE_URL;
  const anonKey = options.anonKey ?? SUPABASE_ANON_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!baseUrl || !anonKey) return err({ code: 'unavailable' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort);

  try {
    const response = await fetchImpl(buildEstimateUrl(baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        image: base64Image,
        mediaType: options.mediaType ?? 'image/jpeg',
      }),
    });

    let body: {
      estimate?: unknown;
      error?: unknown;
      provider?: unknown;
      model?: unknown;
    };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      return err({ code: 'unreadable' });
    }

    if (!response.ok) return err(mapServerError(response.status, body?.error));

    const parsed = parseMealEstimate(body?.estimate);
    if (parsed.ok) return ok({ ...parsed.value, source: readSource(body) });

    // A response the model produced but that held nothing usable reads to the
    // user as "no food found"; a shape this app cannot read is a bug.
    return err(
      parsed.error.code === 'malformed'
        ? { code: 'unreadable' }
        : { code: 'no_food_found' },
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof Error && error.name === 'AbortError') return err({ code: 'timeout' });
    return err({ code: 'offline' });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
