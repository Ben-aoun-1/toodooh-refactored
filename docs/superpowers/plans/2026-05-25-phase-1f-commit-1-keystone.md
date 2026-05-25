# Phase 1f — Commit 1 (Keystone): API client + auth-store rewrite

**Status:** RATIFIED (§2.D + §11.6 ruled 2026-05-25) — executing.
**Design authority:** `docs/handoff/phase-1f-keystone-design.md` (§7 rulings D1–D10).
**Region:** `apps/web` (first sustained frontend commit of Phase 1f).
**HEAD at draft:** `5d46b48`. Date: 2026-05-25.

This is the load-bearing commit of the largest phase: the API client + auth-store session-model
rewrite every per-flow repoint (F1–F8) routes through. The store's **public surface is preserved**
so the 30 consumer files don't change; only the internals swap Supabase → `apps/api`.

---

## §0 — Pre-flight verification

Run at execution start (CF-10 — re-baseline; the documented floor may have moved):

- `git status` clean; HEAD = `5d46b48` (or later if the design doc landed differently).
- Documented floor (audit §16): **root typecheck 51 · lint 1 · `apps/web` 160 tests · build 139.80 kB
  gzip** (`apps/api` 146 unaffected — backend untouched). Re-run all four; record actuals.
- Confirm the Vite proxy is present (`apps/web/vite.config.ts` `server.proxy` `/api`+`/auth` →
  `:4000`) — the base-path premise (D1). Confirm `apps/api` is runnable locally (full env block,
  [[local-migrate-needs-full-env-block]]) for the optional manual smoke (not a gate).
- Node 20 on PATH for every gate + commit ([[node-20-required-for-commits]]).

---

## §1 — Locked constraints (architect, design §7)

- **D1** base `/api`, no env var. **D2** client throws `ApiError`; service maps code→French
  (`apiErrorMessage`), preserving `getErrorMessage`→toast. **D3** persist = routing-fields cushion
  ONLY, never makes `user` truthy; `/api/me` 200=logged-in, 401=logged-out, non-401=auth-fails-closed
  + cushion-retained + retry-able error state. **D4** `user={id,email}`. **D5** `validationStatus←
  status`, `needsApproval←status!=='approved'`, `verified` retires. **D6** shared 401-clear with a
  rehydration opt-out. **D7** signin/signout fold IN (+ `LoginForm` 403 branch). **D10** node-level
  tests only.
- **`supabase.ts` STAYS** (later-slice features import it; lint-1 floor stays — design §3.2 / survey
  §2.4). The keystone removes Supabase *usage in the rewritten methods*, not the client.
- **Public store surface unchanged** (fields + the four actions) — consumers must not need edits.
- **No UI redesign.** `LoginForm` gets one new error branch (403), nothing else. Visual-QA is a
  phase-close gate, not this commit (no rendered change beyond the 403 toast text + the rehydrate
  retry screen).

---

## §2 — Inventory (CF-23, from source) + the one scope finding

### §2.A — The keystone touches these files

| File | Action |
|---|---|
| `lib/api-client.ts` | **NEW** — `ApiError` + `apiClient` (typed fetch singleton, D1/D2/D6) |
| `features/auth/services/auth-errors.ts` | **NEW** — `apiErrorMessage(err)` code→French (D2) |
| `features/auth/stores/auth.store.ts` | **REWRITE** internals (D3/D4/D5/D6); preserve surface |
| `features/auth/services/auth.service.ts` | rewrite **session methods only** (`login`/`logout`/`getCurrentUser`); delete `createDefaultProfile`; see §2.C/§2.D |
| `App.tsx` | add the D3 rehydrate-retry branch (§11.5) |
| `lib/api-client.test.ts` | **NEW** test (D10) |
| `features/auth/services/auth-errors.test.ts` | **NEW** test (D10) |
| `features/auth/stores/auth.store.test.ts` | **NEW** test (D10) |

### §2.B — Store public surface (preserve verbatim — 30 importers)

State `user · loading · initialized · profileType · contactName · onboardingCompleted · shouldOnboard?
· needsApproval? · validationStatus?`; actions `login · logout · initialize · refreshUserStatus`.
Reads verified (design §3.1): `user` (truthiness + `.id`/`.email`, incl. ~16 later-slice files),
`profileType` (guards + LoginForm), the `needsApproval && validationStatus==='pending'` isDisabled
idiom (≥10 pages), `refreshUserStatus` (MyAccount). **Additions allowed (non-breaking):** an internal
`clearSession()` action (for D6) + a `rehydrateError` boolean (for D3's retry state) — purely
additive, no consumer reads them except a new `App.tsx` retry branch.

### §2.C — Service methods: rewrite-now vs leave-for-later

`auth.service.ts` has 11 methods + `mapAuthError`. The keystone rewrites ONLY the session three; the
rest are **left untouched** (they still call Supabase, compile, and repoint in F2–F6 — design §3.2):

- **Rewrite in K:** `login`→`POST /api/signin` (return the response `user` body for the store to
  populate from — D7); `logout`→`POST /api/signout`; `getCurrentUser`→`GET /api/me`
  (`{skipAuthRedirect:true}`; 401→`null`, non-401→rethrow so the store sets the retry state — D3).
- **Leave in K (repoint later):** `signUp` (F2), `resetPassword`/`updatePassword`/
  `updatePasswordWithOld` (F6), `updateBusinessProfile`/`updateProfile`/`getBusinessProfile`/
  `deactivateAccount` (F3/F4), the reference reads `getGovernorates`/`getBusinessSectors`/
  `getOwnerBusinessSectors`/`getCompanySizeOptions`/`getSupportObjectives*`/`getAppointmentObjectives`
  (F1; `company_size`→constant + `support_objectives`→stays-Supabase per D8).
- **`mapAuthError` STAYS** — `signUp`/`resetPassword`/`updatePassword`/profile/reference methods
  still call it; it retires only when its last caller repoints (F2–F6). `apiErrorMessage` is added
  **alongside** it (the session methods use the new one; the deferred methods keep the old until
  their commit).
- **`getCurrentUser` compatibility:** its deferred callers (`getBusinessProfile:787`,
  `deactivateAccount:810`, `updateProfile:843`) use `(await getCurrentUser())?.id` — the new
  `/api/me` user carries `.id`, so they keep compiling (then feed dead Supabase calls — the
  pre-existing broken status quo until F3/F4).

### §2.D — SCOPE FINDING (CF-22 — surfaced, NOT resolved unilaterally)

The locked K-scope (design §7) says **delete `checkSignupConflicts`, `ensureBusinessProfileExists`,
`createDefaultProfile`**. Source (grep, HEAD `5d46b48`) shows:

- `createDefaultProfile` — **zero callers** (internal + external). Safe to delete in K. ✓
- `checkSignupConflicts` — called by `signUp` (`auth.service.ts:390`) **and** `SignUpForm.tsx:315`.
- `ensureBusinessProfileExists` — called by `signUp` (`auth.service.ts:679`).

`signUp` and `SignUpForm.validateUniqueCredentials` are **deferred to F2**. Deleting the latter two
in K therefore **breaks `pnpm typecheck`** (callers reference a deleted method) — violating CLAUDE.md
rule 7 (end green) and the "no broken commit" contract.

**RULED (2026-05-25):** in K delete **only `createDefaultProfile`** (genuinely dead); **defer the
`checkSignupConflicts` + `ensureBusinessProfileExists` deletion to F2** (the signup repoint), where
their callers are removed/repointed and the anti-enumeration class-(b) change lands as one coherent
diff (`checkSignupConflicts`'s deletion **IS** the signup enumeration removal — design §1.3 /
contract §7.3.1). This keeps K green and keeps the anti-enum deletion atomic with its callers. Spirit
preserved (the three go away); timing corrected (each lands green). **F2 carry-forward: F2 owns those
two deletions + the enumeration removal.** CF-22 literal-vs-spirit.

### §2.E — typecheck-ratchet expectation (honest, estimate-drift discipline)

The store rewrite sheds its 5 Supabase `any`-disables; `getCurrentUser` sheds its Supabase typing.
The service's other 16 `any`-sites (signUp/mapAuthError/profile/reference) **stay** until F2–F6. So
K's typecheck-floor drop is **partial and modest** — quantified at execution, **not pre-committed to
a number** (the survey's "~50" is the whole-phase figure, not K's). Lint stays **1**. Tests **grow**
(+3 files; the deliberate ratchet — methodology §1 / ruling §8.2.6). Build: +the client (~small);
hold ≤ 139.80 kB + tolerance.

---

## §3 — Commit factoring

**Single commit** (K). The api-client + store + session methods + the App.tsx retry branch + the
three tests are one inseparable unit (the store can't be tested without the client; signin/signout
ARE the store actions — D7). No `LoginForm` change (§11.6 ruling — the toast suffices). No sub-split;
it is already the smallest coherent "make auth work through the API" unit.

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor ≤ 51 (record the drop; partial per §2.E).
- `pnpm lint` — green; floor **1** (unchanged — `database.types` survives).
- `pnpm test` — green; **160 + 3 new files** (api-client, auth-errors, auth.store), all passing.
- `pnpm build` — green; main bundle ≤ 139.80 kB gzip + tolerance (note the delta).
- The three new tests assert (D10): client `credentials:'include'` + base `/api` + each §1.3 error
  branch (both shapes, `fields[]`, non-JSON, `NETWORK`, `requestId`); `apiErrorMessage` per code;
  store rehydration (200/401/non-401-retry), login (200/403/401), logout-clear, mid-session
  401→clearSession.

---

## §5 — Standing operating procedure

Node-20 PATH prefix on every gate + commit. Conventional Commits, no `Co-Authored-By` trailer
(CLAUDE.md rule 9). CF-7 gate-sweep before push. The husky pre-commit (prettier/lint-staged) runs;
ensure staged files only.

---

## §6 — Hard-halt conditions

- **§2.D ruled** — K deletes ONLY `createDefaultProfile`; the other two defer to F2 (no longer a
  halt; recorded for execution discipline).
- Any gate red after the rewrite → revert, surface (CLAUDE.md rule 7). Do not commit broken.
- If the store rewrite forces a consumer edit (public-surface leak) → halt and surface (the
  centralize premise — design §3 — would be violated; the surface change needs ratification).
- `itstrategix.tn` or any auth-security surprise in the touched code → halt and tell (CLAUDE.md).

---

## §7 — Risk register

- **Circular import (store ↔ client):** the client must NOT import the store. D6 wiring = the store
  registers an `onUnauthorized` callback on the client at module init (`apiClient.onUnauthorized(() =>
  useAuthStore.getState().clearSession())`); the client invokes it on a non-rehydration 401. One-way
  dep (store→client) preserved.
- **Rehydration 401 loop:** the `/api/me` call passes `{skipAuthRedirect:true}` so its 401 is the
  quiet logged-out path, NOT the shared-clear/redirect (D6). Tested.
- **persist cushion staleness:** the cushion never makes `user` truthy (D3) — a stale approved
  cushion can only mis-paint a dashboard for the ms before `/api/me` returns, never grant access
  (backend `require-auth` is the real gate). Asserted in the store test.
- **`user` shape break in later-slice files:** `{id,email}` preserves `.id`/`.email`; the rich
  Supabase `User` import leaves `auth.store.ts`. Typecheck is the guard (the 16 files compile or they
  don't).
- **Test env (`environment:'node'`):** the store's `persist` needs `localStorage` — stub via
  `vi.stubGlobal('localStorage', <memory mock>)` in the store test (no jsdom; D10).

---

## §8 — Cross-references

- Design: `docs/handoff/phase-1f-keystone-design.md` (§1 client, §2 store, §3 boundary, §7 rulings).
- Contract: `frontend-backend-contract.md` §3.2/§7.3 (signin shape, class-b). Survey:
  `frontend-repoint-survey.md` §1 (centralize), §3 (the repoint map), §6 (verification).
- Backend source (the wire truth): `apps/api/src/routes/{signin,me,signout}.ts`, `error-handler.ts`,
  `middleware/require-auth.ts`, `lib/profile-type.ts`.
- Audit row to write at F8: `audit.md` §17 (Phase 1f).

---

## §9 — Carry-forward methodology

- **CF-22** — the §2.D deletion-timing finding (literal K-scope vs typecheck reality); surfaced,
  awaiting ratification, not rescoped unilaterally ([[literal-vs-spirit-surface-and-ratify]]).
- **CF-23** — the design was source-read on both sides; this plan re-verified callers from source
  (the §2.D catch is a CF-23 instance — the locked scope assumed deletability the call-graph denies).
- **CF-24** — truthful-to-frontend: the client/store shapes match what the forms consume + what the
  backend returns (the five §0 read-deltas).
- **Candidate** — first worked instance of the Phase-1f frontend verification model (node-level
  mocked-client tests as the per-commit bar); promote at F8 if it holds across F1–F7.

---

## §10 — Push policy + sequencing

Code commit → CF-7 gate-sweep → CF-9 pause (architect review) → push on approval → CI headSha verify.
**No visual-QA pause needed** (no material rendered change; the 403 toast + retry screen are minor —
human may still glance). This is a code commit, not a doc commit (CF-6 immediate-push does not
apply).

---

## §11 — Component specs (exact bodies written at execution per these specs)

### §11.1 — `lib/api-client.ts`

```
export class ApiError extends Error {
  status: number; code: string; fields?: {field:string;reason:string}[]; requestId?: string;
  // message = body.message (raw; French translation is apiErrorMessage's job, D2)
}
type ReqOpts = { skipAuthRedirect?: boolean };
let unauthorizedHandler: (() => void) | null = null;
export const apiClient = {
  onUnauthorized(fn) { unauthorizedHandler = fn; },        // store registers (D6)
  get<T>(path, opts?), post<T>(path, body?, opts?), patch<T>(path, body?, opts?),
  postForm<T>(path, form: FormData, opts?),                // multipart (F5) — no Content-Type
};
```

Behavior: base `'/api'`; `credentials:'include'` always; JSON methods set
`Content-Type: application/json` + `JSON.stringify(body)`. On response: 2xx → parse JSON (empty/204 →
`undefined as T`); non-2xx → parse body defensively (JSON-or-`{}`), throw
`new ApiError({ status, code: body.error ?? 'UNKNOWN', message: body.message ?? '', fields:
body.fields, requestId: body.requestId ?? headers['x-request-id'] })`; **on a 401 without
`skipAuthRedirect`** invoke `unauthorizedHandler()` before throwing (D6). `fetch` rejection (network)
→ `new ApiError({ status:0, code:'NETWORK', message:'' })`. No store import (one-way dep).

### §11.2 — `features/auth/services/auth-errors.ts`

```
export function apiErrorMessage(err: unknown): string  // ApiError → French (design §1.3 table)
```

Maps `err.code` → the French strings in design §1.3 (INVALID_CREDENTIALS, UNAUTHENTICATED,
EMAIL_NOT_VERIFIED, TAX_NUMBER_TAKEN, INVALID_INPUT [+ first `fields[].reason`], PAYLOAD_TOO_LARGE,
STORAGE_ERROR, INVALID_TOKEN, NETWORK, default INTERNAL_ERROR). Non-`ApiError` → generic. Pure, no
I/O (same invariant as `lib/errors.ts`).

### §11.3 — `features/auth/services/auth.service.ts` (session methods)

```
async login(email, password) {
  const { user } = await apiClient.post<{user: SigninUser}>('/signin', { email, password })
    .catch(rethrowAsFrench);                  // 403/401 → throw new Error(apiErrorMessage(e))
  return user;                                // store populates routing from this (D7)
}
async logout() { await apiClient.post('/signout').catch(rethrowAsFrench); }
async getCurrentUser(): Promise<MeUser | null> {
  try { const { user } = await apiClient.get<{user: MeUser}>('/me', { skipAuthRedirect:true }); return user; }
  catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; }  // non-401 → rethrow (D3)
}
```

`SigninUser`/`MeUser` typed to the snake_case bodies (design §0.3): `{id,email,role,status,
onboarding_completed,business_type,profile_type,contact_name}` (+ `/me` extras unused by the store).
`rethrowAsFrench` = `(e) => { throw new Error(apiErrorMessage(e)); }` — preserves §1.1's form
contract. Delete `createDefaultProfile` (§2.D). Add the new types to `types/auth.ts` or co-locate.

### §11.4 — `features/auth/stores/auth.store.ts` (rewrite)

State adds `rehydrateError: boolean` (D3) + action `clearSession()`. Remove: `@supabase/supabase-js`
import, `supabase` import, `onAuthStateChange`/`initializeAuthListener`, `fetchProfileType` +
`getPreservedStateOnError` + all timeout/cache machinery. `user: {id:string;email:string} | null`.

```
const mapRouting = (u) => ({                       // shared by login + initialize (D5)
  user: { id: u.id, email: u.email },
  profileType: u.profile_type, contactName: u.contact_name,
  onboardingCompleted: u.onboarding_completed,
  validationStatus: u.status, needsApproval: u.status !== 'approved',
  shouldOnboard: !u.onboarding_completed,
});

initialize: async () => {                          // D3
  set({ loading:true, rehydrateError:false });
  // keep the existing /admin-pathname + useAdminStore short-circuit (admin = Phase 1g)
  try {
    const u = await authService.getCurrentUser();
    if (u) set({ ...mapRouting(u), initialized:true, loading:false });
    else  set({ user:null, profileType:null, contactName:null, onboardingCompleted:false,
                shouldOnboard:false, needsApproval:false, validationStatus:undefined,
                initialized:true, loading:false });                       // 401 = logged-out
  } catch {                                                                // non-401 = retry, cushion kept
    set({ user:null, rehydrateError:true, initialized:true, loading:false });
    // routing fields NOT cleared (cushion retained for paint); user falsy → gating fails closed
  }
},
login: async (email,pw) => {                       // D7 — populate from the response
  set({ loading:true });
  try { const u = await authService.login(email,pw); set({ ...mapRouting(u), loading:false }); }
  catch (e) { set({ loading:false, user:null, profileType:null, /* clear routing */ }); throw e; }
},
logout: async () => { set({loading:true}); try { await authService.logout(); } finally { get().clearSession(); set({loading:false}); } },
clearSession: () => set({ user:null, profileType:null, contactName:null, onboardingCompleted:false,
                          shouldOnboard:false, needsApproval:false, validationStatus:undefined }),
refreshUserStatus: async () => { const u = await authService.getCurrentUser(); if (u) set(mapRouting(u)); },
```

Module init (after the store is created): `apiClient.onUnauthorized(() =>
useAuthStore.getState().clearSession())` (D6). `persist.partialize` unchanged (the cushion:
`profileType`, `validationStatus`, `contactName`, `onboardingCompleted`).

### §11.5 — `App.tsx` (D3 retry screen — minimal)

Add: if `rehydrateError` (and `initialized`), render a small "connexion impossible — réessayer"
screen with a button calling `initialize()` again, instead of the spinner/login bounce. One branch
above the existing `!initialized || loading` guard.

### §11.6 — `LoginForm.tsx` (D7 403 branch)

**RULED (2026-05-25): NO LoginForm change in K.** The catch already does `toast.error(getErrorMessage(e)
|| …)`. `apiErrorMessage` maps `EMAIL_NOT_VERIFIED`→the French verify message and
`INVALID_CREDENTIALS`→generic, and `login` throws those via `rethrowAsFrench` — so the existing catch
surfaces the right text as a toast with **no LoginForm code change**. **HARD REQUIREMENT (ruling):
`apiErrorMessage` MUST include `EMAIL_NOT_VERIFIED` → a correct French verify-first message** (that is
now how verify-first reaches the user in K — it must NOT fall through to the generic). Asserted in
`auth-errors.test.ts`. The distinct 403 UX (resend-verification / verify-pending redirect) lands with
**F3** (the verify pages), where the verify flow lives. `LoginForm.tsx` is therefore **NOT touched in
K** (drop it from §2.A's file list at execution).

### §11.7 — Tests (`*.test.ts`, node env, D10)

- `lib/api-client.test.ts`: `vi.stubGlobal('fetch', mock)`; assert `credentials:'include'`, base
  `/api`, JSON parse, every §1.3 branch (both error shapes, `fields[]`, non-JSON, `NETWORK`,
  `requestId`), and `onUnauthorized` fires on a non-skip 401 but NOT on a `skipAuthRedirect` 401.
- `features/auth/services/auth-errors.test.ts`: each code → French; unknown → generic.
- `features/auth/stores/auth.store.test.ts`: `vi.stubGlobal('localStorage', memoryMock)` + mock
  `authService`; assert rehydration (200→logged-in via mapRouting; 401→logged-out; non-401→
  `rehydrateError` + cushion retained + `user` null); login (200 populates; 403/401 throw + clear);
  logout→clearSession; the registered `onUnauthorized`→clearSession.

---

## §12 — Fire instruction

After §2.D ratification: execute K per §11, gate-sweep (§4), CF-9 pause, push on approval. Then F1
(reference reads) is drafted.
