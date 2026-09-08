# The food database (Phase 2)

Search runs against the user's own foods first, then against Open Food Facts.
Remote results are written into the local catalogue and re-queried, so ranking
happens once, in the tested pure functions, and anything found once is
available offline afterwards.

```
 type ──▶ local FTS + pure ranker ──▶ results on screen        (~instant)
      └─▶ 500ms pause ──▶ Open Food Facts ──▶ map + validate
                                          └─▶ cache locally
                                              └─▶ re-run local query
                                                  └─▶ merged results
```

## Why cache-through rather than merge-in-memory

Merging two result lists means two ranking paths, two dedupe rules, and a
result that disappears when the network does. Writing remote results into the
same table means one ranking path, dedupe by the existing unique index on
`(source, source_id)`, and a catalogue that grows into exactly the foods this
user searches for. The second lookup of anything is local.

Cached rows are shared (`user_id IS NULL`) and are **not** queued for sync:
they are reproducible from the upstream database, and pushing them would spend
the user's bandwidth replicating a public catalogue.

## What gets rejected, and why

The payload is crowd-sourced. Anything written into the catalogue resurfaces in
every future search, so `normalize.ts` validates before storing and drops a
product rather than storing something wrong:

| Rejected | Reason |
|---|---|
| No code, or no name | Nothing to identify or display it by |
| No energy value at all | Calories are the one number the app is built on |
| Over 1000 kcal per 100 | Pure fat is ~900; higher means a per-package value was entered as per-100 |
| A macro over 100 g per 100 g | Physically impossible |
| Macros summing over 105 g | Same, with slack for rounding and water content |
| Zero energy but real macros | The energy field is wrong |

A rejected product skips itself. One bad record never fails the page — a page
with two bad products still returns the other twenty-three, and the skips are
counted for diagnostics rather than shown to the user.

## Awkward parts of the OFF schema

**Energy.** Recorded as `energy-kcal_100g` on most products but not all. Where
it is missing, `energy-kj_100g` or the generic `energy_100g` is converted at
4.184 kJ per kcal. The generic field is kilojoules unless the record says
otherwise.

**Sodium is in grams**, not milligrams, and is often absent when `salt_100g` is
present. Sodium is derived from salt at 1/2.5 when needed.

**Everything is named `*_100g`, including per-100-ml figures for drinks.** OFF
does not flag which is which. The package size is used as the signal — a
`quantity` of `330 ml` means the numbers are per 100 ml — with the serving size
as a fallback and grams as the default. This is a heuristic, and it is the
least certain thing in this layer.

**Serving sizes are free text**: `30 g`, `1 cup (240 ml)`, `2 biscuits (25 g)`.
A parenthesised measurement wins, because that is where the concrete amount
lives when the leading number counts items rather than measuring them. A
serving that cannot be converted to the food's basis unit yields no portion
rather than a guess.

## Failure states

Each is distinguished, because they need different responses:

| State | What the user sees |
|---|---|
| Offline | Local results, with a note that this is their own foods only |
| Timeout | Local results, with a note that the database was slow |
| HTTP error | Local results, with the status |
| Malformed response | A note that the response could not be read |
| Query under 3 characters | No request is made at all |
| No match anywhere | An offer to create the food, prefilled |

A remote failure never clears what is already on screen, and an empty list is
never shown as though nothing matched when the truth is that nothing was
asked.

## Cache housekeeping

`pruneCache()` runs at startup and drops catalogue rows older than 60 days that
were never logged, favourited, or referenced by an entry or a recipe. Custom
foods are never pruned. Without this, a year of searching leaves thousands of
foods the user never chose.

## Not yet built

**USDA / Nutritionix fallback.** Both need API keys, so they belong behind a
Supabase Edge Function rather than in the client bundle. The brief places that
fallback with barcode lookup, so it lands in Phase 3 alongside the scanner and
the Edge Function that fronts it.

## A caveat worth knowing

This environment's network policy blocks `world.openfoodfacts.org`, so the
client was written against the documented API schema and tested against
fixtures rather than live responses. The field mapping, the validation rules
and every failure path are covered by tests with an injected `fetch`, but the
first run against the real API should be spot-checked — particularly the
per-100-ml heuristic and the shape of `cgi/search.pl`.
