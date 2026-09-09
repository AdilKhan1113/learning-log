/**
 * Identifying the caller of an Edge Function.
 *
 * Supabase verifies that a request carries *a* valid JWT, but the anon key is
 * one — and it ships inside the app bundle, where anyone can extract it. So
 * these functions require a signed-in user's token specifically, and check it
 * against the auth server rather than trusting its contents.
 *
 * Without this, an extracted anon key is a free pass to spend the project
 * owner's model budget.
 */
import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';

export interface Caller {
  userId: string;
}

export type AuthFailure = { status: number; error: string };

/**
 * The signed-in user behind a request, or a failure to return verbatim.
 *
 * The token is verified by asking the auth server who it belongs to. Decoding
 * it here would mean trusting a signature this function never checked.
 */
export async function requireUser(
  request: Request,
): Promise<{ ok: true; caller: Caller } | { ok: false; failure: AuthFailure }> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) return { ok: false, failure: { status: 401, error: 'not_signed_in' } };

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    return { ok: false, failure: { status: 503, error: 'auth_unconfigured' } };
  }

  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.getUser(token);

  // The anon key is itself a valid JWT but belongs to no user, so it lands here.
  if (error || !data.user) {
    return { ok: false, failure: { status: 401, error: 'not_signed_in' } };
  }

  return { ok: true, caller: { userId: data.user.id } };
}

/** A client with the service role, for the few writes a user must not make. */
export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Count this call and say whether the user is over their daily allowance.
 *
 * The increment happens in one statement in the database, so two requests
 * arriving together cannot both read the same count and each conclude they are
 * under the limit.
 */
export async function withinDailyLimit(
  userId: string,
  limit: number,
): Promise<{ allowed: boolean; used: number } | null> {
  const supabase = serviceClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('record_vision_use', { p_user_id: userId });
  if (error || typeof data !== 'number') return null;

  return { allowed: data <= limit, used: data };
}
