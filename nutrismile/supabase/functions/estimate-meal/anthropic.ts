/**
 * Meal estimation via the Anthropic API.
 *
 * Uses a strict tool schema, which guarantees the arguments validate against
 * it. `tool_choice` is `auto` rather than forced: forcing a call is rejected
 * on some current models, and `strict` already does the job.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70.0';
import { FIELD_DESCRIPTIONS, type ProviderResult, SYSTEM_PROMPT, USER_PROMPT } from './prompt.ts';

export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * One bounded extraction against a fixed schema with a user waiting on it, so
 * effort is low. Raise it if portion accuracy disappoints.
 */
const EFFORT = 'low';

/** Room for the tool call plus adaptive thinking, which counts toward this. */
const MAX_TOKENS = 8000;

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
            name: { type: 'string', description: FIELD_DESCRIPTIONS.name },
            grams: { type: 'number', description: FIELD_DESCRIPTIONS.grams },
            kcal: { type: 'number', description: FIELD_DESCRIPTIONS.kcal },
            proteinG: { type: 'number', description: FIELD_DESCRIPTIONS.proteinG },
            carbsG: { type: 'number', description: FIELD_DESCRIPTIONS.carbsG },
            fatG: { type: 'number', description: FIELD_DESCRIPTIONS.fatG },
            confidence: { type: 'number', description: FIELD_DESCRIPTIONS.confidence },
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

export async function estimateWithAnthropic(
  apiKey: string,
  image: string,
  mediaType: string,
  model = DEFAULT_MODEL,
): Promise<ProviderResult> {
  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: { effort: EFFORT },
      tools: [REPORT_TOOL],
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 429) return { ok: false, error: 'rate_limited', model };
    if (status === 401 || status === 403) return { ok: false, error: 'unauthorized', model };
    if (status === 404) return { ok: false, error: 'model_not_found', model };
    if (status === 400) return { ok: false, error: 'bad_request', model };
    return { ok: false, error: 'unreachable', model };
  }

  if (response.stop_reason === 'refusal') return { ok: false, error: 'refused', model };

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'report_meal',
  );

  // Answering in prose instead of calling the tool leaves nothing structured
  // to return, and guessing at the text would defeat the schema.
  if (!toolUse) return { ok: false, error: 'no_estimate', model };

  return { ok: true, estimate: toolUse.input, model };
}
