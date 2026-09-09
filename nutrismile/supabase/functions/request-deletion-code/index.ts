/**
 * request-deletion-code — mint a code the user can delete their account with
 * later, from a browser, without the app.
 *
 * Anonymous accounts have no email and no password, so there is nothing a web
 * page could ask for to establish ownership. This is the identifier: issued
 * while the user is provably signed in, and kept by them.
 *
 * Only the hash is stored. A leak of the table must not let anyone delete
 * anybody's account.
 *
 * Deploy:
 *   supabase functions deploy request-deletion-code
 */
import { requireUser, serviceClient } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** 160 bits, grouped for reading aloud or copying by hand. */
function generateCode(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return (raw.toUpperCase().match(/.{1,5}/g) ?? []).join('-');
}

export async function hashCode(code: string): Promise<string> {
  const normalised = code.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalised),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = await requireUser(request);
  if (!auth.ok) return json({ error: auth.failure.error }, auth.failure.status);

  const supabase = serviceClient();
  if (!supabase) return json({ error: 'unconfigured' }, 503);

  const code = generateCode();

  // One row per user: a new code replaces the old, so a code the user believes
  // they replaced really is dead.
  const { error } = await supabase.from('deletion_codes').upsert(
    {
      user_id: auth.caller.userId,
      code_hash: await hashCode(code),
      created_at: Date.now(),
    },
    { onConflict: 'user_id' },
  );

  if (error) return json({ error: 'could_not_issue' }, 502);

  // The only time the plain code exists anywhere. It is not stored, and it
  // cannot be shown again — a new one has to be minted.
  return json({ code });
});
