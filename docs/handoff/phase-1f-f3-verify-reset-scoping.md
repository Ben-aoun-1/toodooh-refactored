# Phase 1f — F3 verify-email + reset-landing scoping read (read-only)

**Source:** `apps/web` (App.tsx routes, the auth pages/forms, AuthLayout) + `apps/api`
(`auth/auth.ts`, `routes/signup.ts`, `routes/password.ts`, `env.ts`) + **installed better-auth
1.6.11** (`dist/api/routes/email-verification.mjs`, `password.mjs`), read directly (CF-23). **HEAD
`ee67d7d`** (K+F1+F2 shipped), tree clean. **Date:** 2026-05-26.

**Purpose.** Read-only reconnaissance of the verify-email + reset-password **link-landing** pages →
F3's shape (net-new vs repoint, one vs two, the F3/F6 boundary, does the component-test layer /
frontend-design activate). **No edits, no commit, no plan-doc** this turn (reconnaissance → ratify →
build). Proposals to ratify, not execute (CF-22).

---

## §0 — How the better-auth links actually work (CF-23, installed source — the load-bearing read)

Both flows send a link that hits a **better-auth GET handler under `/auth/*`** (server-side), which
**redirects to a `callbackURL`/`redirectTo`** with a query param appended. The FE pages are the
**redirect targets**, not token-extractors-of-a-JWT.

### Verify (`email-verification.mjs`)
- `sendVerificationEmail` receives `url = {baseURL}/verify-email?token={JWT}&callbackURL={cb}` where
  `cb` defaults to **`/`** when signup doesn't pass one (`:28`). **Our `signup.ts` passes none → `/`.**
- Click → GET `{BETTER_AUTH_URL}/auth/verify-email?token=…&callbackURL=…` → the handler verifies the
  JWT (the Phase-1b stateless-JWT), sets `emailVerified=true`, **does NOT auto-sign-in**
  (`autoSignInAfterVerification` unset → false), then **`ctx.redirect(callbackURL)`** on success
  (`:259`) or **`ctx.redirect(callbackURL?error=<CODE>)`** on failure (`:152–154`, codes
  `TOKEN_EXPIRED`/`INVALID_TOKEN`).
- **So the FE verify page is the `callbackURL` target.** It calls NO API (better-auth already
  verified) — it reads `?error=` and renders success ("verified → sign in") or error
  ("invalid/expired"). better-auth runs `originCheck(callbackURL)` (`:116`) → the callbackURL origin
  must be in `trustedOrigins` (= `WEB_ORIGIN` ✓).

### Reset (`password.mjs`)
- `requestPasswordReset` builds `url = {baseURL}/reset-password/{token}?callbackURL={redirectTo}`
  (`:72`); `redirectTo` defaults to **`''`** when not passed. **Our `password.ts` passes none.**
- Click → GET `{BETTER_AUTH_URL}/auth/reset-password/{token}` → the handler validates the token
  (the Phase-1d `verifications`-row token), then **redirects to `redirectTo?token=VALID_TOKEN`** (or
  `?error=INVALID_TOKEN`). `originCheck(redirectTo)` applies.
- **So the FE reset-landing page is the `redirectTo` target.** It reads `?token=`, collects the new
  password, and **`POST /api/password/reset { token, new_password }`** (the existing endpoint).

### Two consequences (both load-bearing)
1. **The Vite proxy owns `/auth/*` and `/api/*`** (`vite.config.ts`). So the FE landing pages CANNOT
   live under `/auth/*` — a FE route `/auth/verify-email` would be **proxied to the backend**, not
   rendered by React. **The contract's "FE adds `/auth/verify-email`" (§3.7) is corrected (CF-23):**
   `/auth/verify-email` is **better-auth's handler**; the FE result page is a **non-`/auth` path**
   (propose **`/verify-email`**). Reset already lands on `/update-password` (not under `/auth` ✓).
2. **The callbackURL/redirectTo must be configured (BACKEND change) or the FE pages are never
   reached.** Without it, verify redirects to `/` and reset to `''`. Pass **absolute** targets
   `{WEB_ORIGIN}/verify-email` and `{WEB_ORIGIN}/update-password` (absolute → passes `originCheck`
   since `WEB_ORIGIN` is trusted; works even though dev `BETTER_AUTH_URL=:4000` — the link hits :4000,
   verifies, then top-level-redirects to the 5173 web origin). **So F3 is cross-package** (apps/api +
   apps/web), unlike F1/F2.

---

## §1 — Verify-email landing: NET-NEW

- **Route:** none exists (`App.tsx` has `/login /signup /reset-password /update-password` — no
  verify). **Net-new** at **`/verify-email`** (non-`/auth`, §0.1).
- **What the page DOES:** reads `?error=` (via `useSearchParams`). No `error` → success: "Votre email
  est vérifié, connectez-vous" + a link to `/login`. `error` present → "Lien invalide ou expiré" +
  a path forward (link to `/login` / "recommencer l'inscription"). **No API call** (better-auth
  verified server-side, §0). A thin display page.
- **Shell:** reuse **`AuthLayout`** (`title`/`subtitle`/`decorativeImage` + children) — the same shell
  `Login`/`ResetPassword`/`UpdatePassword` pages use. Styling is **composed from existing primitives**
  (AuthLayout + the brand button pattern) — no novel design.
- **Backend:** `signup.ts` → `auth.api.signUpEmail({ body, ... })` must pass `callbackURL:
  ${env.WEB_ORIGIN}/verify-email` so the post-verify redirect lands here.
- **No auto-signin** (config), so "please sign in" is the correct post-verify message (matches D-F2-7).

---

## §2 — Reset-password landing: REPOINT the existing `/update-password`

- **Route exists:** `/update-password` → `UpdatePassword` page → `UpdatePasswordForm` (158 ln). This
  IS the reset-link landing (legacy Supabase: the link auto-logged-in via `detectSessionInUrl`, then
  `updateUser({password})`).
- **Repoint (not net-new):** `UpdatePasswordForm` must (a) read **`?token=`** from the URL, (b)
  **`POST /api/password/reset { token, new_password }`** (instead of `authService.updatePassword`→
  Supabase), (c) converge to **12-char** via the F2 `password` util (it currently validates **8**,
  `:16`), (d) on success → "mot de passe réinitialisé, connectez-vous" → `/login`.
- **Backend:** `password.ts` → `requestPasswordReset({ body: { email, redirectTo:
  ${env.WEB_ORIGIN}/update-password } })`.
- **Styling note (pre-existing, not F3's fix):** `UpdatePasswordForm` is styled for a **dark**
  background (`text-white`, `bg-white/10`) yet `UpdatePassword` page wraps it in the **light**
  `AuthLayout` — a latent inconsistency. Flag only; the repoint changes data-flow, and any visual fix
  is a separate concern (would activate frontend-design).

### §2.1 — The F3/F6 boundary (the decision)
The reset flow has three parts: **request** (`/reset-password` → `POST /api/password/reset-request`),
**landing** (`/update-password` → `POST /api/password/reset`), **change** (settings → `POST
/api/password/change`). The architect's sequence put **landing in F3**, **request+change in F6**. But:
- The reset email is backend-sent only once the **request** is repointed (F6) — until then
  `/reset-password` still calls Supabase. So a reset-landing built in F3 is **component-testable but
  not end-to-end exercisable until F6**.
- The `redirectTo` wiring (password.ts) and the landing both serve reset — splitting reset across two
  commits spreads one flow.

**Two clean options (D-F3-3):**
- **Option A (recommended) — verify-only F3; ALL password in F6.** F3 = the verify page + the signup
  `callbackURL`. F6 = request + reset-landing + change + the `redirectTo` — the whole password domain,
  **end-to-end testable in one commit** (request→email→land→reset→signin). Smallest coherent F3
  ("verify works"); cohesive F6.
- **Option B (architect's original) — F3 = verify page + reset-landing (+ both backend wirings); F6 =
  request + change.** Groups "landing pages," but reset end-to-end waits for F6's request repoint, and
  reset is split.

*Lean: Option A* — cohesion + end-to-end testability beat the "landing pages" grouping.

---

## §3 — One commit vs two

- **Under Option A:** F3 is **one small commit** — the verify page + the signup `callbackURL` (+ its
  test). Trivially atomic.
- **Under Option B:** F3 = verify + reset-landing + two backend wirings — coherent but larger and
  cross-flow; could be one commit (both landings) or split (verify, then reset-landing). Lean one if B.

*Lean: Option A → one small F3 (verify).*

---

## §4 — frontend-design activation

**Minimal.** The verify page is a thin result page composed from the **existing `AuthLayout`** shell
+ the established Tailwind/brand patterns (the brand button, `text-gray-*`, the `#76E6AB` CTA the
other auth forms use). No new design-system work, no novel layout. The **frontend-design skill does
not meaningfully activate** — match the existing auth pages. (If Option B + the `UpdatePasswordForm`
dark/light styling fix were taken on, that WOULD pull in visual work — another reason to keep F3 to
the thin verify page.)

---

## §5 — Test bar (does the component layer activate?)

The verify page is **render-behavior only** (read `?error=` → show one of two messages + a link). It
has **no service method** to node-test. To test it at all needs **jsdom + @testing-library/react**
(deferred since K, D10) — for a near-logic-free display page, that's **high infra cost, low value**.

**Proposed (D-F3-6):** **do NOT stand up jsdom+RTL for F3.** The verify page's correctness is
**phase-close human visual QA** (it renders two static states). Stand up the component-test layer at
the **first render-logic-heavy commit** — the reset-landing / password-change (F6: token extraction +
password validation + POST + error states) or profile edits (F4) — where component tests earn their
infra. (The `password` util's 12-char rule the reset-landing reuses is already node-tested from F2.)
*Lean: F3 = no new tests beyond a backend assertion that signup passes the `callbackURL`
(apps/api real-integration); the FE verify page → human QA at phase close.*

(F1 carry-forward still applies wherever `apiClient` is mocked: clean mock objects, no real-module
spread.)

---

## §6 — Decisions for architect ruling (CF-22)

- **D-F3-1 — verify page is NET-NEW at `/verify-email`** (non-`/auth`, proxy conflict), reusing
  AuthLayout; reads `?error=`; no API call. *Lean: build it.*
- **D-F3-2 — backend `callbackURL`/`redirectTo` wiring is REQUIRED** (absolute `{WEB_ORIGIN}/…`) or
  the FE pages are never reached → **F3 is cross-package** (apps/api + apps/web). *Lean: wire the
  verify `callbackURL` in F3 (signup.ts); the reset `redirectTo` rides with whichever commit owns the
  reset-landing.*
- **D-F3-3 (load-bearing) — F3/F6 boundary:** Option A (verify-only F3; all password in F6) vs Option
  B (F3 verify + reset-landing). *Lean: Option A.*
- **D-F3-4 — one commit** (small, under Option A). *Lean: one.*
- **D-F3-5 — frontend-design minimal** (reuse AuthLayout; no novel design). *Lean: confirm.*
- **D-F3-6 — component-test layer NOT activated at F3** (thin display page → phase-close human QA);
  jsdom+RTL stands up at the first render-logic-heavy commit (F4/F6). *Lean: defer.*
- **D-F3-7 — CF-23 correction:** the FE verify page is NOT `/auth/verify-email` (that's better-auth's
  handler, proxied) — it's `/verify-email`. Records the contract §3.7 wording correction.

---

## Document status

**Read-only scoping read — produced, HELD for review (not committed).** Establishes: the better-auth
verify/reset link mechanics (§0, both hit `/auth/*` GET handlers → redirect to a callbackURL with
`?token=`/`?error=`); the verify page is **net-new** at a non-`/auth` path (§1); the reset-landing is
a **repoint** of `/update-password` (§2); the **F3 is cross-package** (the callbackURL/redirectTo is
required, §0.2); the recommended **Option A** boundary (verify-only F3, all password in F6, §2.1);
frontend-design minimal (§4); the component-test layer deferred past F3 (§5); seven decisions for
ruling (§6). Nothing resolved unilaterally — the F3 plan-doc is drafted only after §6 is ruled.
