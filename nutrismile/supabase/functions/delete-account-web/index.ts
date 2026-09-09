/**
 * delete-account-web — deleting an account from a browser, without the app.
 *
 * Google Play requires a deletion route that works without installing the app.
 * This is it: a page anyone can open, which accepts the code the app issues
 * and deletes the matching account.
 *
 * Deployed WITHOUT JWT verification, because the whole point is that the
 * caller has no session:
 *
 *   supabase functions deploy delete-account-web --no-verify-jwt
 *
 * Its only power is deleting the account whose code the caller already holds,
 * and the code is 160 bits of randomness stored hashed. Someone without a code
 * can do nothing here.
 */
import { serviceClient } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** Hashing must match request-deletion-code exactly, formatting and all. */
async function hashCode(code: string): Promise<string> {
  const normalised = code.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalised),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * The page. Self-contained: no external stylesheet, script or font, so it
 * works with no network beyond this request and nothing third-party can see
 * who visited.
 */
function page(state: { message?: string; tone?: 'error' | 'done'; code?: string }): string {
  const { message, tone, code } = state;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Delete your NutriSmile data</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 2rem 1.25rem; background: #12131A; color: #F2F3F7;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 32rem; }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .75rem; }
  p { color: #A5A9B8; margin: 0 0 1rem; }
  form { margin: 1.5rem 0 0; }
  label { display: block; font-weight: 600; color: #F2F3F7; margin-bottom: .5rem; }
  input {
    width: 100%; box-sizing: border-box; padding: .85rem 1rem; font-size: 1rem;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .04em;
    background: #1B1D26; color: #F2F3F7;
    border: 1px solid #2E3240; border-radius: 12px;
  }
  input:focus { outline: 2px solid #7BE0AD; outline-offset: 2px; border-color: #7BE0AD; }
  button {
    margin-top: 1rem; width: 100%; min-height: 48px; padding: .85rem 1.5rem;
    font-size: 1rem; font-weight: 600; cursor: pointer;
    background: #7BE0AD; color: #0C1B15; border: 0; border-radius: 999px;
  }
  button:hover { opacity: .9; }
  .note {
    margin-top: 1.5rem; padding: 1rem; border-radius: 12px;
    background: #1B1D26; color: #A5A9B8; font-size: .95rem;
  }
  .error { background: #3A2428; color: #F2A2A2; }
  .done { background: #2A4A3E; color: #7BE0AD; }
  code { color: #F2F3F7; font-family: ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
<main>
  <h1>Delete your NutriSmile data</h1>
  <p>
    This removes your account and everything logged against it — foods, meals,
    weight and targets — from our servers. It cannot be undone.
  </p>

  ${message ? `<div class="note ${tone ?? ''}">${escapeHtml(message)}</div>` : ''}

  ${
    tone === 'done'
      ? ''
      : `<form method="POST">
    <label for="code">Deletion code</label>
    <input id="code" name="code" required autocomplete="off" spellcheck="false"
           placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
           value="${code ? escapeHtml(code) : ''}">
    <button type="submit">Delete my data</button>
  </form>

  <div class="note">
    <p style="margin:0 0 .5rem"><strong style="color:#F2F3F7">Where to find your code</strong></p>
    <p style="margin:0">
      Open NutriSmile and go to <code>Profile → Delete your data → Get a deletion
      code</code>. If you no longer have the app installed and never saved a
      code, there is no way for us to tell which account is yours — an account
      created without an email carries nothing that identifies you. Reinstalling
      will not recover it either; it starts a new one.
    </p>
  </div>`
  }
</main>
</body>
</html>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (request.method === 'GET') return html(page({}));
  if (request.method !== 'POST') return html(page({}), 405);

  const form = await request.formData().catch(() => null);
  const submitted = String(form?.get('code') ?? '').trim();

  if (!submitted) {
    return html(page({ message: 'Enter the code from the app.', tone: 'error' }), 400);
  }

  const supabase = serviceClient();
  if (!supabase) {
    return html(
      page({ message: 'Deletion is unavailable right now. Please try again later.', tone: 'error' }),
      503,
    );
  }

  const { data, error } = await supabase
    .from('deletion_codes')
    .select('user_id')
    .eq('code_hash', await hashCode(submitted))
    .maybeSingle();

  if (error) {
    return html(
      page({ message: 'Something went wrong. Nothing was deleted.', tone: 'error', code: submitted }),
      502,
    );
  }

  if (!data) {
    // The same wording whether the code never existed or was already used.
    // There is nothing to enumerate — a code is 160 bits — but there is no
    // reason to confirm which of the two it was either.
    return html(
      page({
        message: "That code wasn't recognised. It may have already been used, or replaced by a newer one.",
        tone: 'error',
      }),
      404,
    );
  }

  // Deleting the auth user cascades through every table that references it.
  // The code row goes with it, which is what makes a code single-use.
  const { error: deleteError } = await supabase.auth.admin.deleteUser(data.user_id);
  if (deleteError) {
    return html(
      page({ message: 'The account could not be deleted. Nothing was removed.', tone: 'error' }),
      502,
    );
  }

  return html(
    page({
      message:
        'Your account and all of its data have been deleted. Anything still stored on a phone is removed when you uninstall the app.',
      tone: 'done',
    }),
  );
});
