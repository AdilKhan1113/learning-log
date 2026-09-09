# Cloud sync (Phase 5)

The app is local-first and stays fully usable with sync switched off. Sync is a
backup and a way to move between devices — never something the user has to
manage, and never something that blocks a screen.

## Anonymous by default

A nutrition app should not put a sign-up form in front of someone who wants to
log their breakfast. On first launch the device signs in anonymously: it gets an
identity, its data syncs under that identity, and an email can be attached later
(`linkEmail`) to make the account recoverable. The account keeps its id when an
email is added, so nothing has to be migrated.

The cost is honest and worth stating in the UI eventually: until an email is
attached, losing the phone loses the account.

## The identity handover

The profile row is created offline, long before any sign-in, with a locally
generated UUID. Once a session exists those rows have to move to the id the
server issued, or the push would be rejected by row-level security.

`users.adoptAuthId` rewrites the profile and every table that references it in
one transaction, with foreign keys suspended — a primary key cannot be updated
while children still point at the old value, and the schema does not declare
`ON UPDATE CASCADE`. The outbox is rewritten too, since it refers to the profile
row by id.

This was anticipated in Phase 1: the `users.id` comment in `001_init.sql` says
the id is a local UUID "rewritten on first successful auth".

## What syncs, and what does not

Everything the user created: profile, goals, custom foods and their portions,
recipes and ingredients, log entries, weight, water.

**Cached catalogue foods do not.** They are reproducible from Open Food Facts,
so replicating them would spend the user's bandwidth copying a public database.
That decision was made in Phase 2 — cached rows are never marked dirty.

## Order, and why it matters

Push goes parents-first: `users`, `foods`, `food_portions`, `recipes`,
`recipe_ingredients`, then the rest. A `food_portion` whose food has not arrived
is a foreign key violation. Pull order does not matter, because deletes are soft
and nothing is ever removed.

Push runs before pull, so local work is safe on the server before anything can
overwrite it.

## The outbox is coalesced

A row edited five times is one push, not five. A delete anywhere in a row's
history wins, whatever the queue order — the soft-deleted row carries its own
final state, so the outcome must not depend on which entry landed last. Rows
belonging to tables that do not sync are dropped rather than failing later.

Ordering is by each row's *earliest* queue entry, so editing an old row again
does not drag it behind rows created after it.

## Conflicts

Last write wins on `updated_at`. For one person across a few devices that is the
honest rule: the most recent edit is the one they meant. A tie goes to the
remote copy, so two devices that disagree converge instead of each keeping its
own answer forever.

A delete is not special-cased — it carries an `updated_at` like any other edit,
so deleting on one device and editing on another resolves by whichever happened
later.

One exception protects unsent work: a local row that is **dirty and at least as
new** as the incoming one is left alone. It has an edit that has not been pushed
yet, and taking the remote version would discard it silently.

## Safety

Row-level security is owner-only on every table, written out per table in
`supabase/migrations/` rather than generated, so each policy can be read and
checked on its own. The `with check` clause means a row's owner is never taken
from the client: whatever `user_id` is sent, it is rejected unless it matches
the caller. Nothing is exposed to the `anon` role.

Two divergences from the local schema, both deliberate:

- **Timestamps stay `bigint` epoch milliseconds** rather than `timestamptz`. The
  device is the source of truth for when something was logged, and converting
  twice is how timezone bugs get in. Calendar days stay `text` for the same
  reason.
- **`food_portions` and `recipe_ingredients` carry a `user_id`** that the local
  schema does not need, because RLS has to decide ownership from the row itself.
  Deriving it through a join on every check is slower and easier to get wrong.

On pull, column names come from the device's own schema via `PRAGMA table_info`,
never from the payload, so a remote row cannot introduce a column.

## Who may call the Edge Functions

The anon key ships inside the installable bundle and can be extracted from it,
so "holds a valid anon key" is evidence of nothing. Supabase checks that a
request carries *a* valid JWT, and the anon key is one — which means the default
posture leaves a paid endpoint open to anyone who unpacks the app.

Both functions therefore require a signed-in user's token specifically, verified
against the auth server rather than decoded locally, and the app sends its
session token rather than the anon key. `estimate-meal` additionally counts
calls per user per day (`VISION_DAILY_LIMIT`, default 30) in a table only the
service role can touch — with no RLS policies at all, so a user cannot read,
reset, or inflate their own counter. The increment is a single database
statement, so two requests arriving together cannot both read the same count and
each conclude they are under the limit.

The count is taken *before* the model call, so a failed estimate still spends an
allowance. Otherwise forcing failures would be an unlimited retry loop.

## Deleting an account

Google Play requires any app that creates accounts to offer deletion, and
anonymous sign-in creates one. `delete-account` removes the auth user with the
service role — a user cannot delete their own auth record — taking the id from
the verified token and never from the request body, so it cannot be pointed at
somebody else's account. Everything else follows by cascade: `users.id`
references `auth.users`, and every table cascades from `users`.

Locally, the database file is deleted rather than emptied table by table. A
DELETE per table can miss one as the schema grows, and "we deleted your data"
has to be true without qualification.

The server goes first. If the local wipe ran first and the server call then
failed, the user would be left with nothing on the device and an account they
could no longer reach to delete.

## Deleting an account from the web

Google also requires a deletion route that works without installing the app, so
in-app deletion alone is not enough.

The hard part is proof of ownership. An anonymous account has no email, no
password and no username — a stranger arriving at a web page has nothing to
identify themselves with, and nothing the server could send a confirmation link
to. So the app issues a code, and the code *is* the identifier: whoever holds it
is treated as the account's owner, the same bargain as a recovery key.

`request-deletion-code` is authenticated, so only the signed-in owner can mint
one. It generates 160 bits from `crypto.getRandomValues` and formats them in
groups for transcription. Only the SHA-256 of the code is stored, so a database
leak yields hashes rather than working deletion tokens, and the plaintext is
returned exactly once — the app shows it with a warning to save it, and cannot
show it again.

One row per user, keyed on `user_id`, so minting a second code replaces the
first: a code the user thinks they replaced is genuinely dead. The table has RLS
enabled with no policies at all, so only the service role can read it.

`delete-account-web` is the public page and must be deployed with
`--no-verify-jwt` — a person who has uninstalled the app has no token to send.
It serves self-contained HTML (no external CSS, JS or fonts, so the page cannot
leak the visit to a third party), marked `noindex`. A POST hashes the submitted
code, looks up the row, and calls `auth.admin.deleteUser`; the cascade does the
rest. An unknown code and an already-used code produce identical wording, so the
page cannot be used to test whether a code was ever valid.

## Deploying it

```bash
supabase db push                              # tables, policies, usage counter
supabase functions deploy delete-account      # alongside the other two
supabase functions deploy request-deletion-code
supabase functions deploy delete-account-web --no-verify-jwt
```

The `--no-verify-jwt` on the last one is required, not optional: without it
Supabase rejects the anonymous visitor before the function runs, and the page is
unreachable for exactly the people it exists for.

Anonymous sign-ins must also be enabled: **Dashboard → Authentication →
Providers → Anonymous**. Without that, `signInAnonymously` fails and the app
reports "not backed up yet" while continuing to work locally.

## Not verified against a real project

The schema, the policies and the engine have never run against a live Supabase
instance — this environment cannot reach one. The planning logic is unit-tested
(coalescing, ordering, conflict resolution, row projection), but the SQL, the
policies and the round trip are not.

First run should check, in order:

1. `supabase db push` applies without error.
2. Profile shows "Backed up…" rather than a problem.
3. The `users` row in the dashboard has the same id as the auth user.
4. Logging a food makes a row appear in `log_entries` in the dashboard.
5. A second device signing in anonymously gets its **own** empty account —
   anonymous sessions are per-device by design, so this is expected, not a bug.
   Moving between devices needs the email link.
