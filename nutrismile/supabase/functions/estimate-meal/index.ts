/**
 * estimate-meal — identify foods in a photo and estimate their nutrition.
 *
 * This function exists to hold the API key. A key shipped in a mobile bundle
 * is a published key, so the device sends the image here and never talks to a
 * model provider directly.
 *
 * Two providers are supported so the same photos can be put to both and
 * compared. The prompt and the requested shape are identical either way
 * (prompt.ts), so a difference in the estimates is a difference in the models
 * rather than in how they were asked.
 *
 * The response is not interpreted beyond being handed back as JSON:
 * validation lives in the app at src/services/vision/schema.ts, where it is
 * pure and unit-tested, and it is provider-agnostic.
 *
 * Deploy:
 *   supabase secrets set ANTHROPIC_API_KEY=...   # for the anthropic provider
 *   supabase secrets set GEMINI_API_KEY=...      # for the gemini provider
 *   supabase secrets set VISION_PROVIDER=gemini  # optional; see below
 *   supabase secrets set GEMINI_MODEL=...        # optional; overrides the default
 *   supabase functions deploy estimate-meal
 */
import { type ProviderError, statusFor } from './prompt.ts';
import { DEFAULT_MODEL as ANTHROPIC_MODEL, estimateWithAnthropic } from './anthropic.ts';
import { DEFAULT_MODEL as GEMINI_MODEL, estimateWithGemini } from './gemini.ts';

type Provider = 'anthropic' | 'gemini';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Approximate decoded size of a base64 payload, without decoding it. */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Which provider to use.
 *
 * `VISION_PROVIDER` decides when it is set — that is the switch for putting
 * the same photo to each in turn. With it unset, whichever key is present
 * wins; with both present and no preference stated, Anthropic is used, since
 * silently picking one of two configured providers should at least be
 * predictable.
 */
function selectProvider(): { provider: Provider; apiKey: string } | { error: string } {
  const requested = Deno.env.get('VISION_PROVIDER')?.trim().toLowerCase();
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');

  if (requested && requested !== 'anthropic' && requested !== 'gemini') {
    return { error: 'unknown_provider' };
  }

  if (requested === 'anthropic') {
    return anthropicKey
      ? { provider: 'anthropic', apiKey: anthropicKey }
      : { error: 'provider_key_missing' };
  }
  if (requested === 'gemini') {
    return geminiKey ? { provider: 'gemini', apiKey: geminiKey } : { error: 'provider_key_missing' };
  }

  if (anthropicKey) return { provider: 'anthropic', apiKey: anthropicKey };
  if (geminiKey) return { provider: 'gemini', apiKey: geminiKey };
  return { error: 'estimator_unconfigured' };
}

/** A message the developer can act on, for the failures that are config. */
function describeProviderError(error: ProviderError, provider: Provider, model: string): string {
  switch (error) {
    case 'model_not_found':
      return `${provider} has no model "${model}". Set ${provider === 'gemini' ? 'GEMINI_MODEL' : 'ANTHROPIC_MODEL'} to a current one.`;
    case 'unauthorized':
      return `The ${provider} API key was rejected.`;
    case 'bad_request':
      return `${provider} rejected the request shape.`;
    default:
      return '';
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const selected = selectProvider();
  if ('error' in selected) return json({ error: selected.error }, 503);

  let body: { image?: unknown; mediaType?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const image = typeof body.image === 'string' ? body.image : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';

  if (!image) return json({ error: 'no_image' }, 400);
  if (!ACCEPTED_MEDIA_TYPES.includes(mediaType)) {
    return json({ error: 'unsupported_media_type' }, 400);
  }
  if (base64Bytes(image) > MAX_IMAGE_BYTES) return json({ error: 'image_too_large' }, 413);

  const result =
    selected.provider === 'gemini'
      ? await estimateWithGemini(
          selected.apiKey,
          image,
          mediaType,
          Deno.env.get('GEMINI_MODEL') || GEMINI_MODEL,
        )
      : await estimateWithAnthropic(
          selected.apiKey,
          image,
          mediaType,
          Deno.env.get('ANTHROPIC_MODEL') || ANTHROPIC_MODEL,
        );

  if (!result.ok) {
    const detail = describeProviderError(result.error, selected.provider, result.model);
    return json(
      detail
        ? { error: result.error, provider: selected.provider, detail }
        : { error: result.error, provider: selected.provider },
      statusFor(result.error),
    );
  }

  // The provider and model come back so the app can show which one produced
  // an estimate — which is the whole point of being able to switch.
  return json({ estimate: result.estimate, provider: selected.provider, model: result.model });
});
