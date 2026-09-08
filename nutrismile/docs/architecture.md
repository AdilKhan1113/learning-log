# NutriSmile — folder structure

```
nutrismile/
├── app/                          # expo-router: routes only, no business logic
│   ├── _layout.tsx               #   root: theme, DB migration gate, auth gate
│   ├── (tabs)/
│   │   ├── _layout.tsx           #   bottom tabs; Scan is the raised centre button
│   │   ├── index.tsx             #   Today  — ring, macro bars, meals, water
│   │   ├── log.tsx               #   Log    — search, recents, favorites, recipes
│   │   ├── scan.tsx              #   Scan   — barcode / photo chooser
│   │   ├── progress.tsx          #   Progress — weight trend, weekly/monthly, streak
│   │   └── profile.tsx           #   Profile — goals, units, account
│   ├── onboarding/               #   first-run flow, outside the tab bar
│   └── modals/                   #   serving editor, entry editor, quick add
│
├── src/
│   ├── db/
│   │   ├── schema/001_init.sql   #   source of truth for the local database
│   │   ├── migrations.ts         #   ordered list; runs before the first query
│   │   ├── client.ts             #   openDatabaseAsync, PRAGMAs, tx helper
│   │   ├── types.ts              #   row types mirroring the SQL, 1:1
│   │   └── repositories/         #   the only place SQL strings live
│   │       ├── foods.ts  recipes.ts  logEntries.ts
│   │       ├── goals.ts  weight.ts   water.ts
│   │
│   ├── domain/                   # pure functions. No I/O, no React, no SQLite.
│   │   ├── nutrition/            #   bmr, tdee, macro split, deficit floor,
│   │   │                         #   serving conversion, entry + day totals
│   │   ├── search/               #   normalisation, fuzzy scoring, ranking
│   │   └── types.ts              #   domain shapes (distinct from db row types)
│   │
│   ├── features/                 # screen-level composition: hooks + components
│   │   ├── onboarding/ logging/ dashboard/
│   │   └── scanner/ photo/ progress/ profile/
│   │
│   ├── ui/                       # design system, reused by every feature
│   │   ├── theme/                #   colors, spacing, type scale, dark default
│   │   └── components/           #   Button, Card, Ring, MacroBar, Sheet, …
│   │
│   ├── state/                    # zustand stores: session, today, preferences
│   ├── services/                 # everything that talks to the network
│   │   ├── openfoodfacts/        #   barcode lookup (public, no key)
│   │   ├── vision/               #   photo estimation — calls our Edge Function
│   │   ├── supabase/             #   client, auth
│   │   └── sync/                 #   outbox drain, pull, conflict resolution
│   └── utils/                    # dates, ids, formatting, result types
│
├── tests/
│   ├── domain/                   # vitest, pure functions — `npm test`
│   └── db/schema.smoke.mjs       # node:sqlite against the real .sql
│
├── supabase/
│   ├── migrations/               # cloud mirror of the local schema + RLS
│   └── functions/                # Edge Functions; API keys live here only
│
└── docs/
```

## Rules the structure enforces

**`src/domain` never imports anything.** Not React, not expo-sqlite, not a
service. Every calculation the app depends on — BMR, TDEE, the macro split, unit
conversion, a day's totals, search ranking — lives here as a pure function, which
is what makes the unit tests in `tests/domain` meaningful and fast.

**SQL only exists in `src/db/repositories`.** Features call repositories;
repositories return domain shapes. Nothing else opens the database.

**`app/` holds routing, not logic.** A route file wires a feature component to a
URL and nothing more, so screens can be tested without a navigator.

**Keys never reach the client.** Open Food Facts needs no key and is called
directly from the device. USDA / Nutritionix / the vision model all require one,
so they are reached through `supabase/functions`, and the device sends only its
Supabase session token. `app.json` carries public config only.

## Data flow for one logged food

```
 Log screen ─▶ domain/search.rank()        pure, testable
            ─▶ repositories/foods.search() FTS candidates
 Serving    ─▶ domain/nutrition.scale()    pure: portion → grams → nutrition
 Confirm    ─▶ repositories/logEntries.create()
                 └─ writes the nutrition SNAPSHOT + a sync_queue row,
                    in one transaction
 Today      ◀─ repositories/logEntries.byDay()  reads the snapshot back
```

The snapshot is the point. A day's totals are a sum over `log_entries` alone —
`foods` is never joined into the arithmetic — so correcting a food's calories
tomorrow cannot silently rewrite what last Tuesday showed.
