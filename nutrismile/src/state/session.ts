/**
 * Session state: who is using the app and what their targets are.
 *
 * Deliberately small. Anything that belongs to a particular day is loaded by
 * the screen that shows it, so a stale store can never make the dashboard
 * disagree with the database.
 */
import { create } from 'zustand';
import { goals, users } from '../db/repositories/index.ts';
import type { DailyGoal } from '../db/repositories/goals.ts';
import type { Profile } from '../db/repositories/users.ts';
import { today } from '../utils/dates.ts';

interface SessionState {
  profile: Profile | null;
  goal: DailyGoal | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;

  /** Load the local profile and today's target. Safe to call repeatedly. */
  load: () => Promise<void>;
  /** Re-read after onboarding or a goal change. */
  refresh: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  profile: null,
  goal: null,
  status: 'idle',
  error: null,

  load: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const profile = await users.current();
      const goal = profile ? await goals.forDate(profile.id, today()) : null;
      set({ profile, goal, status: 'ready' });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not open your data.',
      });
    }
  },

  refresh: async () => {
    const profile = await users.current();
    const goal = profile ? await goals.forDate(profile.id, today()) : null;
    set({ profile, goal });
  },
}));

/** Convenience for screens that cannot render without a profile. */
export function useProfileId(): string | null {
  return useSession((s) => s.profile?.id ?? null);
}
