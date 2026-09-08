/**
 * Fuzzy string matching.
 *
 * SQLite's FTS5 index narrows thousands of foods to a candidate set; these
 * functions decide the order the user actually sees, and they tolerate the
 * typos and partial words someone makes while typing one-handed.
 */

/**
 * Damerau-Levenshtein distance with an early exit.
 *
 * Transpositions are counted as one edit, not two, because "chikcen" is a
 * single slip of the fingers and should rank as close to "chicken" as
 * "chiken" does. `maxDistance` bounds the work: once every cell in a row
 * exceeds it, no completion can come in under it, so the walk stops.
 */
export function editDistance(a: string, b: string, maxDistance = Infinity): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let prevPrev: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;

    for (let j = 1; j <= b.length; j++) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        prev[j]! + 1, // deletion
        current[j - 1]! + 1, // insertion
        prev[j - 1]! + substitution, // substitution
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, prevPrev[j - 2]! + 1); // transposition
      }

      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > maxDistance) return maxDistance + 1;

    prevPrev = prev;
    prev = current;
    current = new Array(b.length + 1);
  }

  return prev[b.length]!;
}

/**
 * Edit distance expressed as 0–1, where 1 is identical.
 *
 * Scores below 0.5 collapse to exactly 0. Computing a precise distance between
 * two strings that far apart is wasted work — no caller distinguishes
 * "unrelated" from "very unrelated" — so the walk is capped at half the longer
 * string and anything past it reports 0 rather than an inflated partial score.
 * Every value above 0.5, which is the range the ranker actually reasons about,
 * is exact.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const cap = Math.floor(longest / 2);
  const distance = editDistance(a, b, cap);
  if (distance > cap) return 0;
  return Math.max(0, 1 - distance / longest);
}

/**
 * Whether every character of `query` appears in `text` in order.
 * This is what makes "chkbrst" find "chicken breast".
 */
export function isSubsequence(query: string, text: string): boolean {
  if (query === '') return true;
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}
