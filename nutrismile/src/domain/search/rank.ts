/**
 * Ranking food search results.
 *
 * Pure and deterministic: `now` is passed in rather than read from the clock,
 * so recency boosts are testable. FTS5 supplies the candidates; this decides
 * what the user sees first.
 */
import { buildSearchText, normalize, tokenize } from './normalize.ts';
import { isSubsequence, similarity } from './fuzzy.ts';

/** What ranking needs to know about a food. */
export interface SearchCandidate {
  id: string;
  name: string;
  brand?: string | null;
  /** Must have been produced by buildSearchText. */
  searchText?: string;
  isFavorite?: boolean;
  isVerified?: boolean;
  /** Epoch ms of the last time this food was logged. */
  lastUsedAt?: number | null;
  useCount?: number;
  /** True for the user's own custom foods and recipes. */
  isCustom?: boolean;
}

export interface RankedFood<T extends SearchCandidate = SearchCandidate> {
  item: T;
  score: number;
  /** Why it matched, for debugging and for the "did you mean" affordance. */
  matchKind: MatchKind;
}

export type MatchKind =
  | 'exact'
  | 'prefix'
  | 'word_prefix'
  | 'contains'
  | 'all_tokens'
  | 'fuzzy'
  | 'subsequence'
  | 'none';

/** Base score for each way a query can match, before boosts. */
const MATCH_SCORES: Record<MatchKind, number> = {
  exact: 1,
  prefix: 0.9,
  word_prefix: 0.8,
  contains: 0.7,
  all_tokens: 0.62,
  fuzzy: 0.5,
  subsequence: 0.32,
  none: 0,
};

/** A fuzzy match below this is noise, not a typo. */
export const FUZZY_THRESHOLD = 0.7;

/** Boost ceilings. Kept small so relevance always outweighs familiarity. */
const BOOST = {
  favorite: 0.08,
  custom: 0.03,
  verified: 0.02,
  recency: 0.06,
  frequency: 0.05,
} as const;

/** Recency boost decays to nothing over this many days. */
const RECENCY_WINDOW_DAYS = 30;

/**
 * How well a query matches one food, ignoring familiarity.
 *
 * Checks run strongest-first and stop at the first hit, so a food whose name
 * starts with the query is never demoted to a fuzzy match.
 */
export function matchKind(query: string, candidate: SearchCandidate): MatchKind {
  const q = normalize(query);
  if (q === '') return 'none';

  const name = normalize(candidate.name);
  const text =
    candidate.searchText ?? buildSearchText(candidate.name, candidate.brand);

  if (name === q) return 'exact';
  if (name.startsWith(q)) return 'prefix';

  const textTokens = tokenize(text);
  if (textTokens.some((t) => t.startsWith(q))) return 'word_prefix';
  if (text.includes(q)) return 'contains';

  const queryTokens = tokenize(q);
  const everyTokenMatches = queryTokens.every((qt) =>
    textTokens.some((tt) => tt.startsWith(qt)),
  );
  if (everyTokenMatches) return 'all_tokens';

  // Typo tolerance, against the name and against each of its words, so a slip
  // in one word of a multi-word name still matches.
  const bestSimilarity = Math.max(
    similarity(q, name),
    ...textTokens.map((t) => similarity(q, t)),
  );
  if (bestSimilarity >= FUZZY_THRESHOLD) return 'fuzzy';

  if (isSubsequence(q, text.replace(/ /g, ''))) return 'subsequence';

  return 'none';
}

/**
 * Familiarity boost: favourites, recently used, frequently used, verified,
 * and the user's own foods. Additive and capped well below the gap between
 * match tiers, so a better match always beats a more familiar one.
 */
export function familiarityBoost(
  candidate: SearchCandidate,
  now: number,
): number {
  let boost = 0;
  if (candidate.isFavorite) boost += BOOST.favorite;
  if (candidate.isCustom) boost += BOOST.custom;
  if (candidate.isVerified) boost += BOOST.verified;

  if (candidate.lastUsedAt) {
    const days = (now - candidate.lastUsedAt) / 86_400_000;
    if (days >= 0 && days < RECENCY_WINDOW_DAYS) {
      boost += BOOST.recency * (1 - days / RECENCY_WINDOW_DAYS);
    }
  }

  const uses = candidate.useCount ?? 0;
  if (uses > 0) {
    // Logarithmic: the step from 1 to 5 uses matters, 50 to 100 does not.
    boost += BOOST.frequency * Math.min(1, Math.log10(uses + 1) / 2);
  }

  return boost;
}

export function scoreFood(
  query: string,
  candidate: SearchCandidate,
  now: number,
): { score: number; matchKind: MatchKind } {
  const kind = matchKind(query, candidate);
  if (kind === 'none') return { score: 0, matchKind: kind };
  return {
    score: MATCH_SCORES[kind] + familiarityBoost(candidate, now),
    matchKind: kind,
  };
}

export interface RankOptions {
  now?: number;
  limit?: number;
  /** Results scoring at or below this are dropped. */
  minScore?: number;
}

/**
 * Rank candidates for a query, best first.
 *
 * Ties break on the shorter name — "Rice" before "Rice, brown, cooked" — and
 * then alphabetically, so the order never depends on the order rows came back
 * from SQLite.
 */
export function rankFoods<T extends SearchCandidate>(
  query: string,
  candidates: readonly T[],
  options: RankOptions = {},
): RankedFood<T>[] {
  const { now = Date.now(), limit, minScore = 0 } = options;

  const ranked = candidates
    .map((item) => {
      const { score, matchKind: kind } = scoreFood(query, item, now);
      return { item, score, matchKind: kind };
    })
    .filter((r) => r.score > minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.item.name.length !== b.item.name.length) {
        return a.item.name.length - b.item.name.length;
      }
      return a.item.name.localeCompare(b.item.name);
    });

  return limit === undefined ? ranked : ranked.slice(0, limit);
}

/**
 * Turn a user's query into an FTS5 MATCH expression.
 *
 * Every token becomes a prefix term so results appear while typing. Tokens are
 * rebuilt from normalised text rather than passed through, which is also what
 * keeps quotes and operators in the raw input from reaching the FTS parser.
 */
export function toFtsQuery(query: string): string | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}
