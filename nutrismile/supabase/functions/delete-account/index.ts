/**
 * delete-account — remove the caller's account and everything the server holds.
 *
 * Google Play requires any app that creates accounts to offer deletion, and
 * anonymous sign-in creates one. Beyond the requirement it is simply the right
 * default: someone who logs what they eat should be able to take it all back.
 *
 * A user cannot delete their own auth record, so this runs the deletion with
 * the service role — the one operation that needs it. It deletes only the
 * caller's own id, taken from their verified token and never from the body,
 * so this cannot be pointed at someone else's account.
 *
 * The data goes with it: users.id references auth.users on delete cascade, and
 * every other table cascades from users.
 *
 * Deploy:
 *   supabase functions deploy delete-account
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

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = await requireUser(request);
  if (!auth.ok) return json({ error: auth.failure.error }, auth.failure.status);

  const supabase = serviceClient();
  if (!supabase) return json({ error: 'delete_unconfigured' }, 503);

  // The id comes from the verified token, never from the request body.
  const { error } = await supabase.auth.admin.deleteUser(auth.caller.userId);
  if (error) return json({ error: 'delete_failed' }, 502);

  return json({ deleted: true });
});
