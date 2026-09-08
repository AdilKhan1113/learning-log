# Barcode scanning (Phase 3)

A scan resolves through four steps, each reached only if the one before it had
no answer:

```
 scan ──▶ parse + checksum ──▶ local cache ──▶ Open Food Facts ──▶ USDA ──▶ nothing
             (reject bad reads)   (no network)     (public)       (via our      │
                                                                Edge Function)  ▼
                                                                        create it, prefilled
```

The decision tree lives in `src/services/catalog/lookupBarcode.ts` with every
dependency injected, so all of it is unit-tested without a camera, a device, or
a network. That mattered more here than anywhere else in the app: this is the
one path a simulator cannot exercise.

## Why the checksum is verified

Cameras misread. A single wrong digit in a code of the right length is still a
valid-looking barcode, and looking it up would quietly return a different
product — the user would log someone else's food and never know. Every scan is
checksum-verified before it is used. The check can be waived for a hand-typed
code, where the user can see what they entered.

## Why a UPC-A is converted before lookup

The same product is a 12-digit UPC-A in the US, an 8-digit UPC-E on a small
packet, and a 13-digit EAN-13 in Europe. Open Food Facts keys products by their
EAN-13 form, so a US barcode looked up as scanned would never be found.

`parseBarcode` converts to the canonical form, and `lookupCandidates` returns
the other forms worth trying, because catalogues are inconsistent about whether
a US product is stored padded or unpadded. UPC-E is expanded to its full UPC-A
first — without that, small packets never match anything.

EAN-8 is left alone: it is its own namespace, not a short EAN-13, and padding
it would produce a code belonging to a different product.

## "Not found" and "couldn't check" are different

A product that every database says it does not have is a different situation
from a product nobody could be asked about. The first invites the user to add
it; the second tells them to try again when they are back online. Getting this
wrong means telling someone to type out a label the database already has,
because their train went into a tunnel.

The distinction is tracked by whether any source *answered*. A fallback that is
not configured yet has not answered anything, so it cannot turn an unreachable
Open Food Facts into a confident "not found" — that is the state the app ships
in today, and it is covered by a test.

## Prefilling from a partial record

A product can be listed without usable nutrition — no calories recorded, or
numbers that cannot be real. It is not cached, because there is nothing
loggable in it, but its name, brand and any plausible macros are carried into
the create-food form so the user completes a form rather than starting one.

Energy is deliberately never prefilled. It was either missing or implausible,
and a wrong number already sitting in the field is worse than an empty one.

## Where the API keys are

Open Food Facts is public and needs no key, so the device calls it directly.

USDA FoodData Central requires one. A key in a mobile bundle is a published
key, so the device never sees it: it calls `supabase/functions/food-lookup`,
which holds the key and forwards the request. That function is deliberately
thin — it does not interpret nutrition data, because the mapping belongs in
`src/services/usda/normalize.ts` where it is pure and unit-tested.

The function never forwards an upstream error body, which would echo a query
string built from the key.

Until Supabase is deployed the fallback reports `unavailable`, which is treated
as "not asked" rather than as an error. Deploying it is:

```bash
supabase secrets set USDA_API_KEY=...
supabase functions deploy food-lookup
```

## USDA search is textual

FoodData Central has no barcode endpoint — searching for a barcode returns
anything whose description happens to contain those digits. Only a food whose
own `gtinUpc` matches the scan is accepted. Without that check a scan would
cheerfully log an unrelated product.

## Camera states

| State | Behaviour |
|---|---|
| Permission not yet asked | Explains what the camera is for, then asks |
| Refused, can ask again | Offers the prompt again, and search as the alternative |
| Refused permanently | Links to Settings, and offers search |
| Granted | Camera runs, but only while the tab is focused |

A refusal is a decision the user is entitled to make, so it is met with the
alternative rather than with nagging. The camera stops when the tab loses
focus — a camera running behind another screen drains the battery and shows a
recording indicator for no reason.

Scanning is suspended while a result is on screen, so the decoder cannot
replace a result the user is still reading. One barcode is handled once, however
many times the camera reports it.

## Not verified on hardware

No part of this has run on a device. `tsc` is clean and the app bundles, the
decision tree and both mappers are unit-tested, but the camera itself — the
permission flow, the decode, the framing — has only ever been compiled. The
first run on hardware should check:

1. The permission prompt appears and the refusal path reaches Settings.
2. A real barcode decodes at all, and at a sensible distance.
3. A scan resolves to a product, not to a spinner.
4. Scanning the same item twice is instant the second time (the cache hit).
5. A US product decodes as UPC-A and still resolves — the padding conversion is
   the most likely thing to be wrong.
