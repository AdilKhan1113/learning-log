/**
 * Sync status, as the app sees it.
 *
 * Deliberately quiet: sync is a background convenience, not something the user
 * should have to think about. Nothing here blocks a screen, and a failure is a
 * line of status text rather than an error dialog — the app is fully usable
 * with sync switched off entirely.
 */
import { create } from 'zustand';
import { deleteAccount, ensureSignedIn, isConfigured } from '../services/supabase/client.ts';
import { pendingCount, sync } from '../services/sync/engine.ts';
import { users } from '../db/repositories/index.ts';
import { resetDatabase } from '../db/client.ts';

export type SyncStatus =
  | 'disabled'
  | 'signed_out'
  | 'idle'
  | 'syncing'
  | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pending: number;
  message: string | null;
  /** Sign in if needed, adopt the server's id, then sync. */
  start: (localUserId: string) => Promise<void>;
  syncNow: (userId: string) => Promise<void>;
  refreshPending: () => Promise<void>;
  /**
   * Delete the cloud account and wipe this device.
   *
   * Server first: if the local data went first and the server call then
   * failed, the user would be left with nothing on the device and an account
   * they could no longer reach to delete.
   */
  deleteEverything: () => Promise<{ ok: boolean; message: string }>;
}

export const useSync = create<SyncState>((set, get) => ({
  status: isConfigured() ? 'signed_out' : 'disabled',
  lastSyncedAt: null,
  pending: 0,
  message: null,

  start: async (localUserId) => {
    if (!isConfigured()) {
      set({ status: 'disabled' });
      return;
    }

    const auth = await ensureSignedIn();
    if (auth.status !== 'signed_in') {
      set({
        status: auth.status === 'unconfigured' ? 'disabled' : 'error',
        message: auth.status === 'failed' ? auth.message : null,
      });
      return;
    }

    // The profile was created offline under a local id. Move it and everything
    // it owns onto the id the server issued, or the push would be rejected.
    await users.adoptAuthId(localUserId, auth.userId);
    await get().syncNow(auth.userId);
  },

  syncNow: async (userId) => {
    if (get().status === 'syncing') return;
    set({ status: 'syncing', message: null });

    const outcome = await sync(userId);
    set({
      status: outcome.problem ? 'error' : 'idle',
      message: outcome.problem,
      lastSyncedAt: outcome.problem ? get().lastSyncedAt : Date.now(),
      pending: await pendingCount(),
    });
  },

  refreshPending: async () => {
    set({ pending: await pendingCount() });
  },

  deleteEverything: async () => {
    const remote = await deleteAccount();
    if (!remote.ok) return remote;

    await resetDatabase();
    set({ status: isConfigured() ? 'signed_out' : 'disabled', lastSyncedAt: null, pending: 0, message: null });
    return { ok: true, message: 'Everything has been deleted.' };
  },
}));
