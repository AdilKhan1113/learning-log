# NutriSmile

A nutrition tracker built to get a meal logged in under fifteen seconds.
React Native + Expo, TypeScript, local-first on SQLite, syncing to Supabase.

Logging and history work fully offline; changes queue locally and push when a
connection returns.

## Status

**Phases 1–4 complete, Phase 5 in progress.** Logging, the dashboard, search
against Open Food Facts with local caching, barcode scanning, photo estimation,
and the Progress screen. Cloud sync is the remaining piece.

Nothing has run on a device yet, so the camera path is compiled and unit-tested
but not hardware-verified — see `docs/barcode-scanning.md`.

| Phase | Scope | State |
|---|---|---|
| 1 | data model, manual logging, dashboard | done |
| 2 | food database search and caching | done |
| 3 | barcode scanning, USDA fallback | done (untested on hardware) |
| 4 | photo estimation | done (untested on hardware) |
| 5 | progress charts, sync, polish | charts, weight log and streak done; sync not started |

The Scan and Progress tabs say what they will do rather than showing a camera
or a chart that cannot yet work.

## Getting started

Built on **Expo SDK 57**, which is what current Expo Go supports — the SDK has
to match, since Expo Go only ever runs the latest one.

```bash
npm ci
npm start
```

Then scan the QR code with Expo Go (Android) or the Camera app (iOS). Phone and
computer need to be on the same network; `npm start -- --tunnel` routes around
it when they are not.

## Backend features (optional)

Barcode scanning and search work with no backend at all. Photo estimation and
the USDA barcode fallback go through Supabase Edge Functions, which hold the
API keys — copy `.env.example` to `.env` and fill in your project's URL and
anon key, then see `docs/photo-estimation.md` for the function secrets.

Without a `.env`, those two features report "not set up yet" and everything
else works normally.

## Checks

```bash
npm test          # schema sync, domain + service tests, repository SQL, schema smoke
npm run typecheck # tsc --noEmit
```

`npm test` needs no dependencies installed — it runs on Node's own test runner
and native type stripping, against `node:sqlite`.

## Verified

- 395 tests passing.
- `tsc --noEmit` clean across all source files.
- `expo export` bundles: 1786 modules to a Hermes bytecode bundle.

Open Food Facts itself is blocked by this environment's network policy, so the
client is tested against fixtures with an injected `fetch`, not live responses.
`docs/food-database.md` says what to spot-check on a real device.

## Where things are

`docs/architecture.md` walks the folder tree and the rules it enforces.
`docs/schema.md` explains the data model and why it is shaped this way.
`docs/food-database.md` covers search, caching and the OFF mapping rules.
`docs/barcode-scanning.md` covers the scan pipeline and where the API keys live.
`docs/photo-estimation.md` covers the vision estimator, its two providers, its
validation and its cost.
The schema itself is `src/db/schema/001_init.sql`.

## Conventions

- `src/domain` is pure: no React, no SQLite, no network. Everything there is
  unit-tested.
- SQL lives only in `src/db/repositories`, and every statement in it is
  prepared against the real schema by `tests/db/repository-sql.test.mjs`.
- Imports carry explicit `.ts` / `.tsx` extensions. Node's type stripping
  resolves them literally, which is what lets the tests run with no bundler;
  Metro resolves them the same way.
- `src/db/schema/init.ts` is generated from the `.sql` file. Edit the SQL and
  run `npm run build:schema`; `npm test` fails if the two have drifted.
- API keys live in Supabase Edge Functions, never in the app bundle.
- Copy reports numbers and nothing else — no praise, no shaming, no judgement.
