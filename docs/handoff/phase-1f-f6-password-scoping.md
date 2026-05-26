# Phase 1f — F6 password-domain scoping read (read-only)

**Source:** `apps/web` (ResetPasswordForm, UpdatePasswordForm, the change sub-forms in UserProfile/
OwnerSettings, MyAccount, `auth.service` password methods, `utils/password.ts`) + `apps/api`
(`routes/password.ts`, `auth/auth.ts`) + installed better-auth, read directly (CF-23). **HEAD
`c3dfe6d`** (F5 shipped). **Date:** 2026-05-26.

**Purpose.** Scope the whole password domain — the LAST per-flow commit. **No edits/commit/plan-doc.**
Proposals to ratify (CF-22). One notable finding (MyAccount).

---

## §1 — The three flows (current → repoint)

| Flow | FE | current | F6 → |
|---|---|---|---|
| **a. Request** | `ResetPasswordForm` (`/reset-password`) | `authService.resetPassword(email)` → `supabase.resetPasswordForEmail` | `POST /api/password/reset-request {email}` |
| **b. Reset-landing** | `UpdatePasswordForm` (`/update-password`) | `authService.updatePassword(pw)` → `supabase.updateUser` (8-char; **reads NO token**) | read `?token=`/`?error=` → `POST /api/password/reset {token, new_password}` |
| **c. Change** | password sub-form in `UserProfile`/`OwnerSettings` | `authService.updatePasswordWithOld(cur, new)` → supabase re-auth + updateUser | `POST /api/password/change {current_password, new_password}` |

- **a. Request — anti-enum holds:** `ResetPasswordForm` already shows a generic "email sent" + navigates
  `/login`; **no pre-check oracle** (unlike F2 signup's `checkSignupConflicts`). The backend
  reset-request is generic-200 (Phase-1d). Just repoint the call; the generic UX is already correct.
- **b. Reset-landing — the most page-logic.** Today it reads NO token (Supabase used the
  link-session). The reset email link → better-auth's `/auth/reset-password/:token` GET → **redirects
  to `redirectTo?token=VALID`** (or `?error=INVALID_TOKEN`) (F3-style). So `/update-password` gets
  `?token=` (show the form → POST `/reset`) or `?error=` (show "lien invalide"). The reset
  **revokes all sessions** (`revokeSessionsOnPasswordReset`) → no auto-login → `/login` after (correct).
- **c. Change — session consequence.** The backend `/change` does `revokeOtherSessions:true` + **forwards
  the refreshed cookie** (the caller's device stays alive — Phase-1d D4). So after change the user
  **stays logged in** (the new cookie rides the response via `credentials:'include'`); the forms clear
  the fields + toast (no re-login). **No FE change needed for the session** — confirm.

### Method changes (auth.service)
- `resetPassword(email)` → `/reset-request` [repoint].
- **`confirmPasswordReset(token, newPassword)`** → `/reset` [**NEW** — the reset-landing's token path].
- `updatePasswordWithOld(cur, new)` → `/change` [repoint].
- **`updatePassword(pw)` (no-old, the 6-char guard) → DELETE** — after F6 its only callers are the
  reset-landing (→ `confirmPasswordReset`) and MyAccount (→ §3). Removing it drops the **6-char service
  guard** (the §3 carry-forward) for free.

---

## §2 — The cross-package reset `redirectTo` (F3 pattern)

`password.ts`'s `requestPasswordReset` is called with **no `redirectTo`** → better-auth's reset link's
redirect target is empty (the FE landing is never reached with a token). **F6 adds** `redirectTo:
${env.WEB_ORIGIN}/update-password` to the `requestPasswordReset` body (absolute → passes better-auth's
`originCheck`; WEB_ORIGIN trusted — the K config, the F3 callbackURL pattern). **apps/api change + a
test** (assert the reset email carries `redirectTo`/`callbackURL=/update-password`, via the
`sendResetPassword` spy — like F3's Q8). **So F6 is cross-package** (like F3).

---

## §3 — THE FINDING: MyAccount (a separate owner page F4 missed) + the no-old wrinkle

`MyAccount.tsx` (`/my-account`, owner) is a **second** owner edit page (Commit 5c2), distinct from
`OwnerSettings`. Two of its saves are problems:
- **No-old password change** (`:178` → `updatePassword(formData.password)`): a logged-in change with a
  "leave blank to keep" field and **NO current-password**. Maps to **neither** `/change` (requires
  `current_password`) **nor** `/reset` (requires a token). The backend correctly **requires re-auth**
  for a logged-in change (Phase-1d D4) — a no-old change is a security regression the backend won't
  support. **Lean (D-F6-5a): drop/disable the MyAccount password field** (the owner changes password
  via OwnerSettings → Confidentialité, which has the with-old `/change`). Removing it + the reset-landing
  repoint leaves `updatePassword` unused → DELETE it (§1).
- **Profile save** (`:173` → `updateBusinessProfile(updateData)`, one all-fields blob): **dead-Supabase**
  — **F4 only repointed `OwnerSettings`, not `MyAccount`.** This is an **F4 LEFTOVER**, not a password
  concern. It doesn't map to the 4 section methods cleanly (it's a single save-all, not section-scoped).
  **Lean (D-F6-5b): OUT of F6** — surface as a tracked leftover (F7 cleanup / a MyAccount follow-up /
  consolidate MyAccount into OwnerSettings). (MyAccount's **document** upload already works — F5's
  shared hook mutation covers it.)

**Surface both** — D-F6-5 is the load-bearing F6 decision (the no-old drop) + the F4-leftover flag.

---

## §4 — The 12-char convergence (reuse utils/password.ts)

Reuse `isValidPassword`/`passwordChecks` (F2, `PASSWORD_MIN_LENGTH=12`). Current floors to converge:
- **Reset-landing** (`UpdatePasswordForm:17`): `length >= 8` → `isValidPassword` (12).
- **Change** (`UserProfile:282` `length >= 8` + `passwordValid`; `OwnerSettings` `passwordValid`):
  → `isValidPassword` (12).
- **6-char service guard** (`auth.service.updatePassword:266` `< 6`): **dropped** by deleting
  `updatePassword` (§1).
- **Owner special-char rule:** the carry-forward (contract §5.4) named it; **confirm at plan-write** in
  the OwnerSettings `passwordValid` definition and **drop it** (converge to the util's 12+upper+lower+
  digit — the backend's rule, no special-char; the reason `utils/password.ts` was extracted).

---

## §5 — The RTL decision (the last plausible standup)

The reset-landing has the most page-logic (token-from-URL + `?error=` branch + submit). But the
**load-bearing logic is still service-layer/util:** the reset call (`confirmPasswordReset` →
`/reset`) is a service method (node-testable); the password rule is the util (node-tested); the
page-specific part is **thin orchestration** (`useSearchParams().get('token')` → pass to the call;
branch on `?error=`).

**Proposed (D-F6-6): NODE-ONLY** (test the 3 methods + the util reuse), **RTL still not stood up.**
The page's token-wiring (the one thing node tests miss) is covered by the **phase-close running-both
round-trip** (request→email→landing→reset→signin) — the real end-to-end check. RTL infra for one page's
thin orchestration isn't justified when the round-trip verifies the wiring. *This declines the last
plausible 1f RTL standup — confirming RTL doesn't earn it in 1f (the service-layer pattern held all 6
repoints).* (Alt: stand up RTL for the reset-landing — render `?token=`, fill, submit, assert
`confirmPasswordReset`. The marginal coverage = the token-wiring, which the round-trip also catches.)

---

## §6 — End-to-end testability + the running-both round-trip

F6 has all the pieces → the **phase-close running-both round-trip** (the survey §6 level-3) becomes
exercisable: request → real reset email → click → `/update-password?token=` → reset → `/login` → signin.
**Proposed (D-F6-9):** node tests per method (request/reset/change + util) per-commit; the full loop is
the **phase-close human QA / running-both round-trip** (not a per-commit gate — it needs real SMTP +
both apps). F6 is the commit that makes it possible.

---

## §7 — The styling flag (F3 deferred it to F6)

`UpdatePasswordForm` is styled for a **dark** background (`text-white`, `bg-white/10`) but wrapped in
the **light** `AuthLayout` — a latent inconsistency. F6 rewrites this form anyway (token + 12-char +
`/reset`), so **restyle it to light** (match `ResetPasswordForm`/`LoginForm`: `text-gray-*`, white
inputs, the brand CTA). frontend-design lightly activates (match the existing light auth forms — no new
design). **Lean (D-F6-7): fix it** (part of the rewrite); a light visual glance at phase close.

---

## §8 — Sub-factoring

**Lean (D-F6-8): ONE commit** — D-F3-3 ruled the password domain end-to-end testable as one (the
request→reset-landing loop is cohesive; the change shares the util + the methods). It IS large (3 flows,
3–4 forms, cross-package, the MyAccount drop, the styling, the deletions). **Alt split:** F6a
(request + reset-landing + `redirectTo` — the reset loop) / F6b (change + MyAccount-drop + styling).
*Lean one (cohesion); flag the size — the architect may split.*

---

## §9 — Decisions for ruling (CF-22)

- **D-F6-1** request → `/reset-request` (anti-enum already correct, no oracle). *Confirm.*
- **D-F6-2** reset-landing → read `?token=`/`?error=` → `confirmPasswordReset(token,new)` → `/reset`;
  12-char util; restyle light. *Confirm.*
- **D-F6-3** change → `/change`; stays-logged-in (refreshed cookie, no FE change); 12-char; drop the
  6-char guard (delete `updatePassword`) + the owner special-char. *Confirm.*
- **D-F6-4** cross-package reset `redirectTo = {WEB_ORIGIN}/update-password` (password.ts + test). *Confirm.*
- **D-F6-5 (load-bearing) — MyAccount:** (a) **drop/disable the no-old password field** (no endpoint;
  security: backend requires current); (b) MyAccount's dead profile save (`updateBusinessProfile`) is an
  **F4 leftover** → OUT of F6, tracked (F7/follow-up/consolidate). *Lean: a) drop/disable; b) surface.*
- **D-F6-6 — RTL: NODE-ONLY** (decline the last standup; the round-trip covers the wiring). *Lean.*
- **D-F6-7 — styling:** fix UpdatePasswordForm dark→light (part of the rewrite). *Lean fix.*
- **D-F6-8 — one commit** (cohesion) vs split F6a/F6b. *Lean one; flag size.*
- **D-F6-9 — end-to-end:** node per method; the full loop = phase-close round-trip. *Confirm.*

---

## Document status

**Read-only scoping — HELD.** The 3 flows map to the 3 endpoints (request/reset-landing/change); the
reset-landing adds token-from-URL (the F3-style redirect) + the cross-package `redirectTo` (§2);
12-char via the F2 util, dropping the 6-char guard (delete `updatePassword`) + the owner special-char
(§4); **MyAccount finding** — no-old password drop + the F4-leftover profile save (§3); node-only RTL
declined at the last point (§5); restyle the reset form (§7); one commit (§8). Nine decisions (§9).
Nothing resolved — the F6 plan is drafted only after §9 is ruled.
