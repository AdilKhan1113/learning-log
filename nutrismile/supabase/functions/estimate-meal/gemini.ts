/**
 * Meal estimation via the Gemini API.
 *
 * Uses `responseSchema` structured output rather than function calling: the
 * task is one extraction with a fixed shape, and asking for JSON directly is
 * the simpler of the two paths.
 *
 * The model id is configuration (`GEMINI_MODEL`) rather than a constant.
 * Google's model names turn over quickly, so a stale id should be a
 * `supabase secrets set` away, not a code change — and a wrong one comes back
 * as `model_not_found` with a message that says exactly that.
 */
import { FIELD_DESCRIPTIONS, type ProviderResult, SYSTEM_PROMPT, USER_PROMPT } from './prompt.ts';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * A current, inexpensive vision-capable model at the time of writing. Override
 * with GEMINI_MODEL; check Google's model list if this one has been retired.
 */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

const MAX_OUTPUT_TOKENS = 8192;

/**
 * Low but not zero: portion estimation should be steady between runs on the
 * same photo, without being so rigid that the model stops weighing what it
 * can see.
 */
const TEMPERATURE = 0.2;

const REQUEST_TIMEOUT_MS = 40_000;

/** OpenAPI-subset schema, which is what responseSchema accepts. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    foods: {
      type: 'ARRAY',
      description: 'One entry per distinct food visible. Empty if none.',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: FIELD_DESCRIPTIONS.name },
          grams: { type: 'NUMBER', description: FIELD_DESCRIPTIONS.grams },
          kcal: { type: 'NUMBER', description: FIELD_DESCRIPTIONS.kcal },
          proteinG: { type: 'NUMBER', description: FIELD_DESCRIPTIONS.proteinG },
          carbsG: { type: 'NUMBER', description: FIELD_DESCRIPTIONS.carbsG },
          fatG: { type: 'NUMBER', description: FIELD_DESCRIPTIONS.fatG },
          confidence: { type: 'NUMBER', description: FIELD_DESCRIPTIONS.confidence },
        },
        required: ['name', 'grams', 'kcal', 'proteinG', 'carbsG', 'fatG', 'confidence'],
      },
    },
    confidence: { type: 'NUMBER', description: '0 to 1 for the estimate as a whole.' },
    note: {
      type: 'STRING',
      nullable: true,
      description: 'Anything that limited the estimate: poor light, hidden food, ambiguity.',
    },
  },
  required: ['foods', 'confidence'],
};

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/** Finish reasons that mean the model declined rather than answered. */
const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

export async function estimateWithGemini(
  apiKey: string,
  image: string,
  mediaType: string,
  model = DEFAULT_MODEL,
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // The key goes in a header rather than the query string, so it stays
        // out of URLs and any logs that record them.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mediaType, data: image } },
              { text: USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: TEMPERATURE,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      }),
    });
  } catch {
    return { ok: false, error: 'unreachable', model };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The body can echo the request, so it is never forwarded.
    if (response.status === 429) return { ok: false, error: 'rate_limited', model };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'unauthorized', model };
    }
    if (response.status === 404) return { ok: false, error: 'model_not_found', model };
    if (response.status === 400) return { ok: false, error: 'bad_request', model };
    return { ok: false, error: 'unreachable', model };
  }

  let body: GeminiResponse;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'no_estimate', model };
  }

  if (body.promptFeedback?.blockReason) return { ok: false, error: 'refused', model };

  const candidate = body.candidates?.[0];
  if (!candidate) return { ok: false, error: 'no_estimate', model };
  if (candidate.finishReason && REFUSAL_REASONS.has(candidate.finishReason)) {
    return { ok: false, error: 'refused', model };
  }

  const text = candidate.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (text.trim() === '') return { ok: false, error: 'no_estimate', model };

  try {
    // responseMimeType is application/json, so this is JSON rather than prose.
    // A truncated response (finishReason MAX_TOKENS) fails to parse here,
    // which is the right outcome — half an estimate is not an estimate.
    return { ok: true, estimate: JSON.parse(text), model };
  } catch {
    return { ok: false, error: 'no_estimate', model };
  }
}
