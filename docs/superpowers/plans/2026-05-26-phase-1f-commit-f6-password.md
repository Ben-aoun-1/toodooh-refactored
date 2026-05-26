# Phase 1f — Commit F6: the password domain (request + reset-landing + change)

**Status:** DRAFT (F6.0) — held for review. D-F6-1…9 ruled; the plan folds them.
**Design authority:** `phase-1f-f6-password-scoping.md` (§9 rulings).
**Region:** **apps/api + apps/web** (cross-package — the reset `redirectTo`, like F3).
**HEAD at draft:** `c3dfe6d` (F5 shipped). **The LAST per-flow commit.**

The whole password domain, end-to-end testable as one (D-F3-3): forgot-password request +
reset-landing (token) + change (with-old). Reuses `utils/password.ts` (12). Node-only (RTL declined
at its last plausible point). One commit (lean — confirmed manageable size).

---

## §0 — Pre-flight (CF-10)

- `git status` clean; HEAD `c3dfe6d`.
- Floor: **apps/web typecheck 36 · lint 1 · test 211 (28 files) · build 137.73 kB gzip**; apps/api 146.
  Re-run; record.
- Node 20 PATH. apps/api tests need Postgres + the full env block.

---

## §1 — Locked constraints (rulings)

- **D-F6-1** request → `resetPassword(email)` → `POST /password/reset-request` (anti-enum already
  correct — generic toast, no oracle; no form change).
- **D-F6-2** reset-landing → `UpdatePasswordForm` reads `?token=`/`?error=` → `confirmPasswordReset(
  token, new_password)` → `POST /password/reset` (NEW method); 12-char util; restyle light.
- **D-F6-3** change → `updatePasswordWithOld(cur,new)` → `POST /password/change`; **stays logged in**
  (the refreshed cookie rides the response — D4; no FE bounce); 12-char; **delete `updatePassword`**
  (drops the 6-char guard).
- **D-F6-4** cross-package: `redirectTo: ${env.WEB_ORIGIN}/update-password` on `requestPasswordReset`
  (password.ts) + a test (F3 pattern; absolute → passes `originCheck`).
- **D-F6-5a** MyAccount no-old password field → **DROP** (no endpoint; backend requires current —
  correct re-auth; the owner's path is OwnerSettings' with-old `/change`). **D-F6-5b** MyAccount's
  dead profile-save (`updateBusinessProfile`) → **OUT, tracked → F7** (repoint-or-consolidate).
- **D-F6-6** RTL → **NODE-ONLY** (decline the last standup; thin-adapter kept the logic service-layer
  across all 7 repoints — RTL never needed in 1f; the token-wiring → phase-close round-trip). F8
  records "jsdom+RTL provisioned-but-never-needed."
- **D-F6-7** restyle `UpdatePasswordForm` dark→light (part of the rewrite).
- **D-F6-8** ONE commit (lean — §8 size check).
- **D-F6-9** node tests per method; the full loop = phase-close running-both round-trip.

---

## §2 — Inventory (CF-23 from source) + files

### §2.A — Method changes (`auth.service.ts`)
| Method | Now | F6 |
|---|---|---|
| `resetPassword(email)` | `supabase.resetPasswordForEmail` | `POST /password/reset-request {email}` |
| `confirmPasswordReset(token, newPassword)` | — | **NEW** → `POST /password/reset {token, new_password}` |
| `updatePasswordWithOld(cur, new)` | supabase re-auth + updateUser | `POST /password/change {current_password, new_password}` |
| `updatePassword(pw)` (6-char guard) | supabase.updateUser | **DELETE** (callers → reset-landing/MyAccount, both gone) |

**Import cleanup (CF-23):** after the above, **`getAppUrl`** (only `resetPassword` used it) +
**`isErrorWithCode`** (only `updatePassword` used it) become unused → remove. `mapAuthError`/`supabase`
stay (the deferred reference reads + `updateBusinessProfile`/`deactivateAccount`).

### §2.B — CF-23 correction: the "owner special-char rule" does NOT exist
The carry-forward (contract §5.4) named an owner-settings special-char rule to drop. **Current source
has none** — both `UserProfile` (`:279`) and `OwnerSettings` (`:349`) check only `uppercase + digit +
minLength>=8` (no lowercase, no special-char). So **nothing to drop there**; the convergence to
`isValidPassword` is **8→12 + ADDS a lowercase requirement** (the util's rule = the backend's:
12+upper+lower+digit). The 6-char guard (drop via deleting `updatePassword`) is the only real guard
removal.

### §2.C — Files
| File | Action |
|---|---|
| `apps/api/src/routes/password.ts` | add `import { env }` + `redirectTo: ${env.WEB_ORIGIN}/update-password` on `requestPasswordReset` |
| `apps/api/tests/password.test.ts` | assert the reset email carries the `redirectTo`/`callbackURL=/update-password` |
| `features/auth/services/auth.service.ts` | repoint `resetPassword`/`updatePasswordWithOld`; add `confirmPasswordReset`; delete `updatePassword`; drop `getAppUrl`/`isErrorWithCode` imports |
| `features/auth/components/UpdatePasswordForm.tsx` | rewrite: `?token=`/`?error=` → `confirmPasswordReset`; 12-char util; light styling |
| `features/advertiser/pages/UserProfile.tsx` | change validation → `passwordChecks`/`isValidPassword` (12 + lowercase); checklist labels |
| `features/screenhost/pages/OwnerSettings.tsx` | same convergence |
| `features/screenhost/pages/MyAccount.tsx` | **drop** the no-old password field + its submit block + state |
| `features/auth/hooks/useOwnerProfileMutations.ts` | remove the `updatePassword` mutation (MyAccount's only use) |
| `features/auth/services/auth.service.password.test.ts` | **NEW** — node tests (3 methods) |

(`ResetPasswordForm` unchanged — `resetPassword` repoints internally; the generic UX is already right.)

---

## §3 — Commit factoring

**ONE commit (F6).** The password domain is cohesive (D-F3-3 end-to-end). Size is moderate (the
`UpdatePasswordForm` rewrite + two checklist convergences + the MyAccount drop + 3 method changes + the
deletions) — no single huge file. **Fallback split** (only if the diff proves unwieldy at execution):
F6a (request + reset-landing + `redirectTo` — the reset loop, the `delete updatePassword` deferred to
F6b since MyAccount still uses it) / F6b (change + MyAccount-drop + delete `updatePassword`). *Lean
one; will re-confirm at gate-sweep.*

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor **≤ 36** (the deletions + repoints may shed supabase-typed errors →
  possible ratchet-down; likely small drop).
- `pnpm lint` — green; **1**.
- `pnpm test` — green: **apps/web 211 + N** (the password method tests ~5–6); **apps/api 146** (the
  password.test redirectTo assertion extends an existing `it`, count flat).
- `pnpm build` — green; **~137.73 kB** ± (the rewrite + deletions ~offset; ~flat).

---

## §5 — SOP / §6 — Hard-halt / §7 — Risks

- SOP: Node-20 PATH; Conventional Commits no-trailer; CF-7 sweep (both packages); husky; clean
  `apiClient` mocks (F1).
- Hard-halt: dropping the special-char rule weakens something unexpectedly — **NOT applicable** (it
  doesn't exist, §2.B); if a special-char rule IS found at execution → surface. MyAccount drop breaks
  its submit handler (the password block is inline) → handle cleanly. Any gate regresses → revert.
- Risks: (a) the reset-landing's `?error=` branch (invalid/expired link) must render an error, not a
  blank form — handle both `?token=` and `?error=`. (b) the change's stay-logged-in (refreshed cookie)
  — the forms already clear-fields + toast, no bounce; confirm no `logout()`/redirect was added. (c)
  MyAccount's profile-save stays dead (F4 leftover, tracked) — F6 only removes its password field.

---

## §8 — Cross-references

- Scoping: `phase-1f-f6-password-scoping.md`. Backend: `routes/password.ts`, `auth/auth.ts`,
  better-auth `password.mjs`. K: `apiErrorMessage`. F2: `utils/password.ts`. F3: the redirectTo/
  callbackURL pattern + `sendResetPassword` test.
- **Tracked → F7/later:** MyAccount profile-save (repoint-or-consolidate); document DELETE endpoint;
  logo storage; owner-extras persistence; inline-`#76E6AB` styling; owner deactivate endpoint.
- **F8 records:** jsdom+RTL provisioned-but-never-needed (thin-adapter kept logic service-layer across
  all 7 repoints).

---

## §9 — Carry-forward methodology

- **CF-23** the special-char rule is stale (not in source) — read, don't trust the carry-forward; the
  MyAccount no-old + F4-leftover found by source.
- **CF-24** truthful: the no-old MyAccount change is dropped (the backend correctly requires re-auth);
  the convergence adds lowercase (matches the backend) — honest strengthening.
- **The thin-adapter → node-only arc closes:** F6 (the best RTL candidate) confirms RTL isn't needed.

---

## §10 — Push policy

F6.0 plan → push (CF-6). F6.1 code → CF-7 sweep (both packages) → CF-9 pause → push on approval → CI
verify. A **light human glance** at the reset/change forms (light styling) is reasonable; the full
loop is the phase-close running-both round-trip. No deps.

---

## §11 — Exact changes (F6.1)

### §11.1 — `apps/api/src/routes/password.ts`
Add `import { env } from '../env.js';`. In the reset-request handler:
```ts
await auth.api.requestPasswordReset({
  body: { email: parsed.data.email, redirectTo: `${env.WEB_ORIGIN}/update-password` },
  headers: fromNodeHeaders(request.headers),
});
```

### §11.2 — `apps/api/tests/password.test.ts`
Extend the reset-request test (spy `emailSender.send`): assert the reset email's URL carries
`callbackURL=${encodeURIComponent(`${env.WEB_ORIGIN}/update-password`)}` (better-auth builds
`/auth/reset-password/{token}?callbackURL={redirectTo}`). Import `env`.

### §11.3 — `auth.service.ts`
```ts
async resetPassword(email: string): Promise<void> {
  try { await apiClient.post('/password/reset-request', { email }); }
  catch (error) { throw new Error(apiErrorMessage(error)); }
},
// Phase-1f F6 — the reset-landing's token path (the better-auth reset redirect lands on
// /update-password?token=). Distinct from the with-old change (/change).
async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  try { await apiClient.post('/password/reset', { token, new_password: newPassword }); }
  catch (error) { throw new Error(apiErrorMessage(error)); }
},
async updatePasswordWithOld(currentPassword: string, newPassword: string): Promise<void> {
  try {
    await apiClient.post('/password/change', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  } catch (error) { throw new Error(apiErrorMessage(error)); }
},
```
Delete `updatePassword`. Remove the `getAppUrl` + `isErrorWithCode` imports.

### §11.4 — `UpdatePasswordForm.tsx` (rewrite)
- `import { useSearchParams } from 'react-router-dom'`; `import { isValidPassword, passwordChecks } from '@/features/auth/utils/password'`.
- `const [params] = useSearchParams(); const token = params.get('token'); const linkError = params.get('error');`
- If `linkError` (and no token) → render "Lien invalide ou expiré" + a `/reset-password` link (request a new one). Else render the password form.
- Validate with `isValidPassword` (12); the checklist via `passwordChecks` (minLen/upper/lower/digit; label "12 caractères").
- Submit: `if (!token) { toast.error('Lien invalide'); return; }` then `await authService.confirmPasswordReset(token, password)` → toast success → `navigate('/login')`.
- **Restyle to light** (match `ResetPasswordForm`/`LoginForm`: `text-gray-*`, white inputs, the brand CTA `bg-brand-primary text-brand-deep`) — replace the `text-white`/`bg-white/10` dark classes.

### §11.5 — `UserProfile.tsx` + `OwnerSettings.tsx` (change convergence)
- Replace the local `passwordRequirements` (`uppercase/digit/minLength>=8`) with `passwordChecks(passwordData.newPassword)` (→ `minLen/upper/lower/digit`); gate on `isValidPassword(passwordData.newPassword)`.
- Render a **4-item** checklist (add the **lowercase** row; bump the length label to **12**).
- The handler call (`updatePasswordWithOld`) is unchanged (the method repoints). Stays logged in (no bounce — confirm no redirect added).

### §11.6 — `MyAccount.tsx` (drop the no-old password field)
- Remove the `if (formData.password) { …updatePassword… }` block from the submit handler, the
  password + confirmPassword fields (JSX), and the related `formData.password`/`confirmPassword` state
  + the `:150` mismatch check. (Optional: a small note "Modifiez votre mot de passe dans Paramètres.")
  MyAccount's profile-save (`updateBusinessProfile`) is **left as-is** (F4 leftover, tracked → F7).

### §11.7 — `useOwnerProfileMutations.ts`
Remove the `updatePassword` mutation (MyAccount's only consumer; gone). Keep `updatePasswordWithOld`.

### §11.8 — `auth.service.password.test.ts` (NEW, node-level)
Clean `apiClient` mock + supabase stub. Assert: `resetPassword('a@b.c')` → `post('/password/reset-request', {email})`; `confirmPasswordReset('tok','Abcdefgh1234')` → `post('/password/reset', {token, new_password})`; `updatePasswordWithOld('cur','new')` → `post('/password/change', {current_password, new_password})`; each → throws French on `ApiError`.

---

## §12 — Fire instruction

After ratification: execute §11, gate-sweep both packages (§4), CF-9 pause, push on approval → CI
verify. F6 closes the per-flow repoints; **F7 (the account-layer Supabase cleanup sweep)** is next,
then **F8 (audit refresh)** + the phase-close human visual QA / running-both round-trip.
