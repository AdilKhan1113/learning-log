/**
 * Supabase client and anonymous sign-in.
 *
 * Signing in is anonymous by design: a nutrition app should not put a sign-up
 * form in front of someone who wants to log their breakfast. The device gets an
 * identity, its data syncs under that identity, and an email can be attached
 * later to make it recoverable.
 *
 * Both values here are public by design — the anon key is meant to ship in the
 * bundle, and row-level security is what actually protects the data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { withTimeout } from './timeoutFetch.ts';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

export function isConfigured(): boolean {
  return SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';
}

/** The client, or null when no project is configured. */
export function getSupabase(): SupabaseClient | null {
  if (!isConfigured()) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      // The session has to outlive the process or every launch would create a
      // new anonymous user and orphan the last one's data.
      persistSession: true,
      autoRefreshToken: true,
      // No deep-link callback to parse: nothing here signs in through a URL.
      detectSessionInUrl: false,
    },
    // Without this, a server that stops answering mid-request leaves the app
    // waiting indefinitely and the backup status stuck on "Backing up…".
    global: { fetch: withTimeout() },
  });
  return client;
}

export type AuthResult =
  | { status: 'signed_in'; userId: string }
  | { status: 'unconfigured' }
  | { status: 'failed'; message: string };

/**
 * The current session, creating an anonymous one if there is none.
 *
 * Safe to call on every launch: an existing session is reused, so a user keeps
 * the same identity — and therefore the same data — across restarts.
 */
export async function ensureSignedIn(): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { status: 'unconfigured' };

  try {
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session?.user) {
      return { status: 'signed_in', userId: existing.session.user.id };
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      return {
        status: 'failed',
        message: error?.message ?? 'Could not start a session.',
      };
    }
    return { status: 'signed_in', userId: data.user.id };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Could not reach the server.',
    };
  }
}

/**
 * Attach an email to the anonymous account, so the data survives losing the
 * phone. The account keeps its id, so nothing has to be migrated.
 */
export async function linkEmail(email: string): Promise<{ ok: boolean; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'No project configured.' };

  const { error } = await supabase.auth.updateUser({ email });
  return error
    ? { ok: false, message: error.message }
    : { ok: true, message: 'Check your email to confirm the address.' };
}

/**
 * The signed-in user's access token, for calling our Edge Functions.
 *
 * The anon key must not be used for this. It ships inside the app bundle and
 * can be extracted from it, so a function receiving it learns nothing about
 * who is calling — and the functions that cost money need to know.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Delete the account and everything the server holds for it.
 *
 * The server-side cascade does the work: removing the auth user removes the
 * profile row, and every table cascades from there. Local data is wiped
 * separately by the caller — one is no use without the other.
 */
export async function deleteAccount(): Promise<{ ok: boolean; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: true, message: 'No cloud account to delete.' };

  const token = await getAccessToken();
  if (!token) return { ok: true, message: 'No cloud account to delete.' };

  try {
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) return { ok: false, message: error.message };

    await supabase.auth.signOut();
    return { ok: true, message: 'Account deleted.' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not reach the server.',
    };
  }
}

/**
 * Mint a code that deletes this account from a browser later.
 *
 * The account is anonymous, so nothing about it identifies the person holding
 * it. This code is that identifier — issued while they are provably signed in,
 * and shown once. Only its hash is kept, so it cannot be recovered afterwards;
 * a new one has to be minted, which replaces the old.
 */
export async function requestDeletionCode(): Promise<
  { ok: true; code: string } | { ok: false; message: string }
> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: 'No cloud account to delete.' };

  const token = await getAccessToken();
  if (!token) return { ok: false, message: 'This device is still setting up its account.' };

  try {
    const { data, error } = await supabase.functions.invoke<{ code?: string }>(
      'request-deletion-code',
      { method: 'POST' },
    );
    if (error || typeof data?.code !== 'string') {
      return { ok: false, message: error?.message ?? 'Could not issue a code.' };
    }
    return { ok: true, code: data.code };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not reach the server.',
    };
  }
}
