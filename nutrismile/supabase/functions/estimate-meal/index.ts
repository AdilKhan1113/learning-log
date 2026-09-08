/**
 * estimate-meal — identify foods in a photo and estimate their nutrition.
 *
 * The Anthropic API key lives here and only here. A key shipped in a mobile
 * bundle is a published key, so the device sends the image to this function
 * and never talks to the model directly.
 *
 * The response is deliberately not interpreted here beyond being handed back
 * as JSON: validation lives in the app at src/services/vision/schema.ts, where
 * it is pure and unit-tested. This function's job is the key and the prompt.
 *
 * Deploy:
 *   supabase secrets set ANTHROPIC_API_KEY=...
 *   supabase functions deploy estimate-meal
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70.0';

/**
 * Claude Opus 5. Estimating portions from a photo is a perception and
 * judgement task, and the numbers go into someone's food log, so this uses the
 * capable model rather than the cheap one.
 *
 * Effort is low because this is one bounded extraction with a fixed schema and
 * a user waiting on it, not open-ended reasoning. Raise it if portion accuracy
 * proves disappointing in practice.
 */
const MODEL = 'claude-opus-5';
const EFFORT = 'low';

/** Room for the tool call plus adaptive thinking, which counts toward this. */
const MAX_TOKENS = 8000;

/** Images larger than this are rejected before reaching the model. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You estimate the nutritional content of meals from photographs for a food logging app.

Identify each distinct food in the photo and estimate its portion and nutrition. Use visible references for scale — cutlery, plate size, hands, packaging.

Be honest about uncertainty rather than confident and wrong. The person sees and edits every number before it is logged, so a clearly-flagged rough estimate is far more useful than a precise-looking guess.

- Report each food separately. Do not merge a composed plate into one line.
- Set confidence per item: high when the food and portion are both clear, low when either is obscured, ambiguous, or hidden under sauce.
- Calories must be consistent with the macros you give for the same item.
- If the photo does not show food, or is too dark or blurred to read, return an empty list and say why in the note.
- Never invent a food you cannot see to make a plate look complete.`;

/** Strict schema: the model's arguments are guaranteed to validate against it. */
const REPORT_TOOL = {
  name: 'report_meal',
  description: 'Report the foods identified in the photograph and their estimated nutrition.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      foods: {
        type: 'array',
        description: 'One entry per distinct food visible. Empty if none.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'What the food is, as a person would say it.' },
            grams: { type: 'number', description: 'Estimated edible portion in grams.' },
            kcal: { type: 'number' },
            proteinG: { type: 'number' },
            carbsG: { type: 'number' },
            fatG: { type: 'number' },
            confidence: {
              type: 'number',
              description: '0 to 1. How sure you are of this item and its portion.',
            },
          },
          required: ['name', 'grams', 'kcal', 'proteinG', 'carbsG', 'fatG', 'confidence'],
          additionalProperties: false,
        },
      },
      confidence: { type: 'number', description: '0 to 1 for the estimate as a whole.' },
      note: {
        type: ['string', 'null'],
        description: 'Anything that limited the estimate: poor light, hidden food, ambiguity.',
      },
    },
    required: ['foods', 'confidence', 'note'],
    additionalProperties: false,
  },
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

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'estimator_unconfigured' }, 503);

  let body: { image?: unknown; mediaType?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const image = typeof body.image === 'string' ? body.image : '';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : 'image/jpeg';

  if (!image) return json({ error: 'no_image' }, 400);
  if (!ACCEPTED_MEDIA_TYPES.includes(mediaType as (typeof ACCEPTED_MEDIA_TYPES)[number])) {
    return json({ error: 'unsupported_media_type' }, 400);
  }
  if (base64Bytes(image) > MAX_IMAGE_BYTES) {
    return json({ error: 'image_too_large' }, 413);
  }

  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: { effort: EFFORT },
      tools: [REPORT_TOOL],
      // `auto` rather than a forced call: forcing is rejected on some current
      // models, and a strict schema already guarantees valid arguments.
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            {
              type: 'text',
              text: 'Identify the foods in this photograph and report them with the report_meal tool.',
            },
          ],
        },
      ],
    });
  } catch (error) {
    // Never forward the provider's error body: it can echo request details.
    const status = (error as { status?: number }).status;
    if (status === 429) return json({ error: 'rate_limited' }, 429);
    return json({ error: 'estimator_unreachable' }, 502);
  }

  if (response.stop_reason === 'refusal') {
    return json({ error: 'refused' }, 422);
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'report_meal',
  );

  if (!toolUse) {
    // The model answered in prose instead of calling the tool. Nothing
    // structured to return, and guessing at its text would defeat the schema.
    return json({ error: 'no_estimate' }, 422);
  }

  return json({ estimate: toolUse.input });
});
