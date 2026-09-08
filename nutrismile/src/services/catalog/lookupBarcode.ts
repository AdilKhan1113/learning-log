/**
 * Resolving a scanned barcode to a food.
 *
 * The order is cache, then Open Food Facts, then USDA, then nothing. Each step
 * is only reached if the one before it had no answer, so the common case — a
 * product scanned before — costs a single local query and no network at all.
 *
 * Every dependency is injected, so the whole decision tree is testable without
 * a device, a camera, or a network. That matters here more than anywhere else
 * in the app: this is the one path that cannot be exercised in a simulator.
 */
import { type Result, ok } from '../../domain/result.ts';
import { type CanonicalBarcode, lookupCandidates } from '../../domain/barcode.ts';
import type { MappedFood, PartialFood } from '../openfoodfacts/normalize.ts';
import type { LookupError, ProductLookup } from '../openfoodfacts/client.ts';
import type { FallbackError } from '../usda/client.ts';

/** A food already in the local catalogue. */
export interface CachedFood {
  id: string;
  name: string;
}

export type BarcodeOutcome =
  /** Already in the local catalogue. No network was needed. */
  | { kind: 'cached'; foodId: string; name: string }
  /** Found upstream and now cached locally, so it has a local id like any
   *  other food and is opened the same way. */
  | { kind: 'found'; foodId: string; food: MappedFood; source: 'openfoodfacts' | 'usda' }
  /**
   * Every source answered, and none of them has a loggable version of this
   * product. The scan itself was fine — this is the "offer to create it" case.
   * `partial` carries anything readable from a product that was present but
   * not loggable, so the form can be prefilled rather than blank.
   */
  | { kind: 'not_found'; barcode: string; partial: PartialFood | null }
  /**
   * Nothing could be asked. The product may well exist; we could not find out.
   * Distinct from not_found because the screen must not invite the user to
   * retype a label the database already has.
   */
  | { kind: 'unreachable'; barcode: string; reason: string };

export interface LookupDeps {
  /** Local catalogue lookup by barcode. */
  findCached: (candidates: readonly string[]) => Promise<CachedFood | null>;
  /** Open Food Facts: found, present-but-unusable, or absent. */
  lookupOff: (barcode: string) => Promise<Result<ProductLookup, LookupError>>;
  /** USDA, behind our Edge Function. */
  lookupFallback: (
    candidates: readonly string[],
  ) => Promise<Result<MappedFood | null, FallbackError>>;
  /**
   * Persist anything found upstream, so the next scan is a cache hit.
   * Returns the local id of the row written.
   */
  cache: (food: MappedFood, source: 'openfoodfacts' | 'usda') => Promise<string>;
  /** Rendered when no source could be reached. */
  describeError: (error: LookupError | FallbackError) => string;
}

/**
 * Resolve a scanned barcode.
 *
 * A source that fails is not the same as a source that answers "no". If every
 * source that answered said no, the product is genuinely absent. If none of
 * them could be reached, the outcome is `unreachable` — because telling
 * someone to type a label out by hand when the database probably has it, and
 * the real problem is a dropped connection, is the wrong instruction.
 */
export async function resolveBarcode(
  barcode: CanonicalBarcode,
  deps: LookupDeps,
): Promise<BarcodeOutcome> {
  const candidates = lookupCandidates(barcode);

  const cached = await deps.findCached(candidates);
  if (cached) return { kind: 'cached', foodId: cached.id, name: cached.name };

  /** Set by any source that failed rather than answering. */
  let firstFailure: string | null = null;
  /** True once some source has actually answered "not here". */
  let answered = false;
  /** Kept from a product that existed but could not be logged. */
  let partial: PartialFood | null = null;

  for (const candidate of candidates) {
    const result = await deps.lookupOff(candidate);
    if (result.ok) {
      answered = true;
      if (result.value.kind === 'found') {
        const food = result.value.food;
        const foodId = await deps.cache(food, 'openfoodfacts');
        return { kind: 'found', foodId, food, source: 'openfoodfacts' };
      }
      if (result.value.kind === 'unusable') {
        partial ??= result.value.partial;
      }
    } else {
      firstFailure ??= deps.describeError(result.error);
      // A source that is down will be down for the other candidate forms too.
      break;
    }
  }

  const fallback = await deps.lookupFallback(candidates);
  if (fallback.ok) {
    // A fallback that is not configured yet has not answered anything, so it
    // must not turn an unreachable OFF into a confident "not found".
    answered = true;
    if (fallback.value) {
      const foodId = await deps.cache(fallback.value, 'usda');
      return { kind: 'found', foodId, food: fallback.value, source: 'usda' };
    }
  } else if (fallback.error.code !== 'unavailable') {
    firstFailure ??= deps.describeError(fallback.error);
  }

  if (answered) return { kind: 'not_found', barcode: barcode.scanned, partial };

  return {
    kind: 'unreachable',
    barcode: barcode.scanned,
    reason: firstFailure ?? 'No food database could be reached.',
  };
}

/** Convenience for the screen: what to say for each outcome. */
export function describeOutcome(outcome: BarcodeOutcome): string {
  switch (outcome.kind) {
    case 'cached':
    case 'found':
      return outcome.kind === 'found' ? outcome.food.name : outcome.name;
    case 'not_found':
      return outcome.partial?.name
        ? `${outcome.partial.name} is listed, but without nutrition information. Fill it in once and the next scan will have it.`
        : `No product found for ${outcome.barcode}. You can add it yourself and the next scan will find it.`;
    case 'unreachable':
      return `${outcome.reason} Scan again when you're back online, or add this food by hand.`;
  }
}

export { ok };
