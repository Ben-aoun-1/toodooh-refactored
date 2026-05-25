# Phase 1f keystone design — API client + auth-store rewrite (read-only)

**Source:** `apps/web` (the two files the keystone rewrites) + `apps/api` (the shipped contract),
read directly (CF-23 — source authoritative, not assumption). **HEAD `f661f99`**, working tree
clean. **Date:** 2026-05-25.

**Purpose.** A read-only deep read of the keystone's two files —
`features/auth/services/auth.service.ts` (945 ln, the wire layer) and
`features/auth/stores/auth.store.ts` (585 ln, the Zustand `persist` store) — plus a **proposed
keystone design** for the API-client + auth-service + auth-store rewrite that every Phase-1f
per-flow repoint routes through. **No code edits, no commits this turn** (file reads + grep only).
The proposals here are to **ratify, not execute** (CF-22) — the load-bearing decisions are
surfaced in §6 for the architect, not resolved unilaterally.

**Companion docs.** `frontend-backend-contract.md` (§7 rulings — Option B, the (a)/(b)
dispositions) is the endpoint authority; `frontend-repoint-survey.md` (§1 centralize-first, §5
prerequisites, §6 verification, §8 rulings) is the `apps/web`-side map; `audit.md` §16 carries the
Phase-1f carry-forward list. This doc is the **keystone's** focused design read, one level below the
survey.

> **Governing principle — truthful-to-the-frontend (CF-24).** Every shape proposed below was
> verified against BOTH sides from source: what the **forms/consumers actually read** and what the
> **backend actually returns**. Nothing speculative — only what the forms need and the contract
> provides.

---

## §0 — Findings that move the design (read deltas vs the carry-forward briefs)

Five source reads diverged from what the carry-forward notes assumed. Each shapes the keystone.

1. **The same-origin Vite proxy already exists** (`apps/web/vite.config.ts:server.proxy` — `/api`
   and `/auth` → `:4000`, landed in Part A). So the client base path is **relative `/api`** and a
   cross-origin `VITE_API_URL` env var is **not needed** in dev or prod (prod = single nginx
   origin). This refines the audit §16 / survey §5.1 "`VITE_API_URL`" carry-forward — that var is
   moot under the ruled same-origin model. (Decision D1.)

2. **The backend has TWO error-body shapes, and the code lives in `error`, not `code`** (the
   bootstrap brief said "`code, message, requestId`"). Read from source:
   - **Route shape** (signin/signup/profile/password/documents/reference 4xx): `{ error:
     <CODE_STRING>, message, fields? }` — **no `statusCode`, no `requestId`**.
   - **Generic/guard shape** (`error-handler.ts` thrown errors + 404, and `require-auth.ts`'s 401):
     `{ error, message, statusCode, requestId }`.
   Both carry the machine code in **`error`** (e.g. `INVALID_INPUT`, `INVALID_CREDENTIALS`,
   `EMAIL_NOT_VERIFIED`, `TAX_NUMBER_TAKEN`, `UNAUTHENTICATED`, `PAYLOAD_TOO_LARGE`,
   `STORAGE_ERROR`, `INVALID_TOKEN`, `NOT_FOUND`, `INTERNAL_ERROR`). The client normalizer must read
   `body.error` as the code and tolerate the missing/present `statusCode`/`requestId`. (Shapes the
   §1 normalizer.)

3. **Wire casing is inconsistent across endpoints.** signin / `/api/me` / reference return
   **snake_case** (`profile_type`, `onboarding_completed`, `contact_name`); the four profile PATCHes
   return **camelCase** (`businessName`, `taxNumber`, `governorateId`); documents return `{ type,
   key }` / `{ url }`. The service adapter must map per-endpoint — there is no single global casing
   rule. (Shapes the §1 typed-method layer and the F3 profile commit.)

4. **`users.status` is `pending|approved|rejected` — no `verified`.** The old store's
   `validationStatus` came from `business_profiles.verification_status`
   (`pending|verified|rejected`, code treating `verified|approved` as OK); the new value comes from
   `users.status`. Consumers **already** key on `'pending'` (`isDisabled = needsApproval &&
   validationStatus === 'pending'`) and `'approved'` (`canLaunchCampaign`) — so mapping
   `validationStatus ← user.status` and `needsApproval ← status !== 'approved'` is a **clean fit**;
   the `'verified'` branch simply retires. (Decision D5.)

5. **The documents endpoint accepts only `rne` and `cin`** (`profile-documents.ts:typeParamSchema`)
   — **not `logo`, not `bank`**. The signup wizard uploads `company_logo` + (owner) `bank_doc`, and
   the profile editors upload a logo; these have **no backend target**. Per contract §7.2 logo/bank
   are owner / later-slice (scoped out). (Decision D9 — shapes the F4 documents commit.)

---

## §1 — API-client shape

### §1.1 — What the forms consume today (the contract the client must preserve)

`auth.service.ts` wraps the Supabase SDK. Every method follows one pattern (read from source):

- **Success:** returns `data` (the row/array/auth payload) — e.g. `getGovernorates()` returns
  `Governorate[]`, `login()` returns `{ user, session }`, `updateProfile()` returns `void`.
- **Failure:** **throws `new Error(mapAuthError(error))`** — a vanilla `Error` whose `.message` is a
  **French, user-facing string** (`mapAuthError`, `:20–176`, a 156-line technical-string→French
  map).

The forms consume that exactly: `LoginForm.tsx` does `try { await login(...) } catch (e) {
toast.error(getErrorMessage(e) || '…') }` — `getErrorMessage` (`lib/errors.ts`) pulls `.message`
off any `Error`/`{message}`. **So the load-bearing form contract is: service methods resolve with
data on success and throw an `Error` whose `.message` is a French string on failure.** The keystone
must preserve this, or every form's catch block breaks.

### §1.2 — Proposed client structure

A **thin typed `fetch` wrapper**, singleton module export (mirrors the existing `import { supabase }
from '@/lib/supabase'` pattern), at `apps/web/src/lib/api-client.ts`:

- **Base path:** relative **`/api`** (same-origin proxy — §0.1). No env var. (D1.)
- **`credentials: 'include'`** on every request, so the httpOnly `Lax` session cookie rides
  same-origin (survey §5.3, ruled §8.2.1).
- **JSON** request/response by default; a separate path for `multipart/form-data` (documents — does
  NOT set `Content-Type`, lets the browser set the boundary).
- **Methods:** `get/post/patch` + a `postForm` for multipart. Generic over the response type. On
  **2xx**, parse and return the typed body. On **non-2xx**, throw a structured **`ApiError`**:
  `{ status: number; code: string; message: string; fields?: {field,reason}[]; requestId?: string }`
  — `code` ← `body.error`, the rest read defensively (tolerate both §0.2 shapes, non-JSON bodies,
  and a network failure where `fetch` itself rejects → a synthetic `code:'NETWORK'`).
- **The client is domain-agnostic** — it throws `ApiError` (machine-readable), NOT French strings.
  French translation is a **separate concern** (§1.4), so the client is reusable by later slices
  (campaigns/screens/admin) without auth coupling. (D2.)

### §1.3 — Error normalization mapping (what a form sees per status)

The client maps the backend's `(status, error-code)` to `ApiError`; a thin `apiErrorMessage(code)`
(the `mapAuthError` successor) maps the code → French for `getErrorMessage`-consuming catch blocks.
The forms need exactly these branches (contract §4.1, §7.3; survey §4):

| HTTP | Backend `error` code | Where it fires | Form needs | French (via `apiErrorMessage`) |
|---|---|---|---|---|
| 400 | `INVALID_INPUT` (+`fields[]`) | all routes (zod) | field-level validation echo | "Vérifiez les champs…" + per-field |
| 401 | `INVALID_CREDENTIALS` | signin | **generic** creds (no enumeration) | "Email ou mot de passe incorrect." |
| 401 | `UNAUTHENTICATED` | any guarded route, expired cookie | **session-expired** → clear + `/login` | "Session expirée, reconnectez-vous." |
| 403 | `EMAIL_NOT_VERIFIED` | signin | **verify-first** branch (not a creds error) | "Vérifiez votre email avant de vous connecter." |
| 409 | `TAX_NUMBER_TAKEN` (+`fields[]`) | signup | duplicate matricule | "Ce matricule fiscal est déjà enregistré." |
| 413 | `PAYLOAD_TOO_LARGE` | documents | file too big | "Fichier trop volumineux (max 5 Mo)." |
| 502 | `STORAGE_ERROR` | documents | retryable storage fail | "Échec du stockage, réessayez." |
| 400 | `INVALID_TOKEN` | password reset | expired/invalid reset link | "Lien invalide ou expiré." |
| 5xx | `INTERNAL_ERROR` / other | any | generic retry | "Une erreur s'est produite, réessayez." |
| — | `NETWORK` (fetch rejected) | any | offline/unreachable | "Problème de connexion." |

**Anti-enumeration holds by construction:** signin's 401 is identical for wrong-email and
wrong-password; signup dup-email returns **201 generic** (no `EMAIL_TAKEN` exists); reset-request is
always 200. The client surfaces what the backend sends — it cannot re-introduce the disclosure the
old `checkSignupConflicts` blur-RPC did (that method is deleted, §3).

### §1.4 — Where French translation lives

**Proposed split (D2):** the client throws `ApiError` (status+code+fields). A small
`apiErrorMessage(err: ApiError): string` — the spiritual successor to `mapAuthError`, seeded with
the §1.3 codes — does code→French. The auth-service methods catch `ApiError` and re-throw
`new Error(apiErrorMessage(e))` so **the form catch blocks (`getErrorMessage` → toast) keep working
unchanged**. This preserves §1.1's contract while keeping the transport layer domain-free. The old
156-line `mapAuthError` (Supabase technical-string matching) is **retired** — its branches were
Supabase-error-text heuristics that no longer occur; the new map is a compact code→French table.

---

## §2 — Auth-store session/identity model (the load-bearing swap)

### §2.1 — Current shape (read from source)

`useAuthStore` (`persist`, key `toodooh-auth`). **Public surface** (what 30 consumer files read):

- **State:** `user` (Supabase `User`), `loading`, `initialized`, `profileType`, `contactName`,
  `onboardingCompleted`, `shouldOnboard?`, `needsApproval?`, `validationStatus?`.
- **Actions:** `login(email,pw)`, `logout()`, `initialize()`, `refreshUserStatus()`.
- **Persisted (`partialize`):** ONLY `profileType`, `validationStatus`, `contactName`,
  `onboardingCompleted` — **not `user`** (identity was never persisted; it came live from Supabase).

**Identity source today:** Supabase's client-managed JWT — `initialize()` calls
`onAuthStateChange` (a live listener, `:278`) + `authService.getCurrentUser()`
(`supabase.auth.getUser()`), and `fetchProfileType(userId)` reads **`business_profiles` directly**
(`:135`, multi-line) for routing state. A 156-line `fetchProfileType` carries cache-gates,
30 s/15 s timeouts, and a `getPreservedStateOnError` cushion (keep approved state on a transient
network error rather than demote the user) — all **Supabase-client-throttling workarounds** that a
server `/api/me` makes largely unnecessary.

**How the rehydration window is handled:** `App.tsx` calls `initialize()` once on mount and renders
a **global spinner while `!initialized || loading`**; each route guard ALSO renders a spinner while
`!initialized`. So there is already a clean "unknown identity" gate — the new model reuses it
verbatim.

### §2.2 — Proposed model

**Preserve the public surface; rewrite the internals.** The 30 consumers don't change (§3); only the
*source* of each field changes. Field-by-field:

| Store field | Today (source) | Proposed (source) |
|---|---|---|
| `user` | Supabase `User` object | app-owned `{ id, email } \| null`, from signin resp / `/api/me` (D4) |
| `profileType` | `business_profiles.profile_type` read | `user.profile_type` (server `toProfileType(role,business_type)`) |
| `contactName` | `business_profiles.contact_name` | `user.contact_name` |
| `onboardingCompleted` | `business_profiles.onboarding_completed` | `user.onboarding_completed` |
| `validationStatus` | `business_profiles.verification_status` | **`user.status`** (`pending\|approved\|rejected`, §0.4) |
| `needsApproval` | `verification_status ∉ {verified,approved}` | **`status !== 'approved'`** (§0.4, D5) |
| `loading`/`initialized` | unchanged | unchanged |

**`user` = minimal `{id,email}` (D4).** ~16 files read `useAuthStore().user.id`/`.email` (mostly
later-slice files still nominally on the dead Supabase backend — §3); a minimal `{id,email}`
preserves their truthiness checks AND property access, so the keystone doesn't ripple into
out-of-scope files. The rich Supabase `User` import (`@supabase/supabase-js`) leaves `auth.store.ts`.

### §2.3 — Rehydration (app load / reload)

The cookie is httpOnly — JS can't read it — so identity comes from **`GET /api/me`**:

```
initialize():  set loading=true
  → GET /api/me
     200  → set user={id,email}, profileType/contactName/onboardingCompleted/validationStatus
            from the body; needsApproval = status!=='approved'; initialized=true, loading=false
     401  (UNAUTHENTICATED) → the NORMAL logged-out path: user=null, clear routing,
            initialized=true, loading=false  → guards send to /login
     network / 5xx → see D3 (fail-closed vs preserve-cushion)
```

No `onAuthStateChange` listener (deleted — there is no client JWT to observe). The `App.tsx` global
spinner covers the `/api/me` round-trip; guards already gate on `initialized`. The admin
short-circuit stays: `initialize()` keeps the existing `/admin`-pathname skip and the
`useAdminStore` check (admin is Phase 1g, still its own store/Supabase).

### §2.4 — Persist trade (D3 — the load-bearing one)

The cookie is now the **sole proof of identity**. Persisting `user` would be a lie if the cookie
expired between sessions. Two coherent options:

- **P-A (recommended) — fetch-authoritative, cushion-only persist.** Always `GET /api/me` on load;
  its result is authoritative. KEEP persisting the **routing fields**
  (`profileType/validationStatus/contactName/onboardingCompleted`) but use them ONLY as a
  transient-error cushion (the `getPreservedStateOnError` spirit): on a **non-401** `/api/me`
  failure, route an already-known approved user from the cushion instead of bouncing to login. The
  persisted fields **never** make `user` truthy — only a 200 does. Identity is always re-proven.
- **P-B — persist nothing, fail-closed.** Drop `partialize` entirely; always fetch; any `/api/me`
  failure (incl. network) → logged-out. Simplest, strictest; a transient network blip logs the user
  out and forces re-login.

**Lean: P-A**, because it mirrors the existing money-/authz-aware "don't demote on a transient
blip" intent while honoring "cookie is the only identity proof." But the **non-401-error behavior**
(cushion-route vs fail-closed) is the exact decision to ratify (D3) — it is authz-adjacent.

### §2.5 — Transitions

- **logged-out → signin → logged-in.** `login()` → **`POST /api/signin`** → 200 `{ user: {id,
  email, role, status, onboarding_completed, business_type, profile_type, contact_name} }` + the
  `Set-Cookie`. The store populates **from the signin response directly** (no extra `/api/me` — the
  response carries the full routing set); `/api/me` is the *reload* source, not the *login* source.
  On **403 `EMAIL_NOT_VERIFIED`** → throw so `LoginForm` shows the verify-first message; on **401
  `INVALID_CREDENTIALS`** → throw generic. `LoginForm` already reads `profileType` post-login for
  the owner/advertiser redirect — unchanged.
- **logged-in → signout → logged-out.** `logout()` → **`POST /api/signout`** (clears the cookie) →
  store sets `user=null` + clears routing; `persist` writes the cleared cushion.
- **401 mid-session.** Any guarded request 401s (`UNAUTHENTICATED`) because the cookie expired. The
  client surfaces it; **a shared handler clears the store** (user=null, no server call — the session
  is already dead) so the guards redirect to `/login` (D6). The one exception: the `/api/me`
  rehydration 401 is the *normal* logged-out path (§2.3), not a mid-session expiry — it must NOT
  loop. (Distinguish by call-site: rehydration handles its own 401; all other 401s route through the
  shared clear.)

### §2.6 — profileType

Still the single routing key (`App.tsx` guards + `LoginForm` redirect read it). It comes from the
**signin response + `/api/me`**, both server-reconstructed via `toProfileType(role, business_type)`
(`apps/api/src/lib/profile-type.ts` — `agency` = advertiser+business_type=agency; owners map
direct; admin → null). **No client-side reconstruction** — the store consumes the server value
verbatim. This deletes the entire `fetchProfileType` `business_profiles`-read machinery.

---

## §3 — Keystone blast radius + scope boundary

### §3.1 — Importers (grep, HEAD f661f99)

- **`useAuthStore`** read by **30 files** — `App.tsx` (guards + `initialize`), `LoginForm`, and 28
  feature pages/components/hooks. They read the **public surface** (§2.1): `user` (32×, mostly
  truthiness + `.id`/`.email`), `profileType` (5×), `contactName`, `validationStatus`,
  `needsApproval`, `onboardingCompleted`, `loading`, `initialized`, and the four actions.
- **`authService`** imported by **16 files** — the auth forms (Signup/Login/Reset/UpdatePassword),
  profile hooks/pages, and the reference-data hooks (`useSectors`, `useGovernorates`,
  `useOwnerBusinessSectors`, `useBusinessProfile`, `useUserProfile`, `useAppointmentObjectives`).

### §3.2 — The boundary: internals-only keystone

**The keystone rewrites the two files' INTERNALS and preserves their public surface, so the 30+16
importers compile and behave unchanged** — that is the whole point of centralize-first (survey §1.4).
Concretely:

**IN the keystone commit:**
- `lib/api-client.ts` (new) + `ApiError` + `apiErrorMessage` (code→French map).
- `auth.store.ts` rewrite: `user` shape swap; `initialize()`→`/api/me`; `login()`→`/api/signin`
  (consume routing body, 403/401 branches); `logout()`→`/api/signout`; `refreshUserStatus()`→
  `/api/me`; delete `onAuthStateChange` + `fetchProfileType` + the Supabase import + the timeout/
  cache machinery; persist per D3.
- `auth.service.ts` rewrite of the **session methods** the store calls: `login`, `logout`,
  `getCurrentUser`→`/api/me`. Delete `checkSignupConflicts`, `ensureBusinessProfileExists`,
  `createDefaultProfile` (anti-enumeration / Supabase-hacks, class-b §4.1).
- **Signin/signout fold IN** — they ARE the store's `login`/`logout` actions; inseparable from the
  session model (this absorbs the survey's separate "Commit 2 sign-in/out"). The **403 verify-first
  UX branch** in `LoginForm` folds in too (it's two lines and part of "signin works"). (D7.)
- `LoginForm.tsx` — near-zero change (already calls `store.login` + reads `profileType`); add the
  403 branch.

**DEFERRED to per-flow commits (§5):**
- `signUp()` (→ F1), `resetPassword`/`updatePassword`/`updatePasswordWithOld` (→ F5),
  `updateProfile`/`updateBusinessProfile`/`getBusinessProfile` (→ F3), the document upload helpers
  (→ F4), the reference-read methods (`getGovernorates`/`getBusinessSectors`/
  `getOwnerBusinessSectors`/`getCompanySizeOptions`/`getSupportObjectives*`) (→ F6/inline), and the
  `/auth/verify-email` page (→ F2).
- These methods may **temporarily still call Supabase** after the keystone (they're untouched until
  their commit) — that is fine: `supabase.ts` stays through 1f anyway (lint-1 floor, §0/survey §2.4),
  so a half-repointed `auth.service.ts` compiles and the dead Supabase calls are the pre-existing
  broken status quo, not a keystone regression.

**Net:** the keystone makes "am I logged in / who am I / log in / log out / rehydrate-on-reload"
work end-to-end through `apps/api`. Everything else is a thin per-flow adapter onto the now-working
client+store.

---

## §4 — Keystone verification model (the test bar)

Per survey §6 / ruling §8.2.6 (a deliberate test-floor **raise**). The keystone's bar:

**Floor gates (every commit):** build (≤ 139.80 kB gzip + tolerance for the new client), typecheck
(ratchets **down** as account-layer `as any`/`see #15` TODOs leave — `auth.store`+`auth.service`
shed Supabase-untyped calls), lint (**stays 1** — `database.types` clears only when `supabase.ts`
goes, last slice), the **160 existing tests stay green** (they don't touch auth, so they won't break
— and give no safety, the gap §6.2 named).

**New keystone tests (node-level, the achievable bar):**
1. **`api-client` unit test** (mocked `fetch`): asserts `credentials:'include'`, base `/api`, 2xx
   JSON parse, and `ApiError` normalization for **each** branch in §1.3 — both error shapes (§0.2),
   the `fields[]` pass-through, non-JSON body, and the `fetch`-rejected `NETWORK` case; `requestId`
   captured when present.
2. **`apiErrorMessage` unit test**: each code → its French string; unknown code → generic.
3. **`auth.store` unit test with a MOCKED client**: rehydration (200→logged-in; 401→logged-out;
   non-401→the D3 behavior); login (200 populates routing; 403 throws verify; 401 throws generic);
   logout clears; the 401-mid-session shared-clear. The store is plain TS — testable via
   `getState/setState` in the existing **`environment:'node'`** vitest config with a small
   `localStorage` shim for `persist` (no DOM needed).

**Deferred (NOT the keystone's bar):**
- **Component tests** (`LoginForm`, the verify page) need **jsdom + Testing Library**, a test-infra
  addition — introduced with the **first per-flow UI commit** that needs it, not in the keystone
  (keeps the keystone free of an infra detour). (D10.)
- **Running-both round-trip** (live `apps/api` signin→`/api/me`→signout) — exercised first at the
  signin/signup per-flow commits and formally at **phase close** (survey level 3 / §8.2.6). A manual
  keystone smoke (login → reload → still-logged-in → logout) is reasonable but not a gate.

---

## §5 — Proposed Phase-1f per-flow commit sequence

Refines survey §7.B by **folding signin/signout into the keystone** (§3, D7). Order driven by: the
keystone unblocks all; reference reads unblock the forms that fetch them; cleanup is last.

| # | Commit | Scope | Depends |
|---|---|---|---|
| **K** | **Keystone** | api-client + `ApiError`/`apiErrorMessage`; store session model (`/api/me`, signin, signout, persist D3, `user` swap); session methods in `auth.service`; `LoginForm` 403 branch | Part A (done) |
| **F1** | **Reference reads** | `useSectors`→`/api/business-sectors?audience=advertiser`, `useOwnerBusinessSectors`→`?audience=owner`, `useGovernorates`→`/api/governorates`; `company_size`→**hardcoded FE constant**; `support_objectives_*` per D8 | K |
| **F2** | **Sign-up repoint** | 1940-ln wizard → grown `POST /api/signup`; stop enumeration (drop blur-RPC); 12-char floor; non-privileged `profile_type`; collect-and-ignore owner extras (`.strip`); consume 201-generic. **Sub-factor at plan time.** | K, F1 |
| **F3** | **Verify-email + reset pages** | new `/auth/verify-email` route + post-verify "please sign in"; the reset page consumes the link token | K |
| **F4** | **Profile edits repoint** | split `updateProfile` → the 4 `PATCH /api/profile/{business,contact,address,notifications}`; **camelCase response handling** (§0.3); `getBusinessProfile`→`/api/me` | K |
| **F5** | **Documents repoint** | `storage`→`POST/GET /api/profile/documents/:type`; **rne/cin only** (logo/bank per D9) | K, F4 |
| **F6** | **Password reset/change repoint** | `/api/password/{reset-request,reset,change}`; 12-char convergence; drop the 6-char service guard + owner special-char rule | K, F3 |
| **F7** | **Account-layer Supabase cleanup sweep** | remove now-dead Supabase calls in the in-scope files; the `owner_business_sectors`→`audience` retarget (§5.3); **client stays** (lint-1 stays) | F1–F6 |
| **F8** | **Phase-1f audit refresh** | §17 record; floor deltas; CF instances; first frontend-verification-model worked example | F7 |

**Notes.** F1–F6 are near-parallel once K lands (each a thin adapter). **F2 is the largest** (the
1940-line wizard) — its own sub-factoring at plan time. F3+F6 pair (the reset page consumes the
token F6 posts). F7 is the *bounded* cleanup (not full Supabase removal — §2.3 later-slice files
stay).

---

## §6 — Load-bearing unknowns / decisions for architect ruling (CF-22)

Surfaced with a recommendation each; **not resolved here.**

- **D1 — API base / env.** Relative **`/api`** (recommended; same-origin proxy already shipped, no
  env var) vs a configurable `VITE_API_URL` defaulting to `/api`. *Lean: relative `/api`.*
- **D2 — Error-translation placement.** Client throws domain-agnostic `ApiError`; a separate
  `apiErrorMessage(code)` does code→French in the service layer (recommended — reusable by later
  slices) vs the client returns French directly. *Lean: split.*
- **D3 — Persist trade (load-bearing, authz-adjacent).** **P-A** fetch-authoritative + cushion-only
  persist of routing fields, with the **non-401-error behavior** = cushion-route an already-known
  approved user; vs **P-B** persist-nothing, fail-closed to login on any `/api/me` failure. *Lean:
  P-A; the non-401 branch is the precise call.*
- **D4 — `user` shape.** Minimal app-owned `{id,email}` (preserves ~16 later-slice `.id`/`.email`
  reads). Confirm no richer client `user` is needed (the full profile lives in `/api/me`/React Query,
  not the store). *Lean: `{id,email}`.*
- **D5 — `validationStatus`/`needsApproval` mapping.** `validationStatus ← users.status`
  (`pending|approved|rejected`); `needsApproval ← status!=='approved'`; retire the `'verified'`
  branch. Consumers already key on `pending`/`approved`. *Lean: as stated.*
- **D6 — 401-mid-session handling.** A shared client→store clear on any non-rehydration 401
  (user=null → guards redirect), with the `/api/me` rehydration 401 kept as the normal logged-out
  path (no loop). Confirm the mechanism (client-level interceptor vs explicit per-call). *Lean:
  shared interceptor + a rehydration opt-out.*
- **D7 — Keystone scope boundary.** Fold signin/signout (the store actions) AND the `LoginForm` 403
  verify-first branch INTO the keystone (absorbing survey "Commit 2"); the verify *page* stays F3.
  vs keep signin/out a separate post-keystone commit. *Lean: fold in.*
- **D8 — Orphan reference reads with no backend.** `company_size_options` → **hardcoded FE
  constant** (audit §16 — like owner `parcCountOptions`). `support_objectives_*` /
  `getAppointmentObjectives` (no backend, not in the account contract) → **leave on Supabase (dead,
  out of scope) until their slice** vs hardcode now. *Lean: company_size hardcode; support_objectives
  leave-on-Supabase (scope-tight; lint-1 stays regardless).*
- **D9 — logo/bank document uploads (no backend type).** Documents endpoint = rne/cin only. F5
  wires rne/cin; the wizard `company_logo` + owner `bank_doc` + profile logo uploads → make the
  upload a **no-op / deferred** (collect-but-don't-upload, owner/later-slice per contract §7.2) vs
  drop the fields. *Lean: keep the fields, no-op the upload, defer.*
- **D10 — Keystone test bar.** Node-level unit tests (api-client + `apiErrorMessage` + store with
  mocked fetch/storage); defer jsdom+Testing-Library component tests to the first per-flow UI commit
  and the running-both round-trip to phase close. Confirm this is the ratified keystone bar (not a
  lighter/heavier one). *Lean: as stated.*

---

## §7 — Architect rulings (ratified 2026-05-25)

The design is ratified; D1–D10 are ruled and the five §0 read-deltas are accepted as findings. This
section records the resolution so the doc carries its own decisions (same precedent as
`frontend-backend-contract.md` §7 / `frontend-repoint-survey.md` §8). The keystone is drafted from
this.

**Read-deltas (§0) — accepted as findings.** proxy-exists (base `/api`, no env) · error in
`body.error` not `body.code` · per-endpoint casing · `status = pending|approved|rejected` (no
`verified`) · documents = rne/cin-only.

- **D1 — API base / env → relative `/api`, no env var.** The same-origin proxy makes a cross-origin
  `VITE_API_URL` moot (dev proxy + prod single-origin nginx).
- **D2 — Error translation → SPLIT.** The client throws a domain-agnostic `ApiError`
  (status+code+fields+requestId); the service maps `code→French` via `apiErrorMessage`, preserving
  the form contract (`getErrorMessage` → toast) unchanged.
- **D3 — Persist trade (load-bearing) → P-A, refined.** The cushion is the **routing fields ONLY**
  and **NEVER makes `user` truthy**. `/api/me` outcomes:
  - **200** → authoritative **logged-in** (set `user` + routing).
  - **401** → **logged-out** (the normal path).
  - **non-401** (network / 5xx) → **`user` falsy for gating** (the AUTH decision **fails closed**) +
    **cushion RETAINED** (the PAINT stays graceful) + a **retry-able error state on rehydration** —
    a logged-in user hitting a transient 500 gets "retry," **not** a silent logout and **not** a
    false-authed app. *The auth decision fails closed; the paint optimization stays graceful.*
    Backend `require-auth` is the real gate regardless — the store's identity is **UI/routing only**
    and cannot become an auth bypass.
- **D4 — `user` shape → `{id,email}`.** Routing fields stay separate store fields.
- **D5 — status mapping → as proposed.** `validationStatus ← status`; `needsApproval ←
  status !== 'approved'`; the `'verified'` branch retires.
- **D6 — 401 handling → shared clear with a rehydration opt-out.** Rehydration 401 = a quiet
  logged-out (no loop); any **mid-session** 401 = clear + redirect to `/login`.
- **D7 — Keystone scope → FOLD signin/signout in.** They ARE the store's session actions, inseparable
  from the rewrite (the D3/D6 transitions *are* login/logout) — splitting would ship a store that
  can't log in. The `LoginForm` 403 verify-first branch folds in too (intrinsic to signin working).
  All other forms deferred.
- **D8 — Orphan reference reads.** `company_size` → **hardcoded FE constant**; `support_objectives_*`
  → **stays on Supabase** (out of scope).
- **D9 — logo/bank uploads → defer / no-op** (no backend target). **FLAG carried to F4 (profile)
  plan-write:** verify the logo isn't load-bearing in the slice-1 critical path (e.g. admin-approval
  profile-completeness). Lean cosmetic → defer is fine; if required, a small logo endpoint lands
  then.
- **D10 — Keystone test bar → node-level.** Mocked-`fetch` client + mocked-client store +
  `localStorage` shim (incl. the D3 non-401 behavior); component tests + the running-both round-trip
  deferred.

**Keystone scope (locked).** `lib/api-client.ts` (`ApiError`, `apiErrorMessage`) + the auth-store
rewrite (D3 rehydration, D4 `user`, D5 status, D6 401) + the session methods (`login`→`POST
/api/signin` populate-from-response, `logout`→`POST /api/signout` clear, `getCurrentUser`→`GET
/api/me`) + the `LoginForm` 403 branch + deletion of the three anti-enum/Supabase-hack methods
(`checkSignupConflicts`, `ensureBusinessProfileExists`, `createDefaultProfile`). Node-level tests per
D10. **`supabase.ts` STAYS** (later-slice features). **Deferred to F1–F6:** `signUp`, password,
profile, documents, reference reads, the verify page.

**Per-flow sequence (ratified).** K → F1 reference → F2 signup (sub-factor) → F3 verify+reset → F4
profile → F5 documents → F6 password → F7 cleanup → F8 refresh.

---

## Document status

**RATIFIED (§7), 2026-05-25.** The read-only design read established, from source on both sides: the
API-client shape + the two-error-shape normalizer (§1); the auth-store session/identity model —
rehydration via `/api/me`, the persist trade, the four transitions, the field-source table (§2); the
internals-only keystone boundary across 30+16 importers (§3); the node-level test bar (§4); the
per-flow sequence (§5); and ten decisions surfaced for ruling (§6). §7 records the architect's
rulings (D1–D10 + the five §0 read-deltas accepted as findings). The keystone commit is drafted from
§7.
