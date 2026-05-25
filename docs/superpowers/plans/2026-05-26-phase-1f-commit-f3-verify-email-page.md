# Phase 1f — Commit F3: verify-email page (cross-package)

**Status:** RATIFIED (D-F3-1…7 + the B′ error-recovery ruling 2026-05-26) — executing.
**Design authority:** `phase-1f-f3-verify-reset-scoping.md` (§6 rulings D-F3-1…7, all ratified —
**Option A: verify-only**).
**Region:** **apps/api + apps/web** (the first cross-package per-flow commit).
**HEAD at draft:** `ee67d7d` (K+F1+F2 shipped).

The deferred Phase-1b verify `callbackURL`: wire it (apps/api) so the post-verify redirect lands on a
**net-new `/verify-email` result page** (apps/web). One small commit. **Reset is NOT here** (→ F6, the
whole password domain). **No jsdom+RTL** (→ F4/F6).

---

## §0 — Pre-flight verification (CF-10)

- `git status` clean; HEAD `ee67d7d`.
- Floor: **apps/web typecheck 44 · lint 1 · test 196 (27 files) · build 137.07 kB gzip**;
  **apps/api typecheck 0 · lint 0 · test 146**. Re-run all; record actuals.
- Node 20 PATH. apps/api tests need the full env block + Postgres ([[local-migrate-needs-full-env-block]]).

---

## §1 — Locked constraints (rulings)

- **D-F3-1/7** verify page NET-NEW at **`/verify-email`** (NON-`/auth` — the Vite proxy owns `/auth/*`;
  `/auth/verify-email` is better-auth's handler). Reads `?error=`; **no API call** (better-auth
  verified server-side). Thin `AuthLayout` result page.
- **D-F3-2** cross-package: apps/api passes the **absolute** `callbackURL = {WEB_ORIGIN}/verify-email`
  to `signUpEmail` (passes better-auth `originCheck` — WEB_ORIGIN is trusted). Without it, verify
  redirects to the default `/` and the page is never reached.
- **D-F3-3** Option A — **verify only**. Reset (request + landing + change) is **F6**.
- **D-F3-5** frontend-design minimal — reuse `AuthLayout` + the brand token; **use `bg-brand-primary`**
  (= `#76E6AB`, tailwind.config.js), NOT the inline `style={{background:'#76E6AB'}}` the legacy auth
  forms use (a pre-existing violation in 13 files — NOT F3's fix).
- **D-F3-6** NO jsdom+RTL. F3's only new test = the apps/api assertion that the verify email carries
  the `callbackURL`. The FE page → phase-close human QA.

---

## §2 — Inventory (CF-23 from source) + files

### §2.A — How the link reaches the page (the mechanism, §0 of scoping)
`signUpEmail({ body: { …, callbackURL } })` → better-auth builds the email link
`{baseURL}/auth/verify-email?token={JWT}&callbackURL={callbackURL}` (`sign-up.mjs:241`). Click → the
better-auth verify GET handler verifies the JWT, sets `emailVerified=true` (no auto-signin), then
`ctx.redirect(callbackURL)` on success / `callbackURL?error=<CODE>` on failure
(`email-verification.mjs:259/152`). So `/verify-email` is the **redirect target** — it reads `?error=`.

### §2.B — Files

| File | Action |
|---|---|
| `apps/api/src/auth/auth.ts` | **B′** — add `sendOnSignIn: true` to `emailVerification` (enables the existing resend on unverified signin → the verify-page error-recovery loop) |
| `apps/api/src/routes/signup.ts` | add `import { env }`; pass `callbackURL: ${env.WEB_ORIGIN}/verify-email` to `signUpEmail` body |
| `apps/api/tests/signup.test.ts` | extend the Q8 test — assert the verify email URL carries the `callbackURL` |
| `apps/web/src/features/auth/pages/VerifyEmail.tsx` | **NEW** — `AuthLayout` result page, reads `?error=` (success + B′ recovery copy) |
| `apps/web/src/App.tsx` | `lazy(VerifyEmail)` + a standalone `<Route path="/verify-email">` |

**B′ ruling (the error-recovery loop).** `sign-in.mjs:229–241`: unverified signin resends the
verification email ONLY if `emailVerification.sendOnSignIn` is set — our config had only
`sendOnSignUp` → **no resend** (correcting the Phase-1d recollection). B′ enables `sendOnSignIn: true`
so the verify-page error CTA ("Connectez-vous pour recevoir un nouveau lien") drives a real loop:
expired link → signin → 403 **+ fresh email** → click → verified. Trade accepted: every unverified
signin resends (rate-limited, only to the account's own address). **AUDIT NOTE (record at F8):
unverified-signin-resend is NOW true (F3 enabled `sendOnSignIn`), vs Phase-1d's 403-without-resend.**

### §2.C — Route guard choice
Standalone route (no `PublicRoute` wrapper), like `/admin-login`. The just-verified user is NOT
logged in (no auto-signin), so the result must always render regardless of auth state — a guard would
add an `initialize()` round-trip + a redirect-if-logged-in. *Lean: standalone.*

---

## §3 — Commit factoring

**Single commit (F3.1)**, cross-package. The backend `callbackURL` and the FE page are one coherent
"verify lands somewhere real" change — the page is unreachable without the callbackURL, the callbackURL
points at nothing without the page. Atomic.

---

## §4 — Per-commit verification gates

- **apps/api:** typecheck **0** · lint **0** · test **146** (the Q8 extension adds assertions, not a
  new `it` → count flat) · build success.
- **apps/web:** typecheck **44** (the new page adds no errors) · lint **1** · test **196** (no new web
  test, D-F3-6) · build **≤ 137.07 kB** gzip main + a tiny lazy `VerifyEmail` chunk (main ~flat).
- The apps/api Q8 assertion proves the `callbackURL` is in the verify link (the cross-package contract).

---

## §5 — Standing operating procedure

Node-20 PATH. Conventional Commits, no `Co-Authored-By`. CF-7 gate-sweep across **both** packages.
Husky lint-staged. (No `apiClient` mock here — the FE page calls no API.)

---

## §6 — Hard-halt conditions

- The FE page proves to need an API call (it shouldn't — better-auth verifies server-side) → halt +
  re-scope.
- Any gate regresses in either package → revert, surface.
- `signUpEmail` rejects the `callbackURL` body field (it shouldn't — `sign-up.mjs:18,241` accept it) →
  surface.

---

## §7 — Risk register

- **Proxy conflict:** the FE route is `/verify-email` (NOT `/auth/verify-email`) — confirmed clear of
  the `/api` + `/auth` proxy prefixes (vite.config.ts). A `/auth/*` FE route would be unreachable.
- **Absolute callbackURL + originCheck:** `{WEB_ORIGIN}/verify-email` is absolute; better-auth's
  `originCheck(callbackURL)` requires its origin ∈ trustedOrigins (= WEB_ORIGIN ✓, K's config). A
  relative `/verify-email` would resolve against `BETTER_AUTH_URL` (dev :4000 → 404), so **absolute**
  is required.
- **Dev vs prod link origin:** dev `BETTER_AUTH_URL=:4000` → the email link hits :4000 directly,
  verifies, then top-level-redirects to `{WEB_ORIGIN}=:5173/verify-email` (React). Prod: single nginx
  origin. Both work with the absolute callbackURL.
- **No auto-signin:** config has no `autoSignInAfterVerification` → the user lands logged-out → "please
  sign in" is correct (matches D-F2-7).

---

## §8 — Cross-references

- Scoping: `phase-1f-f3-verify-reset-scoping.md` (§0 mechanism, §6 rulings). Contract §3.7 (corrected
  by D-F3-7). Backend: `auth/auth.ts` (emailVerification), `routes/signup.ts`. better-auth:
  `dist/api/routes/{sign-up,email-verification}.mjs`.
- F6 carry-forward: the **whole password domain** (request + reset-landing repoint of `/update-password`
  + change), end-to-end testable; the `UpdatePasswordForm` dark-bg-in-light-AuthLayout flag is F6's;
  jsdom+RTL stands up at F4 or F6.

---

## §9 — Carry-forward methodology

- **CF-23** the verify-link mechanism read from installed better-auth (the `/auth/*` handler +
  callbackURL redirect + the proxy conflict) — corrected the contract's "FE `/auth/verify-email`".
- **CF-24** truthful-to-frontend: the page does exactly what better-auth's redirect provides
  (`?error=`), no speculative API.
- **First cross-package per-flow commit** — gates span both packages; note at the F3.1 CF-9.
- **Pre-existing-violation flag:** the inline `#76E6AB` CTA (13 files) is a brand-token violation; F3
  uses the token in net-new code, does not fix the legacy sites (a separate styling-pass concern).

---

## §10 — Push policy + sequencing

F3.0 plan → push (CF-6). F3.1 code → CF-7 gate-sweep (both packages) → CF-9 pause → push on approval →
CI headSha verify. **No visual-QA pause gating the push** (the page is two static states; human QA is
the phase-close gate) — though the human may glance. No deps/env changes (WEB_ORIGIN already exists).

---

## §11 — Exact changes (F3.1)

### §11.0 — `apps/api/src/auth/auth.ts` (B′)
In the `emailVerification` block, add `sendOnSignIn: true`:

```ts
emailVerification: {
  sendOnSignUp: true,
  // B′ (Phase-1f F3): resend the verification email on an unverified signin so the verify-page
  // error CTA ("Connectez-vous pour recevoir un nouveau lien") is a real recovery loop. Rate-limited
  // by better-auth; only ever sent to the account's own address.
  sendOnSignIn: true,
  sendVerificationEmail,
},
```

### §11.1 — `apps/api/src/routes/signup.ts`
Add `import { env } from '../env.js';` (with the other imports). In the `signUpEmail` call, add the
`callbackURL` to the body:

```ts
const result = await auth.api.signUpEmail({
  body: {
    email,
    password,
    name: contact_name,
    businessName: business_name,
    contactPhone: contact_phone,
    ...(tax_number ? { taxNumber: tax_number } : {}),
    callbackURL: `${env.WEB_ORIGIN}/verify-email`, // post-verify redirect target (Phase-1f F3)
  },
});
```

### §11.2 — `apps/api/tests/signup.test.ts` (extend Q8)
The Q8 test already spies `emailSender.send` and reads `arg?.html`. Add (importing `env`):

```ts
// the post-verify redirect target rides the link (Phase-1f F3)
expect(arg?.html).toContain(`callbackURL=${encodeURIComponent(`${env.WEB_ORIGIN}/verify-email`)}`);
```

### §11.3 — `apps/web/src/features/auth/pages/VerifyEmail.tsx` (NEW)

```tsx
import { CheckCircle2, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import AuthLayout from '@/features/auth/components/AuthLayout';

// Phase-1f F3 — the verify-email redirect target (better-auth verifies server-side, then redirects
// here with ?error= on failure / no param on success). No API call; a result-display page.
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const isError = params.get('error') !== null;
  return (
    <AuthLayout
      title={isError ? 'Lien invalide' : 'Email vérifié'}
      subtitle={
        isError
          ? 'Ce lien de vérification est invalide ou a expiré.'
          : 'Votre adresse email a été confirmée.'
      }
    >
      <div className="space-y-5 text-center">
        {isError ? (
          <XCircle className="mx-auto h-14 w-14 text-red-500" />
        ) : (
          <CheckCircle2 className="mx-auto h-14 w-14 text-brand-primary" />
        )}
        <p className="text-sm text-gray-600">
          {isError
            ? 'Connectez-vous pour recevoir un nouveau lien de vérification.'
            : 'Vous pouvez maintenant vous connecter à votre compte.'}
        </p>
        <Link
          to="/login"
          className="block w-full py-3.5 rounded-xl font-semibold text-base text-brand-deep text-center bg-brand-primary hover:opacity-90 transition-opacity"
        >
          {isError ? 'Aller à la connexion' : 'Se connecter'}
        </Link>
      </div>
    </AuthLayout>
  );
}
```

(CTA uses `bg-brand-primary` + `text-brand-deep` — the tokens, visually identical to the legacy inline
`#76E6AB` CTAs but CLAUDE.md-compliant in net-new code.)

### §11.4 — `apps/web/src/App.tsx`
Add the lazy import (with the other auth pages) and a standalone route (near `/admin-login`):

```tsx
const VerifyEmail = lazy(() => import('@/features/auth/pages/VerifyEmail'));
// ...
<Route path="/verify-email" element={<VerifyEmail />} />
```

---

## §12 — Fire instruction

After ratification: execute §11, gate-sweep both packages (§4), CF-9 pause, push on approval → CI
verify. Then F4 (profile edits) is drafted — likely where jsdom+RTL stands up.
