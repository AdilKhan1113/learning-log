# Publishing to Google Play

What the store needs, what is already in the repo, and what only you can do.

Everything in the Data Safety section below is derived from the code, with the
file that decides it named. If you change one of those files, re-read the row.

> A caveat worth reading first: the Play Console's forms are reworded regularly,
> and this environment cannot reach Google's documentation to check today's
> wording. Treat the answers below as "what is true about this app", and match
> them to whatever the console actually asks. Where a question here has no
> counterpart in the console, the console is right.

## 1. Privacy policy

Required, at a URL that works without installing the app.

The policy is served by an Edge Function so there is no separate host to keep
alive for the life of the app:

```bash
supabase secrets set PRIVACY_CONTACT_EMAIL=you@example.com
supabase functions deploy privacy-policy --no-verify-jwt
```

The URL is `https://<project-ref>.supabase.co/functions/v1/privacy-policy`, and
it goes in **Play Console → App content → Privacy policy**.

Two things about it:

- **The contact address is not set.** Play requires a way to reach a human, and
  the page says so in red until `PRIVACY_CONTACT_EMAIL` is set. Which address to
  publish is your call, not a detail of the app — hence the secret rather than a
  value baked into the repo.
- **The text lives in `supabase/functions/privacy-policy/index.ts`**, not in a
  markdown copy here. Two copies of a privacy policy is one copy that is
  quietly wrong.

## 2. Data deletion

Required for any app that creates accounts, and anonymous sign-in creates one.

```bash
supabase db push
supabase functions deploy request-deletion-code
supabase functions deploy delete-account-web --no-verify-jwt
```

`https://<project-ref>.supabase.co/functions/v1/delete-account-web` goes in
**App content → Data deletion**. `docs/sync.md` explains why it works from a
code rather than a login.

## 3. Data Safety

### What is collected

"Collected" in Play's sense means *transmitted off the device*. That makes one
fact decisive for this whole section:

> **Backup is automatic, not opt-in.** `src/state/session.ts:48` starts it as
> soon as a profile exists and Supabase credentials are configured, and there is
> no switch to turn it off. So the answer to "can users choose whether this is
> collected?" is **no** for everything except photos and the content you choose
> to create.

| Category | Data type | Collected | Shared | Ephemeral | User choice | Purpose |
|---|---|---|---|---|---|---|
| Personal info | Name | **No** | – | – | – | – |
| Personal info | Email address | **No** | – | – | – | – |
| Personal info | User IDs | **Yes** | No | No | Required | App functionality |
| Personal info | Other info | **Yes** | No | No | Required | App functionality |
| Health and fitness | Health info | **Yes** | No | No | Required | App functionality |
| Photos and videos | Photos | **Yes** | No | **Yes** | Optional | App functionality |
| App activity | Other user-generated content | **Yes** | No | No | Optional | App functionality |
| App activity | App interactions | **No** | – | – | – | – |
| App info and performance | Crash logs, diagnostics | **No** | – | – | – | – |
| Device or other IDs | Device or other IDs | **No** | – | – | – | – |
| Location, Financial info, Contacts, Calendar, Messages, Audio, Files, Web browsing | | **No** | – | – | – | – |

Row by row, with what decides it:

- **Name — no.** `users.display_name` exists in the schema, but no screen writes
  it. If a screen ever does, this row changes.
- **Email address — no.** `linkEmail()` exists in
  `src/services/supabase/client.ts`, but nothing in `app/` calls it, so today
  the app cannot collect an email. **Shipping an email-linking screen flips this
  row to Yes / optional / Account management.** It is the single likeliest way
  for this declaration to silently go stale.
- **User IDs — yes.** Anonymous sign-in issues an account identifier
  (`ensureSignedIn`), and every synced row is keyed to it. It is not linked to a
  name, email, phone or Google account, but it is still a user ID.
- **Other info — yes.** Date of birth, sex and height, from onboarding. Play has
  no dedicated type for these; "Other info" is where date of birth belongs.
  They are the inputs to Mifflin-St Jeor — the app cannot produce a target
  without them.
- **Health info — yes.** Weight entries, logged food and nutrition, and calorie
  and macro targets (`weight_entries`, `log_entries`, `daily_goals`). Declare
  under Health info rather than Fitness info: the app tracks intake and body
  weight, not exercise.
- **Photos — yes, ephemeral, optional.** Only sent if you use Scan. The image is
  posted to `estimate-meal`, forwarded to the model provider, and never written
  to disk, to the database, or to your photo library — check for yourself:
  nothing in `supabase/functions/estimate-meal/index.ts` stores it, and
  `src/features/photo/useMealEstimate.ts` holds it in memory only. That is what
  Play means by processed ephemerally. Declaring it collected anyway is the
  conservative reading, and it costs nothing.
- **Other user-generated content — yes, optional.** Custom foods, recipes, and
  entry notes. Optional because you have to create one.
- **App interactions, crash logs, diagnostics — no.** There is no analytics,
  telemetry or crash-reporting SDK in `package.json`. This is worth stating
  plainly because it is unusual, and it is the reason most of this table is
  "no".

### On "shared"

Every row says **not shared**, which relies on Play's exemption for transfers to
a *service provider* processing data on the developer's behalf. Two transfers
lean on it:

- **Supabase** hosts the database and the functions.
- **Anthropic or Google** receives meal photos through `estimate-meal`, and only
  to answer that one request.

Both are processors acting on your instruction rather than parties given the
data for their own use, which is what the exemption is for. It is still your
declaration to make: if you would rather over-declare, marking Photos as shared
is defensible and costs you nothing but a line in the store listing.

Note that **Open Food Facts is not a transfer of user data at all.** Scanning
sends a barcode straight from the device (`src/services/openfoodfacts/client.ts`
calls `world.openfoodfacts.org` directly), carrying no account identifier and
nothing about the person. The USDA fallback goes through our own server
(`food-lookup`), so USDA sees the server, not the device.

### Security practices

| Question | Answer | Why |
|---|---|---|
| Is all user data encrypted in transit? | **Yes** | Every call is HTTPS: Supabase and Open Food Facts. No cleartext endpoint exists in the app. |
| Can users request that data be deleted? | **Yes** | In-app, and the web route in section 2. |
| Has the app had an independent security review? | **No** | It has not. Do not tick this. |
| Do you follow the Families policy? | **No** | The app is not directed at children. |

### Target audience

Not directed at children. Set the target age to 18+ (or 13+), and answer the
content rating questionnaire straightforwardly — there is no violence, no
sexual content, no gambling, no user-to-user communication, and no purchases.

One thing to watch: nutrition apps sit near Play's **health apps** rules. This
app makes no medical claims, requests no health permissions, and does not use
Health Connect, so the health-app declaration should not apply — but confirm it
against the console rather than this file, since that is a Google-side rule
that changes without touching this repo.

## 4. Store listing assets

| Asset | Status |
|---|---|
| App icon, 512×512 | Derive from `assets/icon.png` (1024×1024, no transparency) |
| Feature graphic, 1024×500 | **`assets/store/feature-graphic.png`** — done |
| Phone screenshots, 2–8 | **You have to take these.** |
| Short description, ≤80 chars | Draft below |
| Full description, ≤4000 chars | Draft below |

Screenshots have to come off a real device, which is the one thing here that
cannot be generated. Take them on the Today dashboard, the log flow, a barcode
scan, the photo estimate review screen, and Progress.

The feature graphic is generated from `assets/store/feature-graphic.html` so
the wording can be changed without a design tool:

```bash
chromium --headless --screenshot=assets/store/feature-graphic.png \
         --window-size=1024,500 --hide-scrollbars \
         file://$PWD/assets/store/feature-graphic.html
```

**Short description**

> Log a meal in seconds. Calories and macros, counted calmly.

**Full description** — a starting point, in the app's own register. No shaming,
no urgency, no claims the app cannot support:

> NutriSmile is a food diary that gets out of your way. Log a meal in a few
> seconds, see how the day is going against your targets, and get on with it.
>
> • Search a food, scan a barcode, or photograph a meal for an estimate you
>   check before it is logged.
> • Calorie and macro targets calculated from your own measurements, using the
>   Mifflin-St Jeor equation.
> • Recents, favourites, custom foods, recipes, and copying a whole day.
> • Weight trend, weekly and monthly charts, and a water counter.
> • Works offline. Logging and history never need a connection.
> • No ads, no trackers, no analytics.
>
> Numbers are reported plainly. Going over a target changes a number, not a
> colour, and nothing in the app tells you how to feel about it.
>
> NutriSmile is not a medical device and does not give medical advice.

## 5. Icons and splash

Generated, committed, and covered by a test (`tests/ui/icons.test.ts`) that
fails if the generator and the committed PNGs disagree, or if the generator's
colours drift from `src/ui/theme/colors.ts`:

```bash
npm run build:icons     # regenerate
node scripts/make-icons.mjs --check
```

The mark is the dashboard's progress ring. Android's adaptive icon needs its own
size, because only the centre 72/108 of the asset is ever shown — a mark sized
to look right in the file looks oversized in the launcher. The generator derives
the foreground ratio from that fraction rather than having it typed in, and the
test pins the derivation against the 66/108 safe-zone circle.

## 6. Building and submitting

`eas.json` has three profiles. Production builds an app bundle, which is what
Play takes.

```bash
npm install -g eas-cli
eas login
eas init                 # writes extra.eas.projectId into app.json
```

The build runs on EAS servers, which do not have your `.env` — it is gitignored,
and correctly so. The two public values have to be set as EAS environment
variables or the built app will silently have no backend:

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL      --value https://<ref>.supabase.co --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key>               --environment production --visibility plaintext
```

Repeat with `--environment preview` for preview builds. Plaintext visibility is
right here: both values are public by design and ship in the bundle anyway. The
service-role key is not among them and must never be set as an
`EXPO_PUBLIC_*` variable.

```bash
eas build --profile preview    --platform android   # APK, sideload and check
eas build --profile production --platform android   # AAB for Play
eas submit --profile production --platform android
```

`appVersionSource: "remote"` means EAS owns the version code and increments it
per production build, so there is no number to bump by hand and no way to
collide with a code Play has already seen. `version` in `app.json` is still the
user-visible version name, and it currently reads **0.1.0** — a first public
release is conventionally `1.0.0`, so change it if you want that.

## 7. What is not done

- **Screenshots.** Device-only.
- **A Play Console account** (US$25, one-off) and a signing key. EAS generates
  and holds the upload key on the first build if you let it.
- **None of the deletion or sync flows have run against a live Supabase
  project** from this repo — this environment cannot reach one. Before
  submitting, mint a deletion code in the app, open the web page, delete, and
  confirm the auth user disappears from the dashboard.
- **An account-deletion grace period.** Deletion here is immediate and total.
  That is defensible and Play allows it, but it means a mis-tap is unrecoverable.
- **Backup has no off switch.** Not a Play requirement, and the data is
  anonymous, but "you cannot turn off the network copy" is a product decision
  worth making deliberately rather than by default. It is also what forces the
  "Required" answers in section 3.
