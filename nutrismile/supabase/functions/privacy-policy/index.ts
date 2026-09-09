/**
 * privacy-policy — the public privacy policy page.
 *
 * Google Play requires a privacy policy at a URL that works without installing
 * the app, and the Data Safety form has to agree with it. Serving it from the
 * same project as the deletion page means one thing to deploy and one origin to
 * remember, rather than a separate host to keep alive for the life of the app.
 *
 * Deployed WITHOUT JWT verification — a policy nobody can read without an
 * account is not a published policy:
 *
 *   supabase functions deploy privacy-policy --no-verify-jwt
 *
 * The text here is the canonical copy. It is not duplicated into docs/, because
 * two copies of a privacy policy is one copy that is quietly wrong. Every claim
 * below is checked against the code; docs/play-store.md records where.
 */

/** Bump when the text changes. Shown on the page, as Play expects. */
const LAST_UPDATED = '9 September 2026';

/**
 * Where people can reach a human. Play requires a contact route, and this is
 * the one thing here that cannot be derived from the code — publishing an
 * address is the developer's decision, not a detail of the app. Set it before
 * submitting:
 *
 *   supabase secrets set PRIVACY_CONTACT_EMAIL=you@example.com
 */
const CONTACT_EMAIL = Deno.env.get('PRIVACY_CONTACT_EMAIL') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * Self-contained: no external stylesheet, script or font, so reading the
 * privacy policy does not itself hand a third party a record of the visit.
 */
function page(): string {
  const contact = CONTACT_EMAIL
    ? `<p>Questions, or a request about your data: <a href="mailto:${escapeHtml(
        CONTACT_EMAIL,
      )}">${escapeHtml(CONTACT_EMAIL)}</a>.</p>`
    : `<p class="todo">
         No contact address has been configured for this deployment yet. Set
         <code>PRIVACY_CONTACT_EMAIL</code> in the project's function secrets
         before publishing — Google Play requires a way to reach a human.
       </p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NutriSmile privacy policy</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem; background: #12131A; color: #F2F3F7;
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 38rem; }
  h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 .35rem; }
  h2 { font-size: 1.15rem; margin: 2.25rem 0 .75rem; }
  p, li { color: #A5A9B8; margin: 0 0 1rem; }
  li { margin-bottom: .5rem; }
  ul { padding-left: 1.25rem; margin: 0 0 1rem; }
  strong { color: #F2F3F7; font-weight: 600; }
  a { color: #7BE0AD; }
  code { color: #F2F3F7; font-family: ui-monospace, Menlo, monospace; font-size: .95em; }
  .updated { color: #6E7385; font-size: .9rem; margin-bottom: 2rem; }
  .lede {
    padding: 1.15rem 1.25rem; border-radius: 14px; background: #1B1D26;
    margin: 0 0 1rem;
  }
  .lede p:last-child { margin-bottom: 0; }
  .todo { padding: 1rem 1.25rem; border-radius: 12px; background: #3A2428; color: #F2A2A2; }
</style>
</head>
<body>
<main>
  <h1>NutriSmile privacy policy</h1>
  <p class="updated">Last updated ${LAST_UPDATED}</p>

  <div class="lede">
    <p>
      <strong>The short version.</strong> NutriSmile keeps what you log on your
      own device. There are no ads, no analytics, no trackers, and nothing is
      sold or shared for advertising. You can use the whole app without giving
      us a name, an email address or any other way to identify you. Your log is
      also backed up to our server under an anonymous account, so a lost phone
      does not lose your history. You can delete all of it, from the app or from
      a web page, at any time.
    </p>
  </div>

  <h2>What the app stores on your device</h2>
  <p>
    Everything you enter is written to a database inside the app on your phone:
  </p>
  <ul>
    <li>Your profile: date of birth, sex, height, activity level, weight goal,
      unit preferences and time zone. These are the inputs to the calorie
      calculation — the app cannot set a target without them.</li>
    <li>What you log: meals and their nutrition values, custom foods, recipes,
      water, and weight entries.</li>
    <li>Your daily calorie and macronutrient targets.</li>
  </ul>
  <p>
    The app works entirely offline: all of this is written and read on the
    device, and logging, editing and looking back over your history need no
    connection. Uninstalling the app deletes the copy on the phone.
  </p>

  <h2>What is sent to our server, and when</h2>
  <p>
    Backup runs automatically, so that a lost or replaced phone does not take
    your history with it. On first launch the app creates an
    <strong>anonymous account</strong> — a random identifier, with no email
    address, password or name attached — and copies the data listed above to our
    database under that identifier. That identifier is the only thing tying the
    data to you, and it is not linked to your name, your email, your phone or
    your Google account.
  </p>
  <p>
    An email address is stored only if you choose to attach one, which exists so
    an account can be recovered. There is no other route by which we learn who
    you are.
  </p>
  <p>
    Our database and the functions the app calls are hosted by
    <a href="https://supabase.com/privacy">Supabase</a>, which processes this
    data on our behalf.
  </p>

  <h2>Barcodes</h2>
  <p>
    Scanning a barcode looks it up in
    <a href="https://world.openfoodfacts.org/">Open Food Facts</a>, an open food
    database. That request goes from your phone directly to them, so they
    receive the barcode and, as with any web request, your IP address. It
    carries no account identifier and nothing about you or what you logged.
  </p>
  <p>
    If Open Food Facts has no match, the app asks our server, which queries the
    U.S. Department of Agriculture's FoodData Central. That request comes from
    our server rather than your phone, so USDA does not see your device or your
    IP address — only a barcode.
  </p>

  <h2>Photos of meals</h2>
  <p>
    The camera is used in two places, and only when you open them: scanning a
    barcode, and photographing a meal for an estimate. Nothing is recorded in
    the background.
  </p>
  <p>
    A meal photo is sent to our server, which forwards it to the AI provider
    configured for this build — <a href="https://www.anthropic.com/legal/privacy">
    Anthropic</a> or <a href="https://policies.google.com/privacy">Google</a> —
    which returns a list of likely foods and portion sizes. The photo is held in
    memory for that one request. <strong>We do not store your photos</strong>:
    not on our server, and not in the app's own storage or your photo library.
    What the provider does with data sent to it is covered by their policy,
    linked above.
  </p>
  <p>
    The result is an estimate, and the app treats it as one. Nothing from a
    photo is logged until you have looked at the numbers and chosen to save
    them.
  </p>
  <p>
    We count how many photo estimates each account makes per day, so that one
    account cannot exhaust the service for everyone. That is a number and a
    date, kept against the anonymous account identifier.
  </p>

  <h2>What we do not do</h2>
  <ul>
    <li>No advertising, and no advertising or attribution SDKs.</li>
    <li>No analytics, telemetry or crash-reporting service. We do not collect
      usage data.</li>
    <li>No selling or sharing of personal data with anyone, for any purpose,
      beyond the providers named above who process it to make the app work.</li>
    <li>No location, contacts, calendar, microphone, or health-app data. The app
      does not ask for these permissions.</li>
  </ul>

  <h2>Deleting your data</h2>
  <p>
    In the app: <code>Profile → Delete your data</code>. This deletes the
    account and everything stored against it on our server, and wipes the
    database on the device. It cannot be undone.
  </p>
  <p>
    Without the app installed, use
    <a href="delete-account-web">the deletion page</a>. Because an anonymous
    account carries nothing that identifies you, that page works from a deletion
    code the app issues under
    <code>Profile → Delete your data → Get a deletion code</code>. Save it
    somewhere if you may want to delete your data after uninstalling — without
    it we have no way to tell which account was yours.
  </p>
  <p>
    Backed-up data is kept until you delete it. There is no separate retention
    clock, because there is nothing kept that you did not put there.
  </p>

  <h2>Children</h2>
  <p>
    NutriSmile is not directed at children under 13, and we do not knowingly
    collect data from them.
  </p>

  <h2>Changes</h2>
  <p>
    If this policy changes, the date at the top changes with it, and the current
    version is always the one at this address.
  </p>

  <h2>Contact</h2>
  ${contact}
</main>
</body>
</html>`;
}

Deno.serve((request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  return new Response(request.method === 'HEAD' ? null : page(), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A policy is public and rarely changes, but must not go stale for an
      // hour after a correction.
      'Cache-Control': 'public, max-age=300',
      ...CORS_HEADERS,
    },
  });
});
