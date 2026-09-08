# NutriSmile

A nutrition tracker built to get a meal logged in under fifteen seconds.
React Native + Expo, TypeScript, local-first on SQLite, syncing to Supabase.

Logging and history work fully offline; changes queue locally and push when a
connection returns.

## Status

**Phase 1 complete.** Data model, manual food logging and the dashboard work
end to end.

| Phase | Scope | State |
|---|---|---|
| 1 | data model, manual logging, dashboard | done |
| 2 | food database search and caching | search is built; the remote catalogue is not |
| 3 | barcode scanning | not started |
| 4 | photo estimation | not started |
| 5 | progress charts, sync, polish | schema and outbox ready; nothing drains them yet |

The Scan and Progress tabs say what they will do rather than showing a camera
or a chart that cannot yet work.

## Getting started

```bash
npm install
npm start
```

## Checks

```bash
npm test          # schema sync, 123 domain tests, repository SQL, schema smoke
npm run typecheck # tsc --noEmit
```

`npm test` needs no dependencies installed — it runs on Node's own test runner
and native type stripping, against `node:sqlite`.

## Verified

- 161 tests passing.
- `tsc --noEmit` clean across all 30 source files.
- `expo export` bundles: 1544 modules to a Hermes bytecode bundle.

## Where things are

`docs/architecture.md` walks the folder tree and the rules it enforces.
`docs/schema.md` explains the data model and why it is shaped this way.
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
