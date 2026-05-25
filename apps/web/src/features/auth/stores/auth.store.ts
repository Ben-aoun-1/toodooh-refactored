import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { authService } from '@/features/auth/services/auth.service';
import type { SessionUser } from '@/features/auth/types/auth';
import { apiClient } from '@/lib/api-client';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'auth.store' });

/**
 * Phase-1f keystone (design §2). The session model swapped off Supabase's client-managed JWT
 * (`onAuthStateChange` + `persistSession`) onto the better-auth httpOnly cookie + `GET /api/me`:
 * JS can't read the cookie, so identity is derived from a server fetch. The store's PUBLIC SURFACE
 * (these fields + the four actions) is unchanged so the ~30 consumer files don't change; only the
 * source of each field changed.
 *
 * `user` is now a minimal app-owned `{ id, email }` (D4) — preserves the truthiness checks and the
 * `.id`/`.email` reads in later-slice files. Routing fields come from the signin response (login) or
 * `/api/me` (reload), both server-reconstructed (`toProfileType(role, business_type)`), so there is
 * no client-side reconstruction. `validationStatus` is `users.status` (`pending|approved|rejected`,
 * D5); `needsApproval = status !== 'approved'`.
 */
interface StoreUser {
  id: string;
  email: string;
}

interface AuthState {
  user: StoreUser | null;
  loading: boolean;
  initialized: boolean;
  /** Set when `/api/me` fails with a non-401 (network/5xx) on rehydration — the D3 retry state. */
  rehydrateError: boolean;
  profileType: string | null;
  contactName: string | null;
  onboardingCompleted: boolean;
  shouldOnboard?: boolean;
  needsApproval?: boolean;
  validationStatus?: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshUserStatus: () => Promise<void>;
  /** Clear identity WITHOUT a server call — the mid-session 401 handler (D6) + the logout local clear. */
  clearSession: () => void;
}

// Derive the store's routing state from a session user (signin response or /api/me) — D5.
const mapRouting = (u: SessionUser) => ({
  user: { id: u.id, email: u.email },
  profileType: u.profile_type,
  contactName: u.contact_name,
  onboardingCompleted: u.onboarding_completed,
  shouldOnboard: !u.onboarding_completed,
  validationStatus: u.status,
  needsApproval: u.status !== 'approved',
});

// The logged-out routing reset (user falsy → guards redirect to /login).
const LOGGED_OUT = {
  user: null,
  profileType: null,
  contactName: null,
  onboardingCompleted: false,
  shouldOnboard: false,
  needsApproval: false,
  validationStatus: undefined,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      initialized: false,
      rehydrateError: false,
      profileType: null,
      contactName: null,
      onboardingCompleted: false,
      shouldOnboard: false,
      needsApproval: false,
      validationStatus: undefined,

      // Rehydrate identity on app load/reload from the cookie via GET /api/me (D3).
      initialize: async () => {
        set({ loading: true, rehydrateError: false });

        // Admin identity rides its own store (admin.store, Phase 1g); skip /api/me on admin routes.
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
          set({ ...LOGGED_OUT, initialized: true, loading: false });
          return;
        }

        try {
          const user = await authService.getCurrentUser();
          if (user) {
            set({ ...mapRouting(user), initialized: true, loading: false });
          } else {
            // 401 → the normal logged-out path (rehydration opt-out, D6).
            set({ ...LOGGED_OUT, initialized: true, loading: false });
          }
        } catch (error) {
          // Non-401 (network/5xx): the AUTH decision fails closed (user falsy for gating) while the
          // persisted routing cushion is RETAINED (graceful paint) and a retry-able error state is
          // set (D3) — never a silent logout, never a false-authed app. Backend require-auth is the
          // real gate; the store's identity is UI/routing only.
          log.error({ error }, 'rehydrate /api/me failed (non-401) — entering retry state');
          set({ user: null, rehydrateError: true, initialized: true, loading: false });
        }
      },

      login: async (email: string, password: string) => {
        set({ loading: true });
        try {
          const user = await authService.login(email, password);
          set({ ...mapRouting(user), loading: false });
        } catch (error) {
          set({ ...LOGGED_OUT, loading: false });
          throw error;
        }
      },

      logout: async () => {
        set({ loading: true });
        try {
          await authService.logout();
        } catch (error) {
          // A server signout failure must not block the local logout — clear regardless.
          log.warn({ error }, 'signout request failed — clearing session locally');
        } finally {
          get().clearSession();
          set({ loading: false });
        }
      },

      refreshUserStatus: async () => {
        if (!get().user) return;
        set({ loading: true });
        try {
          const user = await authService.getCurrentUser();
          if (user) set({ ...mapRouting(user), loading: false });
          else set({ ...LOGGED_OUT, loading: false });
        } catch (error) {
          log.error({ error }, 'refreshUserStatus failed');
          set({ loading: false });
        }
      },

      clearSession: () => set({ ...LOGGED_OUT }),
    }),
    {
      name: 'toodooh-auth',
      // The cushion (D3): routing fields for graceful paint + the non-401 fallback. NOT `user` —
      // identity is always re-proven by /api/me; a persisted field never makes `user` truthy.
      partialize: (state) => ({
        profileType: state.profileType,
        validationStatus: state.validationStatus,
        contactName: state.contactName,
        onboardingCompleted: state.onboardingCompleted,
      }),
    },
  ),
);

// D6 — the client clears identity on any MID-SESSION 401 (rehydration passes skipAuthRedirect, so
// its 401 does not route here). One-way dependency: the store imports the client, never the reverse.
apiClient.onUnauthorized(() => {
  useAuthStore.getState().clearSession();
});
