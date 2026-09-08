/**
 * Text normalisation shared by the FTS index and the fuzzy ranker.
 *
 * Whatever is written into foods.search_text must be produced by this function,
 * or the ranking will score against text the index never saw.
 */

/** Lowercase, strip accents, reduce punctuation to spaces, collapse runs. */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalize(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/** The value stored in foods.search_text. */
export function buildSearchText(name: string, brand?: string | null): string {
  return normalize(brand ? `${name} ${brand}` : name);
}
