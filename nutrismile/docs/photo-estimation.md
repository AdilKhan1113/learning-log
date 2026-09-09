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

## Two providers, one prompt

Either Anthropic or Gemini can produce the estimate. The point is to be able to
put the same photographs to both and keep whichever reads plates better — so
the system prompt, the user prompt and the requested field set live in
`prompt.ts` and are shared. A difference in the estimates is then a difference
between the models, not between two prompts that drifted apart.

| File | Role |
|---|---|
| `prompt.ts` | The instructions and the shape, shared |
| `anthropic.ts` | Strict tool schema, `tool_choice: auto` |
| `gemini.ts` | `responseSchema` structured output |
| `index.ts` | HTTP, provider selection, validation of the request |

The app is untouched by the choice: it validates a provider-agnostic shape, and
the review screen prints whichever model answered so a comparison can actually
be attributed.

## Where the key is

The API key lives in the Edge Function and nowhere else. The device sends the
image; the function holds the key. Neither provider's error body is ever
forwarded, since both can echo request details.

```bash
# One or both:
supabase secrets set ANTHROPIC_API_KEY=...
supabase secrets set GEMINI_API_KEY=...

# Which to use. Unset means: whichever key is present, Anthropic if both.
supabase secrets set VISION_PROVIDER=gemini

# Optional model overrides.
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase secrets set ANTHROPIC_MODEL=claude-opus-5

supabase functions deploy estimate-meal
```

Flipping provider is `supabase secrets set VISION_PROVIDER=...` — no redeploy,
no app update, no reinstall on the phone.

Until a key is set the feature reports `unavailable`, which is treated as "not
set up yet" rather than as an error.

**Model ids are configuration, not constants.** Google's model names turn over
quickly and Anthropic's do too. A retired id comes back as `model_not_found`
with a message naming the variable to set, rather than as a mysterious 404.

## Model and cost

**This is the app's only per-use cost.** Everything else in NutriSmile is free
to run.

`claude-opus-5` at `effort: "low"` — the capable model, because estimating a
portion from a photograph is a perception and judgement task and the numbers go
into someone's food log; low effort because it is one bounded extraction
against a fixed schema with a user waiting on it. At $5/1M input and $25/1M
output, with a photo around 1–2k input tokens, an estimate lands somewhere near
2–4 cents.

`gemini-2.5-flash` is far cheaper and has a free tier, which is why the switch
exists. Whether it estimates portions as well is an open question that only
running both on real plates will answer — hence the model name on the review
screen.

Images are downscaled and sent at quality 0.6, capped at 5 MB server-side: a
45-second round trip is worse than a slightly softer image, and the model does
not need a full-resolution shot.

## Prompting

The system prompt asks for honesty over confidence, per-item confidence scores,
separate lines for a composed plate, and an empty list with a note when the
photo shows no food. It explicitly forbids inventing a food to make a plate look
complete — the failure mode that would quietly inflate someone's log.

On Anthropic, `tool_choice` is `auto` rather than forced: forcing a tool call is
rejected on some current models, and `strict: true` already guarantees the
arguments validate. On Gemini, `responseSchema` asks for the JSON directly,
which is the simpler of the two paths for a single fixed-shape extraction.

## Failure states

Distinguished, because they need different responses: not configured, offline,
timeout, image too large, rate limited, no food found, refused, unreadable
response, and other HTTP errors. Provider-side configuration failures — a
rejected key, a retired model id, a rejected request shape — come back with a
`detail` naming what to fix, and read to the user as "not set up yet". Two of them — unreadable and HTTP — say
explicitly that nothing was logged.

No message blames the user for their photo. A photo the model cannot read is a
limit of the estimator.

Camera and library permission refusals are handled in the hook, each offering
search as the alternative.

## Not verified against either API

The validator and the client are unit-tested with an injected `fetch`, and the
app compiles and bundles. But no photo has been through this: the Edge Function
has never been deployed, and neither model has seen a plate.

The Gemini path additionally could not be checked against Google's live
documentation — this environment's network policy blocks it — so it is written
from the documented `generateContent` shape rather than verified against it. If
the first call fails, the request body in `gemini.ts` is the thing to check
against current docs, and `GEMINI_MODEL` the first thing to try changing.

On the first real run, worth checking:

1. Whether portion estimates are plausible for foods you recognise.
2. Whether the two providers disagree materially on the same photo.
3. Whether `effort: "low"` (Anthropic) is enough.
