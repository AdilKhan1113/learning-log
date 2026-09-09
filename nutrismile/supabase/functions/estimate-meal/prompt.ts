/**
 * The instructions and output shape, shared by every provider.
 *
 * Kept in one file so that switching provider changes only how the request is
 * made — never what the model is asked for. If the prompt drifted per
 * provider, comparing their estimates would tell you nothing.
 */

export const SYSTEM_PROMPT = `You estimate the nutritional content of meals from photographs for a food logging app.

Identify each distinct food in the photo and estimate its portion and nutrition. Use visible references for scale — cutlery, plate size, hands, packaging.

Be honest about uncertainty rather than confident and wrong. The person sees and edits every number before it is logged, so a clearly-flagged rough estimate is far more useful than a precise-looking guess.

- Report each food separately. Do not merge a composed plate into one line.
- Set confidence per item: high when the food and portion are both clear, low when either is obscured, ambiguous, or hidden under sauce.
- Calories must be consistent with the macros you give for the same item.
- If the photo does not show food, or is too dark or blurred to read, return an empty list and say why in the note.
- Never invent a food you cannot see to make a plate look complete.`;

export const USER_PROMPT =
  'Identify the foods in this photograph and report their estimated portions and nutrition.';

/** The fields every provider is asked for, in one place. */
export const FOOD_FIELDS = [
  'name',
  'grams',
  'kcal',
  'proteinG',
  'carbsG',
  'fatG',
  'confidence',
] as const;

export const FIELD_DESCRIPTIONS: Record<string, string> = {
  name: 'What the food is, as a person would say it.',
  grams: 'Estimated edible portion in grams.',
  kcal: 'Calories for this portion.',
  proteinG: 'Protein in grams for this portion.',
  carbsG: 'Carbohydrate in grams for this portion.',
  fatG: 'Fat in grams for this portion.',
  confidence: '0 to 1. How sure you are of this item and its portion.',
};

/** What a provider hands back to the request handler. */
export type ProviderResult =
  | { ok: true; estimate: unknown; model: string }
  | { ok: false; error: ProviderError; model: string };

export type ProviderError =
  | 'refused'
  | 'no_estimate'
  | 'rate_limited'
  | 'unauthorized'
  | 'model_not_found'
  | 'bad_request'
  | 'unreachable';

/** HTTP status for each provider failure. */
export function statusFor(error: ProviderError): number {
  switch (error) {
    case 'rate_limited':
      return 429;
    case 'refused':
    case 'no_estimate':
      return 422;
    case 'unauthorized':
    case 'model_not_found':
    case 'bad_request':
      return 503;
    case 'unreachable':
      return 502;
  }
}
