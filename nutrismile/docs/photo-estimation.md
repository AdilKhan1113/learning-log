# Photo estimation (Phase 4)

Photograph a meal, get an editable estimate, confirm it, log it. Nothing an AI
produces reaches the log without the user pressing the button.

```
 photo ──▶ estimate-meal Edge Function ──▶ Claude Opus 5 (vision, strict tool)
                (holds the API key)                    │
                                                       ▼
 log ◀── confirm ◀── edit portions ◀── validate ◀── strict JSON
        (the only write)              (on device, tested)
```

## Nothing is logged silently

`useMealEstimate` exposes exactly one function that writes — `confirm` — and it
is reachable only from a button the user presses on the review screen. The
estimate is a proposal: every line can have its portion corrected, every line
can be removed, and the whole thing can be discarded.

Entries written this way carry `entry_source = 'photo_ai'`, `is_estimate = 1`
and the model's `ai_confidence`. The **Estimate** tag on the Today screen has
been rendering from that column since Phase 1; this is what finally sets it.

## Validation, even though the schema is strict

The tool schema constrains what the model can return, so why validate again?
Because the response crosses a network boundary before it reaches the device,
and an estimate that lands in the log unchecked puts invented numbers into a
day's totals. `src/services/vision/schema.ts` rejects:

| Rejected | Why |
|---|---|
| No name | Nothing to show or log |
| Portion ≤ 0, or over 3 kg | Not a plausible single item on a plate |
| Over 9.5 kcal per gram | Exceeds pure fat |
| Macros heavier than the food | Physically impossible |
| Calories and macros disagreeing by over 40% | The line was not thought through |

Bad lines are **dropped, not corrected**. An estimate the user is about to
confirm should be the model's actual guess, not one the app quietly repaired.
The review screen names what was left out.

Confidence is the exception: a value outside 0–1 is clamped rather than
rejected, since a miscalibrated number is not a reason to lose the line.

Overall confidence, when the model does not give one, is the **minimum** across
items rather than the mean — a plate is only as well understood as its least
certain part.

## Where the key is

`ANTHROPIC_API_KEY` lives in the Edge Function and nowhere else. The device
sends the image; the function holds the key. It never forwards the provider's
error body, which can echo request details.

```bash
supabase secrets set ANTHROPIC_API_KEY=...
supabase functions deploy estimate-meal
```

Until that is deployed the feature reports `unavailable`, which is treated as
"not set up yet" rather than as an error.

## Model and cost

`claude-opus-5` at `effort: "low"`. Estimating a portion from a photograph is a
perception and judgement task and the numbers go into someone's food log, so
this uses the capable model; effort is low because it is one bounded extraction
against a fixed schema with a user waiting on it.

**This is the app's only per-use cost.** Opus 5 is $5/1M input, $25/1M output;
a photo is roughly 1–2k input tokens, so an estimate is somewhere around
2–4 cents. Everything else in NutriSmile is free to run. If that proves too
expensive at volume, the lever is `MODEL` and `EFFORT` at the top of the
function — `claude-sonnet-5` is a fifth of the price — but that is a quality
tradeoff to make deliberately, and worth measuring against real photos first.

Images are downscaled and sent at quality 0.6, capped at 5 MB server-side: a
45-second round trip is worse than a slightly softer image, and the model does
not need a full-resolution shot.

## Prompting

The system prompt asks for honesty over confidence, per-item confidence scores,
separate lines for a composed plate, and an empty list with a note when the
photo shows no food. It explicitly forbids inventing a food to make a plate look
complete — the failure mode that would quietly inflate someone's log.

`tool_choice` is `auto` rather than forced: forcing a tool call is rejected on
some current models, and `strict: true` already guarantees the arguments
validate.

## Failure states

Distinguished, because they need different responses: not configured, offline,
timeout, image too large, rate limited, no food found, refused, unreadable
response, and other HTTP errors. Two of them — unreadable and HTTP — say
explicitly that nothing was logged.

No message blames the user for their photo. A photo the model cannot read is a
limit of the estimator.

Camera and library permission refusals are handled in the hook, each offering
search as the alternative.

## Not verified on hardware

The validator and the client are unit-tested with an injected `fetch`, and the
app compiles and bundles. But no photo has been through this: the Edge Function
has never been deployed, and the model has never seen a plate. On the first real
run, check whether portion estimates are plausible for familiar foods, and
whether `effort: "low"` is enough — those are the two things most likely to need
tuning.
