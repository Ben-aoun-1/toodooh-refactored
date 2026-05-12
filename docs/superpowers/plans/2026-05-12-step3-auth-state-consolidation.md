# Step 3 — Auth-State Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/web/src/stores/auth.store.ts` a Zustand `persist` middleware as the single source of truth for cached profile state, stop `auth.service.ts` from touching `localStorage`, capture the `onAuthStateChange` subscription, delete the `clearAuthCache.ts` debug cruft, and rescope the audit doc / issue #2 to match.

**Architecture:** The auth store already owns session orchestration (`initialize`/`login`/`logout`/`refreshUserStatus`/the `onAuthStateChange` listener/`fetchProfileType`); the actual problem is that "the cache" is hand-rolled `localStorage.getItem/setItem` scattered across the store + the service. Replace that with `persist` (`partialize` to `profileType`, `validationStatus`, `contactName`, `onboardingCompleted`), make the service stateless, and defer the `localStorage` call sites in `Dashboard.tsx`/`Onboarding.tsx` to Step 5 (they're Dashboard-coupled). No migration code — returning users do one extra `business_profiles` fetch on first post-deploy load (`fetchProfileType` already handles a cold cache).

**Tech Stack:** React 18 + Vite, Zustand (`zustand` + `zustand/middleware`), `@supabase/supabase-js`, pnpm workspace, vitest, ESLint 9 flat config + pre-commit hook (Prettier + `eslint --fix`).

**Why no TDD here:** the auth code has zero existing tests, and standing up a test harness for the store (mock Supabase + localStorage + Zustand) is the testing-pass's scope (a later roadmap step), not Step 3. Step 3's safety net is: every commit re-runs `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @toodooh/web build` and must not regress the baseline, plus a manual smoke checklist on the auth-touching commits, plus a `git diff` review per commit. If execution wants to add one focused test (e.g. `persist` rehydration), it's welcome but not required.

**Baseline to hold (HEAD `f15bb2f`+ — re-confirm at execution start):**
- `pnpm typecheck`: ≤ 179 errors (currently 179 after Step 2b — actually re-measure; was 180 pre-2b, 179 post-2b)
- `pnpm lint`: ≤ 1636 problems (1609 errors / 27 warnings) after Step 2b — re-measure at start
- `pnpm test`: 3 suites pass (22 tests), 1 pre-existing import-time failure (`campaign-hourly-location-plan.service.test.ts`)
- `pnpm --filter @toodooh/web build`: passes, ~110 chunks, main ~434 kB
- A commit may *improve* any of these (e.g. deleting `clearAuthCache.ts` removes a few lint errors); it must not *worsen* them. Capture before→after in each commit body.

**Commit shape:** 7 commits (this refines the user's rough 6 — Commit 1 is split into 1a "additive: add `persist` + new state fields, behavior unchanged" and 1b "remove the hand-rolled `localStorage` from the store", because 1a is low-risk and 1b is where the only behavior-affecting change lives). Each commit goes through the pre-commit hook *except* it's expected to pass cleanly on 1a/1b/2/3/4/6; the `clearAuthCache.ts` deletion (5) is a `git rm` so lint-staged finds nothing to lint and the hook is a no-op. No `--no-verify` should be needed; if a touched file is not Prettier-clean and the hook reformats more than your change, stop and report.

**Manual smoke checklist** (run after Tasks 2, 3, 5 — the auth-touching ones; needs Supabase creds in `apps/web/.env` for steps 2–5, otherwise do steps 1 + 6 only and rely on the regression gates + diff review):
1. `pnpm --filter @toodooh/web dev`; open `http://localhost:5173/login` — renders, no *new* console errors.
2. Log in as an advertiser → lands on `/dashboard`; log out; log in as an owner → lands on `/owner-dashboard`.
3. While logged in, hard-reload the page → stays logged in, lands on the correct dashboard, no "pending"/onboarding flash for an approved user (the `persist`-rehydrated cache should make `fetchProfileType` use the cache, not re-query).
4. Log out → lands on `/login`; in DevTools → Application → Local Storage, confirm there is no longer a blob with `profileType`/`validationStatus` populated (the new `toodooh-auth` key, if present, should have nulls/false).
5. Trigger a known auth-error path (e.g. wrong password) → the French error message still shows (confirms `mapAuthError` still wired).
6. Confirm the dev server console no longer prints `💡 Utilitaire chargé: window.clearAuthCache()` on load, and `window.clearAuthCache` is `undefined` in the console (Task 6).

---

## Task 1a — `auth.store.ts`: add `persist` middleware + new state fields (additive, behavior unchanged)

**Files:**
- Modify: `apps/web/src/stores/auth.store.ts`

This commit is purely additive: the store gains a `persist` wrapper and two new persisted state fields (`contactName`, `onboardingCompleted`), but every existing `localStorage` read/write stays exactly as-is. The store now both persists *and* hand-rolls — temporarily redundant, intentionally so, so this commit can't change behavior.

- [ ] **Step 1: Re-confirm the baseline.** Run `pnpm typecheck` (note error count), `pnpm lint` (note problems/errors/warnings), `pnpm test` (note pass/fail), `rm -rf apps/web/dist && pnpm --filter @toodooh/web build` (note chunk count + main size). Write these down — they're the numbers each later commit compares against.

- [ ] **Step 2: Add the `persist` import.** In `apps/web/src/stores/auth.store.ts`, change the imports at the top from:

```ts
import { User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import { authService } from '../services/auth.service';
```

to:

```ts
import { User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { supabase } from '../lib/supabase';
import { authService } from '../services/auth.service';
```

(Import order: `zustand` then `zustand/middleware` — sub-paths sort after the bare name, which matches `import-x/order`. Leave the blank line before the `../` imports.)

- [ ] **Step 3: Add the two new fields to the `AuthState` interface.** Change the interface to add `contactName` and `onboardingCompleted` (place them next to the other cached fields):

```ts
interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
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
}
```

- [ ] **Step 4: Wrap the store in `persist`.** The store is `create<AuthState>((set) => { …big factory… return { … }; })`. Wrap it:

```ts
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => {
      // …entire existing factory body, UNCHANGED…
      return {
        user: null,
        loading: false,
        initialized: false,
        profileType: null,
        contactName: null,
        onboardingCompleted: false,
        shouldOnboard: false,
        // …rest of the returned object (initialize/login/logout/refreshUserStatus), UNCHANGED…
      };
    },
    {
      name: 'toodooh-auth',
      partialize: (state) => ({
        profileType: state.profileType,
        validationStatus: state.validationStatus,
        contactName: state.contactName,
        onboardingCompleted: state.onboardingCompleted,
      }),
    },
  ),
);
```

Notes for whoever does this:
- `create<AuthState>()(persist(...))` — the double-call `create<T>()( ... )` form is required by Zustand's TS types when using middleware. Don't write `create<AuthState>(persist(...))`.
- The factory currently takes `(set)`. Leave it as `(set)` — none of the existing code uses `get`. (Task 1b will add `get` if needed.)
- Add `contactName: null` and `onboardingCompleted: false` to the **returned initial-state object** (the `return { … }` near the bottom). `shouldOnboard: false` is already there.
- Do **not** touch any `localStorage.*` call in the factory in this commit. Do **not** add `partialize` for `shouldOnboard` (it's derived from `onboardingCompleted`; persisting both would risk drift) or `user` (that's Supabase's session, not ours) or `initialized`/`loading` (must be fresh each load).
- `name: 'toodooh-auth'` is a **new** localStorage key. The old loose keys (`user_profile_type`, etc.) are untouched and remain populated by the existing code — that's fine for this commit.

- [ ] **Step 5: Typecheck + verify no regression.** Run `pnpm typecheck` — error count must be ≤ baseline (it should be *equal*; adding two `null`-typed/`boolean` fields with initializers shouldn't add errors). Run `pnpm lint` — problems must be ≤ baseline. Run `pnpm test` — same pass/fail as baseline. Run `rm -rf apps/web/dist && pnpm --filter @toodooh/web build` — completes, chunk count + main size equivalent. If any of these regress, **stop and report** — do not continue.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/stores/auth.store.ts
git commit -m "$(cat <<'EOF'
refactor(auth): add persist middleware and contactName/onboardingCompleted state to auth.store

Additive only — the store is now wrapped in zustand's persist middleware
(name: 'toodooh-auth', partialize: profileType/validationStatus/contactName/
onboardingCompleted) and has the two new state fields, but every existing
localStorage read/write is left untouched. Behavior is unchanged; the
hand-rolled localStorage gets removed in the next commit. Part of Step 3 (#2).

Verification (baseline → after): typecheck <N> → <N>; lint <P> problems → <P>;
test 3 pass + 1 pre-existing fail unchanged; build <C> chunks / ~<S> kB unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

(Fill the `<N>/<P>/<C>/<S>` from Steps 1 and 5. The pre-commit hook should run Prettier on `auth.store.ts` and pass; if it reformats lines you didn't change, that's fine — `auth.store.ts` may not have been Prettier-clean and the hook is allowed to fix it here since you're already editing the file.)

---

## Task 1b — `auth.store.ts`: remove the hand-rolled `localStorage`, switch to store state

**Files:**
- Modify: `apps/web/src/stores/auth.store.ts`

This is the behavior-affecting commit. The persisted store state from Task 1a now *is* the cache; this commit makes the store read/write that state instead of raw `localStorage`, makes `fetchProfileType` *return* `contactName` (it currently only side-effect-writes it), switches admin-detection to read the admin store directly, and removes the `localStorage.removeItem` cleanup from `logout`/`refreshUserStatus` (which `persist` makes unnecessary).

- [ ] **Step 1: Add `useAdminStore` import and give the factory `get`.** At the top of `auth.store.ts`, add:

```ts
import { useAdminStore } from './admin.store';
```

(Place it among the `./` sibling imports, sorted: `./admin.store` then `./auth.store`-relative siblings — actually it's the only `./` sibling import other than what's there; alongside `../lib/supabase` / `../services/auth.service`. `import-x/order`: `./admin.store` sorts before `../lib/...`? No — `./` (sibling) sorts *after* `../` (parent) in the default `import-x/order` group order `[builtin, external, internal, parent, sibling, index]`. So it goes *after* `../services/auth.service`. Put it last in the import block. Run `pnpm lint apps/web/src/stores/auth.store.ts` if unsure and let `--fix` place it — but check the diff stays minimal.)

Change the factory signature from `(set) => {` to `(set, get) => {`.

- [ ] **Step 2: `getPreservedStateOnError` — read from the store, not localStorage.** Replace (lines ~26–34 region):

```ts
  const getPreservedStateOnError = (cachedProfileType?: string | null) => {
    const storeState = useAuthStore.getState();
    const cachedValidationStatus = localStorage.getItem('user_validation_status');
    const cachedProfileTypeLs = localStorage.getItem('user_profile_type');

    const knownValidationStatus =
      storeState.validationStatus || cachedValidationStatus || undefined;
    const knownProfileType =
      storeState.profileType || cachedProfileType || cachedProfileTypeLs || null;
```

with:

```ts
  const getPreservedStateOnError = (cachedProfileType?: string | null) => {
    const storeState = useAuthStore.getState();

    const knownValidationStatus = storeState.validationStatus || undefined;
    const knownProfileType = storeState.profileType || cachedProfileType || null;
```

(The persisted `validationStatus`/`profileType` *are* the cache now, so the localStorage reads are redundant. Keep the `cachedProfileType` parameter — `fetchProfileType` still passes a locally-computed value.) The rest of `getPreservedStateOnError` (the `wasApproved` check, the two `return` branches) is unchanged.

- [ ] **Step 3: `fetchProfileType` — admin-detection via the admin store.** Replace the admin-storage block (lines ~64–81):

```ts
      // Vérifier si c'est un admin (vérifier dans admin-storage)
      const adminStorage = localStorage.getItem('admin-storage');
      if (adminStorage) {
        try {
          const adminData = JSON.parse(adminStorage);
          if (adminData?.state?.admin?.id) {
            console.log('✅ Admin détecté, skip fetchProfileType');
            return {
              profileType: null,
              onboardingCompleted: true,
              needsApproval: false,
              validationStatus: 'approved',
            };
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
```

with:

```ts
      // Vérifier si c'est un admin (lire directement le store admin)
      if (useAdminStore.getState().admin?.id) {
        console.log('✅ Admin détecté, skip fetchProfileType');
        return {
          profileType: null,
          contactName: null,
          onboardingCompleted: true,
          needsApproval: false,
          validationStatus: 'approved',
        };
      }
```

(Note: `useAdminStore` rehydrates from its own `admin-storage` persist synchronously, so `getState().admin` is populated by the time this runs — same information the JSON-parse was getting, minus the string-parsing. Also note the added `contactName: null` in the returned object — see Step 5, every return path of `fetchProfileType` now includes `contactName`.)

- [ ] **Step 4: `fetchProfileType` — cache gates read store state, not localStorage.** Replace (lines ~83–113):

```ts
      // Vérifier le cache localStorage d'abord
      const onboardingCompleted = localStorage.getItem('onboardingCompleted') === 'true';
      const cachedProfileType = localStorage.getItem('user_profile_type');
      const cachedValidationStatus = localStorage.getItem('user_validation_status');
      const isCachedApproved = …
      …
      if (!forceRefresh && cachedProfileType && isCachedApproved) {
        …
        return { profileType: cachedProfileType, onboardingCompleted: true, needsApproval: false, validationStatus: cachedValidationStatus };
      }
      if (!forceRefresh && onboardingCompleted && cachedProfileType && cachedValidationStatus) {
        …
        return { profileType: cachedProfileType, onboardingCompleted: true, needsApproval: …, validationStatus: cachedValidationStatus };
      }
```

with the store-state versions:

```ts
      // Vérifier le cache (état persisté du store)
      const { profileType: cachedProfileType, validationStatus: cachedValidationStatus, contactName: cachedContactName, onboardingCompleted: cachedOnboardingCompleted } = get();
      const isCachedApproved =
        cachedValidationStatus === 'approved' || cachedValidationStatus === 'verified';

      // Porte du cache assouplie: si l'utilisateur est approuvé/verified,
      // on peut utiliser le cache même si l'onboarding n'est pas marqué terminé.
      if (!forceRefresh && cachedProfileType && isCachedApproved) {
        console.log('✅ Utilisation du cache (compte approuvé/verified)');
        return {
          profileType: cachedProfileType,
          contactName: cachedContactName,
          onboardingCompleted: true,
          needsApproval: false,
          validationStatus: cachedValidationStatus,
        };
      }

      // Porte historique: onboarding terminé + cache complet → utilisation du cache
      if (!forceRefresh && cachedOnboardingCompleted && cachedProfileType && cachedValidationStatus) {
        console.log('✅ Utilisation du cache pour éviter la requête');
        return {
          profileType: cachedProfileType,
          contactName: cachedContactName,
          onboardingCompleted: true,
          needsApproval:
            cachedValidationStatus !== 'approved' && cachedValidationStatus !== 'verified',
          validationStatus: cachedValidationStatus,
        };
      }
```

Keep using `cachedProfileType` further down (the `getPreservedStateOnError(cachedProfileType)` calls, the `cachedProfileType || null` fallbacks) — it's now sourced from `get()` instead of localStorage, but the variable name is the same so those call sites don't change.

- [ ] **Step 5: `fetchProfileType` — every return path includes `contactName`; remove the `localStorage.setItem` block.** The DB-success path currently (lines ~220–249):

```ts
        const profileType = data?.profile_type || null;
        const contactName = data?.contact_name || null;
        const validationStatus = data?.verification_status || 'approved';

        if (profileType) {
          localStorage.setItem('user_profile_type', profileType);
          localStorage.setItem('user_raison_social', contactName || '');
          localStorage.setItem('user_validation_status', validationStatus);
          console.log('📝 …');
          console.log('📝 …');
          console.log('📝 …');
        }
        const dbOnboardingCompleted = data?.onboarding_completed ?? onboardingCompleted;
        if (dbOnboardingCompleted) {
          localStorage.setItem('onboardingCompleted', 'true');
        }
        return { profileType, onboardingCompleted: dbOnboardingCompleted, needsApproval: false, validationStatus: validationStatus };
```

becomes:

```ts
        const profileType = data?.profile_type || null;
        const contactName = data?.contact_name || null;
        const validationStatus = data?.verification_status || 'approved';
        const dbOnboardingCompleted = data?.onboarding_completed ?? cachedOnboardingCompleted;

        return {
          profileType,
          contactName,
          onboardingCompleted: dbOnboardingCompleted,
          needsApproval: false,
          validationStatus,
        };
```

(`onboardingCompleted` the local boolean was renamed to `cachedOnboardingCompleted` in Step 4; the `?? cachedOnboardingCompleted` fallback uses it.)

**Every other `return { … }` inside `fetchProfileType` must also gain a `contactName` field** so the result shape is consistent — set it to `cachedContactName` for the cache/preserve paths and `null` (or `cachedContactName`) for the "no profile / disabled / pending" paths. Concretely, add `contactName: cachedContactName,` to: the `!data` return (~175), the `is_active === false` return (~186), the `isPending` return (~212) — for `isPending` you may prefer `contactName: data.contact_name || cachedContactName || null` since you *have* the data. And in `getPreservedStateOnError`, add `contactName: knownProfileType ? (useAuthStore.getState().contactName ?? null) : null` to both returned objects — or simpler, just `contactName: useAuthStore.getState().contactName ?? null` in both. Pick one and be consistent. The point: `fetchProfileType` and `getPreservedStateOnError` now return `{ profileType, contactName, onboardingCompleted, needsApproval, validationStatus }` on every path.

- [ ] **Step 6: The three callers (`initialize`, `login`, the auth listener) put `contactName` into their `set(...)`.** Wherever a caller destructures `fetchProfileType`'s result and then `set(...)`s, add `contactName`:
  - In **`initialize`** (~427): destructure `contactName: cn` from the result, and add `contactName: cn ?? null,` and `onboardingCompleted: !shouldOnboard,` to the `set({ user, initialized: true, … })` call. Also, in the error/catch branches that `set({ user: null, …profileType: null… })`, add `contactName: null, onboardingCompleted: false,`.
  - In **`login`** (~498): delete the now-pointless `localStorage.getItem('user_profile_type')` / `localStorage.getItem('onboardingCompleted')` reads at ~487–488 and the `console.log('🔍 Store login - localStorage check', …)` that uses them. Destructure `contactName: cn` from `fetchProfileType`'s result; add `contactName: cn ?? null, onboardingCompleted: !shouldOnboard,` to the `set({ user, loading: false, profileType, shouldOnboard, … })`. The error branch's `set({ loading: false, profileType: null, … })` adds `contactName: null, onboardingCompleted: false,`.
  - In **the auth listener** (`initializeAuthListener`'s `onAuthStateChange` callback, ~338–386): the local vars `let profileType = null; …` — add `let contactName: string | null = null; let onboardingCompleted = false;`. In the `if (user) { … const result = await fetchProfileType(user.id); … }` block, assign `contactName = result.contactName ?? null; onboardingCompleted = result.onboardingCompleted ?? false;` (alongside `profileType = result.profileType; shouldOnboard = !result.onboardingCompleted; …`). In the catch branch that copies from `useAuthStore.getState()`, also copy `contactName = current.contactName; onboardingCompleted = current.onboardingCompleted;`. Add `contactName, onboardingCompleted,` to the final `set({ user, profileType, shouldOnboard, … })`. Also: in the "admin route → skip" early-`set` (~279) and the `TOKEN_REFRESHED/USER_UPDATED` and `userId unchanged` `set({ user })` paths, you don't need to add `contactName` (those `set`s only touch `user` or reset to logged-out defaults — for the admin-route reset, add `contactName: null, onboardingCompleted: false` for completeness).

- [ ] **Step 7: `logout` and `refreshUserStatus` — drop the `localStorage.removeItem` cleanup; reset the new fields.** In **`logout`** (~529): delete the five `localStorage.removeItem('onboardingCompleted' | 'justOnboarded' | 'user_profile_type' | 'user_raison_social' | 'user_validation_status')` lines. Change the `set({ user: null, loading: false, profileType: null, shouldOnboard: false, needsApproval: false, validationStatus: undefined })` to also include `contactName: null, onboardingCompleted: false,`. (`persist` will write those nulls/false to `toodooh-auth` — that's the correct logged-out persisted state. The old loose keys are now orphaned; that's acceptable per the no-migration decision. If you want to be tidy you *may* keep a single `localStorage.removeItem('user_profile_type'); localStorage.removeItem('user_raison_social'); localStorage.removeItem('user_validation_status'); localStorage.removeItem('onboardingCompleted'); localStorage.removeItem('justOnboarded');` block here as a one-time cleanup of pre-Step-3 keys — optional, ask the user; the plan's default is to delete them and let the orphans sit.)

  In **`refreshUserStatus`** (~553): delete the four `localStorage.removeItem(...)` lines. It already calls `fetchProfileType(user.id, true)` (force-refresh, which now skips the cache gates because `forceRefresh` is `true`). Add `contactName` + `onboardingCompleted` to its `set(...)`: destructure `contactName: cn` from the result and `set({ profileType, contactName: cn ?? null, shouldOnboard: !onboardingCompleted, onboardingCompleted, needsApproval, validationStatus, loading: false })`.

- [ ] **Step 8: Sanity-grep — no `localStorage` left in `auth.store.ts`.** Run: `grep -n "localStorage" apps/web/src/stores/auth.store.ts` → should return **nothing**. If it does, you missed a call site.

- [ ] **Step 9: Typecheck + lint + test + build — no regression.** Run all four. Typecheck should be ≤ baseline (likely *lower* — removing the `NodeJS.Timeout` no... actually unchanged; the removed `localStorage` lines had no type errors). Lint ≤ baseline. Test same pass/fail. Build completes, equivalent. If anything regresses, **stop and report**.

- [ ] **Step 10: Manual smoke** (checklist at the top — at least steps 1, 3, 6; do 2, 4, 5 if you have Supabase creds). The critical one is **step 3** (hard-reload while logged in stays logged in on the right page, no flash) — that's the `persist` rehydration working.

- [ ] **Step 11: Commit.**

```bash
git add apps/web/src/stores/auth.store.ts
git commit -m "$(cat <<'EOF'
refactor(auth): remove hand-rolled localStorage from auth.store; use persisted state

The persist middleware added in the previous commit is now the cache:
- getPreservedStateOnError / fetchProfileType read profileType /
  validationStatus / contactName / onboardingCompleted from the store
  (get() / useAuthStore.getState()) instead of localStorage.
- fetchProfileType now *returns* contactName on every path (it previously
  only side-effect-wrote it to localStorage); the four callers
  (initialize, login, refreshUserStatus, the onAuthStateChange listener)
  put it into their set() so persist writes it.
- admin detection reads useAdminStore.getState().admin instead of
  JSON.parse(localStorage.getItem('admin-storage')).
- logout / refreshUserStatus drop their localStorage.removeItem cleanup
  (persist handles the persisted state; the old loose keys — user_profile_type
  etc. — are intentionally left as inert orphans, no migration per decision).

No localStorage references remain in auth.store.ts. Part of Step 3 (#2).

Verification (baseline → after): typecheck <N> → <N>; lint <P> → <P>;
test unchanged; build unchanged. Manual smoke: reload-while-logged-in stays
logged in on the correct dashboard with no pending/onboarding flash.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — `auth.service.ts`: stop writing `localStorage`

**Files:**
- Modify: `apps/web/src/services/auth.service.ts`

After Task 1b, the store's `login` action calls `fetchProfileType` which does the `business_profiles` fetch and populates the persisted state. So `authService.login`'s post-signin `business_profiles` fetch + `localStorage` writes are dead weight — delete them. Also delete the two `localStorage.removeItem('pending_signup_data')` calls (vestigial — `pending_signup_data` is never written in the current code).

- [ ] **Step 1: Trim `authService.login()`.** It currently is `signInWithPassword` → if error throw → `if (data.user) { …~50 lines of business_profiles fetch + localStorage writes/removes + console.logs… }` → `return data`. Replace the whole method with:

```ts
  async login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(mapAuthError(error));
    return data;
  },
```

(The store's `login` action no longer reads `data.user`'s profile from this method — it calls `fetchProfileType` itself. `authService.login`'s callers: the store's `login` action destructures `{ user }` from the returned `data` — `data` is the Supabase `{ user, session }` shape, so `{ user } = await authService.login(...)` still works. Double-check `components/auth/LoginForm.tsx` — it calls the *store's* `login`, not the service's, so no change there.)

- [ ] **Step 2: Delete the two `pending_signup_data` `removeItem` calls.** In `signUp`, find `localStorage.removeItem('pending_signup_data');` (appears ~2×, one in a `catch` near the profile-creation error, one after "User and profile created successfully" with a `// legacy` comment) and delete both lines. (`pending_signup_data` is never `setItem`'d anywhere — these are no-ops; removing them removes the last `localStorage` reference in `auth.service.ts`.)

- [ ] **Step 3: Sanity-grep — no `localStorage` left in `auth.service.ts`.** Run: `grep -n "localStorage" apps/web/src/services/auth.service.ts` → should return **nothing**.

- [ ] **Step 4: Typecheck + lint + test + build — no regression.** Run all four. Lint should *drop* a little (the deleted `console.log`s + the deleted block remove some `no-console`/etc. errors). If anything regresses, **stop and report**.

- [ ] **Step 5: Manual smoke** — checklist steps 1, 2, 5 (login still works; wrong-password still shows the French message).

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/services/auth.service.ts
git commit -m "$(cat <<'EOF'
refactor(auth): make auth.service.ts stateless — no more localStorage

authService.login() no longer fetches business_profiles or writes
user_profile_type / user_raison_social to localStorage — the store's login
action already calls fetchProfileType, which owns that fetch and the
persisted cache. login() is now just signInWithPassword → return data.
Also dropped the two vestigial localStorage.removeItem('pending_signup_data')
no-ops in signUp (that key is never written). No localStorage references
remain in auth.service.ts. Part of Step 3 (#2).

Verification (baseline → after): typecheck <N> → <N>; lint <P> → <P>
(drops a few from the deleted console.logs); test unchanged; build unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `ContactPage.tsx`: read `contactName` from the store

**Files:**
- Modify: `apps/web/src/pages/ContactPage.tsx`

`ContactPage.tsx:54` pre-fills a form field from `localStorage.getItem('user_raison_social')`. `ContactPage` is a live route (not Dashboard-coupled) and already imports `useAuthStore`. Read `contactName` from the store instead. (`ContactPage` is the *only* live-route reader of that loose key; `Dashboard.tsx:676` also writes it but that's Dashboard-coupled → Step 5; after this commit the loose `user_raison_social` key is read by nobody.)

- [ ] **Step 1: Add a `contactName` selector near the top of the component.** `ContactPage` already has `const profileType = useAuthStore((state) => state.profileType);` (or similar — it logs `profileType`). Next to that, add:

```ts
const contactName = useAuthStore((state) => state.contactName);
```

- [ ] **Step 2: Use it in the form pre-fill.** Change line ~54 from:

```ts
        name: localStorage.getItem('user_raison_social') || user.email || '',
```

to:

```ts
        name: contactName || user.email || '',
```

(Make sure `contactName` is in scope where the `setFormData` runs — if it's inside a `useEffect`, add `contactName` to that effect's dependency array. If lint's `exhaustive-deps` flags it, add it; that's not a regression — it's the rule doing its job — but if it creates a *new* error vs baseline, note it and decide with the user whether to suppress with a one-line `// eslint-disable-next-line` *only if* the effect genuinely shouldn't re-run, otherwise just add the dep.)

- [ ] **Step 3: Sanity-grep.** `grep -n "localStorage\|user_raison_social" apps/web/src/pages/ContactPage.tsx` → nothing.

- [ ] **Step 4: Typecheck + lint + test + build — no regression.** Run all four.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/pages/ContactPage.tsx
git commit -m "$(cat <<'EOF'
refactor(auth): ContactPage reads contactName from auth.store, not localStorage

Replaces localStorage.getItem('user_raison_social') with
useAuthStore(s => s.contactName) for the contact-form name pre-fill.
ContactPage is a live route and already imports useAuthStore. After this,
the loose user_raison_social key is read by nobody (Dashboard.tsx still
writes it — that's Dashboard-coupled, deferred to Step 5). Part of Step 3 (#2).

Verification: typecheck/lint/test/build unchanged vs baseline.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `auth.store.ts`: capture the `onAuthStateChange` subscription + re-entry guard

**Files:**
- Modify: `apps/web/src/stores/auth.store.ts`

`initializeAuthListener` calls `supabase.auth.onAuthStateChange(...)` and discards the returned `{ data: { subscription } }`. There's already an `authListenerInitialized` boolean guard, but it's the only thing preventing a double-subscribe and it's a bare module-scoped flag. Capture the subscription so it's holdable (and could be unsubscribed), and keep both the boolean guard and the 500 ms debounce as belt-and-braces.

- [ ] **Step 1: Add a module-scoped subscription holder inside the factory.** Near the existing `let authListenerInitialized = false;` / `let lastProcessedEvent ...` declarations, add:

```ts
  let authSubscription: { unsubscribe: () => void } | null = null;
```

- [ ] **Step 2: Capture the subscription in `initializeAuthListener`.** Currently:

```ts
  const initializeAuthListener = () => {
    if (authListenerInitialized) return;
    …admin-route early return…
    supabase.auth.onAuthStateChange(async (event, session) => {
      …callback…
    });
    authListenerInitialized = true;
  };
```

Change to:

```ts
  const initializeAuthListener = () => {
    if (authListenerInitialized || authSubscription) return;
    …admin-route early return (unchanged)…
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      …callback unchanged…
    });
    authSubscription = subscription;
    authListenerInitialized = true;
  };
```

(The `|| authSubscription` in the guard is the belt; `authListenerInitialized` is the braces. Don't remove the 500 ms `DEBOUNCE_MS` dedup logic inside the callback — leave it exactly as-is.)

- [ ] **Step 3: (Optional, ask the user) expose an `unsubscribe` cleanup.** If the user wants it, add to the returned store object a `cleanup: () => { authSubscription?.unsubscribe(); authSubscription = null; authListenerInitialized = false; }` action (and add `cleanup: () => void;` to `AuthState`). Default for this plan: **don't** add it — nothing calls it (the app never tears down the auth store), and an unused action is its own small smell. Just capturing the subscription (Steps 1–2) is the defensive minimum the user asked for.

- [ ] **Step 4: Typecheck + lint + test + build — no regression.** Run all four. (TS: `supabase.auth.onAuthStateChange` returns `{ data: { subscription: Subscription } }` — destructuring it is type-safe; no `any` needed.)

- [ ] **Step 5: Manual smoke** — checklist steps 1, 3 (and 2 if creds available — log in, the listener should fire `SIGNED_IN` and the state should populate; no double-fire of the heavy `fetchProfileType` thanks to the dedup + guard).

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/stores/auth.store.ts
git commit -m "$(cat <<'EOF'
refactor(auth): capture the onAuthStateChange subscription; harden re-entry guard

initializeAuthListener now captures the { data: { subscription } } returned by
supabase.auth.onAuthStateChange into a module-scoped holder, and the guard is
`authListenerInitialized || authSubscription` — belt and braces against a
double-subscribe if initialize() is ever re-entered. The 500 ms event-dedup
inside the callback is left untouched (structural correctness we don't yet
have evidence to remove). Part of Step 3 (#2).

Verification: typecheck/lint/test/build unchanged vs baseline.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — delete `clearAuthCache.ts` and its `App.tsx` import

**Files:**
- Delete: `apps/web/src/utils/clearAuthCache.ts`
- Modify: `apps/web/src/App.tsx` (remove line 6)

`utils/clearAuthCache.ts` is pure debug cruft: it attaches `window.clearAuthCache` as a global, `console.log`s "💡 Utilitaire chargé" on every load, and (if invoked) clears auth localStorage + `sessionStorage.clear()` + `window.location.href = '/login'`. Its only consumer is the side-effect import `import './utils/clearAuthCache'; // Utilitaire de debug` at `App.tsx:6`. Its localStorage-clearing logic is already duplicated in `auth.store.logout`. Nothing to migrate — delete outright. (Also kills the codebase's only `sessionStorage` use and one of the `window.location.href` hard-navigations.)

- [ ] **Step 1: Confirm there are no other consumers.** Run `grep -rn "clearAuthCache" apps/web/src` → the only hits should be the file itself and `App.tsx:6`. If anything else references it (named import, `window.clearAuthCache(...)` call), **stop and report** — don't delete blindly.

- [ ] **Step 2: Delete the file.** `git rm apps/web/src/utils/clearAuthCache.ts`

- [ ] **Step 3: Remove the import from `App.tsx`.** Delete the line `import './utils/clearAuthCache'; // Utilitaire de debug` (line 6, between `import { useAuthStore } from './stores/auth.store';` and `import AdminRoute from './components/admin/AdminRoute';`).

- [ ] **Step 4: Sanity-grep.** `grep -rn "clearAuthCache" apps/web/src` → **nothing**.

- [ ] **Step 5: Typecheck + lint + test + build — no regression.** Run all four. Lint should *drop* (the deleted file had 3 `console.*` + a `no-explicit-any` (`(window as any)`) — those errors go away; `App.tsx` loses an import line).

- [ ] **Step 6: Manual smoke** — checklist step 6 (dev console no longer prints "💡 Utilitaire chargé"; `window.clearAuthCache` is `undefined`).

- [ ] **Step 7: Commit.** (Note: lint-staged runs `eslint --fix` on *staged modified* `.ts/.tsx` files — `App.tsx` is modified; the deleted file isn't lintable. The hook should pass; if it reformats `App.tsx` beyond your one-line removal, that's allowed since you're editing it. If you'd rather a perfectly minimal `App.tsx` diff and the hook reformats it, `git checkout` the reformat, manually remove just line 6, and `--no-verify` with a note — but the default is: let the hook do its thing.)

```bash
git add apps/web/src/App.tsx
git commit -m "$(cat <<'EOF'
refactor(auth): delete clearAuthCache.ts debug utility

utils/clearAuthCache.ts attached a window.clearAuthCache() global, logged
"💡 Utilitaire chargé" on every app load, and (if invoked) cleared auth
localStorage + sessionStorage.clear() + window.location.href = '/login'.
Its only consumer was the side-effect import at App.tsx:6; its
localStorage-clearing logic is already in auth.store.logout(). Deleted
outright (also removes the codebase's only sessionStorage use). Part of
Step 3 (#2). The audit doc's "Debug cruft" §3 note is updated in the next
commit.

Verification: typecheck unchanged; lint drops a few (deleted console.* +
the (window as any) cast); test unchanged; build unchanged. Manual: dev
console no longer prints the "Utilitaire chargé" line.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — docs: rescope Step 3 in `docs/audit.md`; update + close issue #2

**Files:**
- Modify: `docs/audit.md`

- [ ] **Step 1: Rewrite the §3 "Auth-state layering" subsection** to reflect what was actually done — parallel to how §3 "Duplicate pages" / "Duplicate / wrapper services" were rewritten in Steps 2a/2b. Structure (write it as prose, not a literal copy of this):
  - **Done in Step 3:** `auth.store.ts` now uses Zustand `persist` (`name: 'toodooh-auth'`, `partialize`: `profileType`/`validationStatus`/`contactName`/`onboardingCompleted`) — that persisted state *is* the profile cache; the hand-rolled `localStorage` in `auth.store.ts` is gone; `auth.service.ts` is stateless (no `localStorage`); `getCurrentUser` etc. unchanged; admin-detection reads `useAdminStore.getState().admin`; the `onAuthStateChange` subscription is captured; `utils/clearAuthCache.ts` deleted (+ its `App.tsx` import); `ContactPage.tsx` reads `contactName` from the store. No migration — returning users do one extra `business_profiles` fetch on first post-deploy load; the old loose `localStorage` keys (`user_profile_type`, `user_raison_social`, `user_validation_status`, `onboardingCompleted`, `justOnboarded`) are inert orphans until `Dashboard.tsx`/`Onboarding.tsx` stop writing them.
  - **Correction to the handoff framing:** "extract session logic from `auth.service.ts` into `auth.store.ts`" was inaccurate — the store already owned session orchestration; the real fix was the `persist` middleware + de-`localStorage`-ing the service. `auth.service.ts` is a Supabase-auth wrapper + `business_profiles`/signup CRUD + the 165-line `mapAuthError`; an eventual `auth.service.ts` / `business-profile.service.ts` split is a Step 6 concern.
  - **Deferred to Step 5:** the `localStorage` call sites in `Dashboard.tsx` (~16, the biggest cluster — `onboardingCompleted`, `user_profile_type`, `user_raison_social`, `justOnboarded`, `campaign_cart_items`) and `Onboarding.tsx` (3 — `onboardingCompleted`) get cleaned as part of decomposing those files; they read/write the same auth-cache keys, so once `Dashboard`/`Onboarding` are real components their reads become `useAuthStore(...)` and writes become store actions.
  - **One-sentence note on the parallel anti-pattern:** `stores/cart.store.ts` has the same shape as the old `auth.store.ts` — a Zustand store that exists, but the cart state is *also* hand-rolled in `localStorage` (`campaign_cart_items` in `CartPage.tsx`, `Dashboard.tsx`, `NewCampaign.tsx`); deferred to Step 5 because all three call sites are Dashboard-coupled. Do **not** expand this into a full new §3 subsection — one sentence.
  - **Pointer line:** `→ **Step 3 · #2** (done) · **Step 5 · #3** (`Dashboard`/`Onboarding` localStorage sites + the `cart.store.ts` parallel)`.
  - Also update the §3 "Debug cruft" subsection's pointer/text — `clearAuthCache.ts` is now deleted (move it to §4 "Already resolved" wording, or trim the subsection to just note the remaining emoji `console.log`s are Step 9's concern).
  - Also update the §2 Snapshot's `localStorage`-related count if it's mentioned anywhere (the §3 "localStorage outside Zustand persist" subsection's "66 across 8 files" → now ~the Dashboard/Onboarding/cart subset remains; point it at Step 5). And the "Auth-state layering" subsection's old text referencing the 66.

- [ ] **Step 2: §5 Roadmap row 3** — update the scope/done columns to match (scope: `auth.store.ts` (persist + de-localStorage), `auth.service.ts` (stateless), `App.tsx` (drop clearAuthCache import), `ContactPage.tsx`, delete `utils/clearAuthCache.ts`; done: persist in place / no localStorage in auth.store or auth.service / clearAuthCache deleted / Dashboard+Onboarding+cart localStorage deferred to Step 5 / typecheck-lint-test-build not regressed). Flip status `☐ → ☑`.

- [ ] **Step 3: `prettier --write docs/audit.md`**, then `git add docs/audit.md`, review the diff, and commit:

```bash
git commit -m "$(cat <<'EOF'
docs(audit): rescope Step 3 to reflect actual scope (auth-state consolidation)

Step 3 turned out to be "give auth.store.ts a persist middleware and stop
auth.service.ts touching localStorage; delete clearAuthCache.ts" — not "move
session logic from the service to the store" (the store already owned session
orchestration). §3 "Auth-state layering" rewritten parallel to the 2a/2b
rewrites: done-in-Step-3 / handoff-framing-correction / deferred-to-Step-5
(Dashboard + Onboarding localStorage sites) + a one-sentence note that
cart.store.ts has the same hand-rolled-localStorage anti-pattern (also Step 5,
Dashboard-coupled). §3 "Debug cruft" updated (clearAuthCache.ts deleted). §5
row 3 narrowed + marked ☑. No code changes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push all 7 commits.** `git push` (then `git log --oneline -8` to confirm).

- [ ] **Step 5: Update + close issue #2.** `gh issue edit 2 --body '<rescoped body>'` — scope = what was actually done (the 7 commits' worth); Done = persist in place, no localStorage in auth.store/auth.service, clearAuthCache deleted, ContactPage on the store, subscription captured, verifications pass, audit doc updated; add a line "(Handoff framing was overstated — the store already owned session orchestration; real fix was the persist middleware. Dashboard/Onboarding localStorage sites and the cart.store.ts parallel deferred to Step 5 · #3.)" with the commit hashes. Then `gh issue close 2 --reason completed -c '<close comment with hashes + verification numbers>'`. Confirm: `gh issue list --milestone "Frontend cleanup phase" --state all` → #1, #14, #2 closed; the rest open.

---

## Self-review (run before presenting / executing)

- **Spec coverage** — Decision (a) 4 persisted fields → Task 1a Step 4 (`partialize`). Decision (b) no migration → stated in header + Task 1b Step 7 (orphan keys left). Decision (c) admin via `useAdminStore.getState().admin` → Task 1b Step 3. Decision (d) include ContactPage, defer OwnerSettings/UserProfile re-auth → Task 3 (ContactPage); OwnerSettings/UserProfile re-auth not in this plan (note in Task 6 / issue body as a separate follow-up if you like). `onAuthStateChange` subscription capture → Task 4. cart.store.ts note in the doc → Task 6 Step 1. The user's 6-commit shape → realized as 7 (1a/1b split flagged in the header). ✓ all covered.
- **Placeholder scan** — the `<N>/<P>/<C>/<S>` in commit messages are intentional fill-from-measurement slots, not TBDs; everything else is concrete. The "(Optional, ask the user)" steps (1b Step 7 keep-cleanup, 4 Step 3 `cleanup` action) are real decision points with a stated default, not placeholders.
- **Type consistency** — `fetchProfileType`/`getPreservedStateOnError` return shape is `{ profileType, contactName, onboardingCompleted, needsApproval, validationStatus }` consistently after Task 1b; `AuthState` adds `contactName: string | null` and `onboardingCompleted: boolean`; `partialize` references exactly those 4 fields + `validationStatus` (which already exists as `validationStatus?: string`). `authSubscription: { unsubscribe: () => void } | null`. Consistent.

## Risk note (per the user's flag)

**Task 1b is the only behavior-affecting commit** and the riskiest. The 1a/1b split isolates it: 1a is provably additive (new fields + a `persist` wrapper, no logic touched). If, during execution, Task 1b feels too large in one go, the natural sub-split is: (1b-i) `fetchProfileType` + `getPreservedStateOnError` cache-reads → `get()`/`getState()` and `fetchProfileType` returns `contactName`; (1b-ii) the four callers wire `contactName`/`onboardingCompleted` into their `set()` and drop their `localStorage.removeItem`/`getItem`. But keep it one commit if it's manageable — the changes are tightly coupled (callers depend on the new return shape). The smoke test's "hard-reload while logged in" step is the key validation that 1b didn't break rehydration.
