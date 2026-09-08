import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchText, normalize, tokenize } from '../../src/domain/search/normalize.ts';
import { editDistance, isSubsequence, similarity } from '../../src/domain/search/fuzzy.ts';
import {
  type SearchCandidate,
  matchKind,
  rankFoods,
  toFtsQuery,
} from '../../src/domain/search/rank.ts';

describe('normalisation', () => {
  test('lowercases and collapses punctuation', () => {
    assert.equal(normalize('Ben & Jerry’s  Ice-Cream!'), 'ben jerry s ice cream');
  });

  test('strips accents so "puree" finds "purée"', () => {
    assert.equal(normalize('Purée'), 'puree');
    assert.equal(normalize('Jalapeño'), 'jalapeno');
  });

  test('tokenises, and an empty string yields no tokens', () => {
    assert.deepEqual(tokenize('Greek Yogurt, plain'), ['greek', 'yogurt', 'plain']);
    assert.deepEqual(tokenize('   '), []);
  });

  test('search text combines name and brand', () => {
    assert.equal(buildSearchText('Skyr', 'Arla'), 'skyr arla');
    assert.equal(buildSearchText('Skyr', null), 'skyr');
  });
});

describe('edit distance', () => {
  test('identical strings are zero apart', () => {
    assert.equal(editDistance('chicken', 'chicken'), 0);
  });

  test('one substitution', () => {
    assert.equal(editDistance('chicken', 'chicken'.replace('c', 'k')), 1);
  });

  test('a transposition counts as one edit, not two', () => {
    assert.equal(editDistance('chikcen', 'chicken'), 1);
  });

  test('an empty string costs the length of the other', () => {
    assert.equal(editDistance('', 'rice'), 4);
    assert.equal(editDistance('rice', ''), 4);
  });

  test('the cap short-circuits without lying about being under it', () => {
    const capped = editDistance('aaaaaaaa', 'bbbbbbbb', 2);
    assert.ok(capped > 2);
  });

  test('similarity is 1 for identical and high for a typo', () => {
    assert.equal(similarity('rice', 'rice'), 1);
    assert.ok(similarity('rice', 'rise') > 0.7);
    assert.equal(similarity('chikcen', 'chicken'), 1 - 1 / 7);
  });

  test('unrelated words collapse to exactly zero, not a partial score', () => {
    assert.equal(similarity('rice', 'banana'), 0);
    assert.equal(similarity('a', 'zzzzzzzzzz'), 0);
  });

  test('every score above the collapse point is exact', () => {
    // One edit apart, so the score must be exactly 1 - 1/length.
    for (const [a, b, len] of [['rice', 'rise', 4], ['oats', 'oat', 4], ['milk', 'milks', 5]] as const) {
      assert.equal(similarity(a, b), 1 - 1 / len, `${a} vs ${b}`);
    }
  });
});

describe('subsequence', () => {
  test('initials find the full phrase', () => {
    assert.ok(isSubsequence('chkbrst', 'chickenbreast'));
  });

  test('order matters', () => {
    assert.ok(!isSubsequence('tsaob', 'abcdefghijklmnopqrst'));
  });

  test('an empty query matches anything', () => {
    assert.ok(isSubsequence('', 'anything'));
  });
});

describe('match kinds', () => {
  const food = (name: string, brand?: string): SearchCandidate => ({
    id: name,
    name,
    brand: brand ?? null,
    searchText: buildSearchText(name, brand),
  });

  test('exact name', () => {
    assert.equal(matchKind('banana', food('Banana')), 'exact');
  });

  test('prefix of the name', () => {
    assert.equal(matchKind('ban', food('Banana')), 'prefix');
  });

  test('prefix of a later word', () => {
    assert.equal(matchKind('brown', food('Rice, brown, cooked')), 'word_prefix');
  });

  test('every query word matches some word', () => {
    assert.equal(matchKind('brown ric', food('Rice, brown, cooked')), 'all_tokens');
  });

  test('a typo still matches', () => {
    assert.equal(matchKind('chikcen', food('Chicken')), 'fuzzy');
  });

  test('an unrelated word does not match', () => {
    assert.equal(matchKind('helicopter', food('Banana')), 'none');
  });

  test('an empty query matches nothing', () => {
    assert.equal(matchKind('', food('Banana')), 'none');
  });

  test('the brand is searchable', () => {
    assert.notEqual(matchKind('arla', food('Skyr', 'Arla')), 'none');
  });
});

describe('ranking', () => {
  const now = Date.UTC(2026, 8, 8);
  const day = 86_400_000;

  const candidates: SearchCandidate[] = [
    { id: '1', name: 'Chicken breast, raw', searchText: 'chicken breast raw' },
    { id: '2', name: 'Chicken', searchText: 'chicken' },
    { id: '3', name: 'Chicken thigh, roasted', searchText: 'chicken thigh roasted' },
    { id: '4', name: 'Chickpeas', searchText: 'chickpeas' },
    { id: '5', name: 'Banana', searchText: 'banana' },
  ];

  test('drops candidates that do not match at all', () => {
    const results = rankFoods('chicken', candidates, { now });
    assert.ok(!results.some((r) => r.item.id === '5'), 'banana must not appear');
  });

  test('an exact match outranks a longer name containing it', () => {
    const results = rankFoods('chicken', candidates, { now });
    assert.equal(results[0]?.item.id, '2');
  });

  test('ties break on the shorter name, not on input order', () => {
    const shuffled = [...candidates].reverse();
    const a = rankFoods('chicken', candidates, { now }).map((r) => r.item.id);
    const b = rankFoods('chicken', shuffled, { now }).map((r) => r.item.id);
    assert.deepEqual(a, b, 'ranking must not depend on row order from SQLite');
  });

  test('a favourite is boosted above an equal non-favourite', () => {
    const results = rankFoods(
      'chicken t',
      [
        { id: 'plain', name: 'Chicken thigh', searchText: 'chicken thigh' },
        { id: 'fav', name: 'Chicken thigh', searchText: 'chicken thigh', isFavorite: true },
      ],
      { now },
    );
    assert.equal(results[0]?.item.id, 'fav');
  });

  test('a recently logged food is boosted above an identical stale one', () => {
    const results = rankFoods(
      'oats',
      [
        { id: 'old', name: 'Oats', searchText: 'oats', lastUsedAt: now - 200 * day },
        { id: 'new', name: 'Oats', searchText: 'oats', lastUsedAt: now - 1 * day },
      ],
      { now },
    );
    assert.equal(results[0]?.item.id, 'new');
  });

  test('familiarity never beats a genuinely better match', () => {
    const results = rankFoods(
      'chickpeas',
      [
        {
          id: 'familiar',
          name: 'Chicken',
          searchText: 'chicken',
          isFavorite: true,
          isVerified: true,
          isCustom: true,
          useCount: 500,
          lastUsedAt: now,
        },
        { id: 'exact', name: 'Chickpeas', searchText: 'chickpeas' },
      ],
      { now },
    );
    assert.equal(results[0]?.item.id, 'exact');
  });

  test('a future lastUsedAt does not produce a bogus boost', () => {
    const results = rankFoods(
      'oats',
      [
        { id: 'future', name: 'Oats', searchText: 'oats', lastUsedAt: now + 10 * day },
        { id: 'normal', name: 'Oats', searchText: 'oats' },
      ],
      { now },
    );
    assert.equal(results.length, 2);
    assert.equal(results[0]?.score, results[1]?.score);
  });

  test('respects the limit', () => {
    assert.equal(rankFoods('chicken', candidates, { now, limit: 2 }).length, 2);
  });

  test('an empty query returns nothing rather than everything', () => {
    assert.equal(rankFoods('', candidates, { now }).length, 0);
  });
});

describe('FTS query building', () => {
  test('every token becomes a prefix term', () => {
    assert.equal(toFtsQuery('chicken br'), '"chicken"* AND "br"*');
  });

  test('an empty query is null, so the caller can skip the search', () => {
    assert.equal(toFtsQuery('   '), null);
  });

  test('FTS operators in user input cannot reach the parser', () => {
    const built = toFtsQuery('rice OR "banana" NEAR/2');
    assert.equal(built, '"rice"* AND "or"* AND "banana"* AND "near"* AND "2"*');
  });
});
