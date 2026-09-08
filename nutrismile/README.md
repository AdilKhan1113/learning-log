# NutriSmile

A nutrition tracker built to get a meal logged in under fifteen seconds.
React Native + Expo, TypeScript, local-first on SQLite, syncing to Supabase.

Logging and history work fully offline; changes queue locally and push when a
connection returns.

## Status

**Phase 1 in progress.** Data model and project structure are in place.
Manual logging and the dashboard come next.

| Phase | Scope | State |
|---|---|---|
| 1 | data model, manual logging, dashboard | schema done, features next |
| 2 | food database search and caching | not started |
| 3 | barcode scanning | not started |
| 4 | photo estimation | not started |
| 5 | progress charts, sync, polish | not started |

## Getting started

```bash
npm install
npx expo install --fix   # aligns native package versions with the Expo SDK
npm start
```

## Checks

```bash
npm run test:schema   # schema against real SQLite, no dependencies needed
npm test              # vitest over the pure functions in src/domain
npm run typecheck
```

## Where things are

`docs/architecture.md` walks the folder tree and the rules it enforces.
`docs/schema.md` explains the data model and why it is shaped this way.
The schema itself is `src/db/schema/001_init.sql`.

## Conventions

- `src/domain` is pure: no React, no SQLite, no network. Everything there is
  unit-tested.
- SQL lives only in `src/db/repositories`.
- API keys live in Supabase Edge Functions, never in the app bundle.
- Copy reports numbers and nothing else — no praise, no shaming, no judgement.
