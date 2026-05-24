# Phase 1d Commit 1 — POST /api/signin (custom wrapped, shaped routing response) + sign-out + the real-cookie round-trip

The session-CREATION side that pairs with the session-VALIDATION side already shipped (the Commit-3
`requireAuth` guard). Custom-wraps `auth.api.signInEmail` server-side (same shape as the signup wrap),
shapes the FE's post-login routing response, keeps credentials errors generic, and forwards the real
session cookie. Folds in `POST /api/signout`. Closes the boundary Commit 3 left open: the
**real-cookie round-trip** (sign in → real Set-Cookie → authenticated endpoint → 200), which Commit 3
could only test with a mocked session because no sign-in existed to mint a cookie.

Short phase — better-auth owns the session machinery (sessions table + cookie handling, shipped
Commit 2). We wrap and shape; we don't build session infra.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `fc2bd4d` (Phase-1c audit refresh). CI-green. Floor:
apps/api **99** / root **259**; root typecheck 51 / lint 1 / build 139.80; apps/api typecheck 0 /
lint 0 / build ok.

**CF-18 sweep.** No `routes/signin.ts`, no `/api/signin`/`/api/signout`. The `requireAuth` guard
(Commit 3) + `auth` instance (Commit 2) + `users` table exist. The raw `/auth/sign-in/email` is
**reachable** through the catch-all (`plugin.ts` only 404s `/auth/sign-up/email`) — no plugin change.

**Node 20 PATH prefix** on every gate + git command; heap bump on commit. The apps/api suite is
**serialized** (`fileParallelism:false`); the new users-writing `signin.test.ts` inherits it. Running
locally needs the full env block ([[local-migrate-needs-full-env-block]]).

---

## §1 — Locked constraints (architect)

1. **Custom wrapped `POST /api/signin`** wrapping `auth.api.signInEmail` — shapes the routing
   response, keeps errors generic, forwards the cookie. The raw `/auth/sign-in/email` **stays
   reachable** (better-auth internals; no validation-bypass concern unlike sign-up).
2. **Response shape** carries the FE routing fields (contract §3.2/§6): `{ user: { id, email, role,
   status, onboarding_completed, business_type, profile_type, contact_name } }`. `profile_type` is
   **reconstructed** from `role`+`business_type` (inverse of signup; §2.3).
3. **Generic credentials errors** (no enumeration): wrong email and wrong password are identical;
   unverified email is a distinct path (better-auth re-sends verification).
4. **`POST /api/signout`** folded in (M5) — `requireAuth`-guarded, wraps `auth.api.signOut`, clears
   the cookie.
5. **Refresh deferred** — the FE calls no session-refresh endpoint (D5 verified §2.5); better-auth
   manages session lifetime via the cookie + sessions table.
6. **Both endpoints own-session only** — `request.user.id` / the cookie's session; no userId in any
   request.
7. **THE round-trip** — sign in → real Set-Cookie → `PATCH /api/profile/business` with that cookie →
   200, `request.user` populated, via the **real** `getSession` (no mock). Closes the Commit-3
   boundary.

**Out of scope:** session refresh (§2.5); password reset/update (own flow — Phase 1e); admin-login
specifics (Phase 1f — normal login + a role check); frontend (Phase 1e repoint); "remember me" (FE
local-only, not sent); sign-in rate limiting (revisit later).

---

## §2 — Inventory & CF-23 verification (verified against installed better-auth 1.6.11 + FE source)

### §2.1 — THE LOAD-BEARING ONE: `signInEmail` + the cookie mechanism ✅
`auth.api.signInEmail` (`dist/api/routes/sign-in.mjs`): on success it calls `setSessionCookie(ctx,…)`
(`:248`) and returns `ctx.json({ redirect, token, url, user: parseUserOutput(...) })` (`:253`). When
called **directly via `auth.api`**, the cookie is retrieved via the better-call option
**`returnHeaders: true`** → returns `{ headers: Headers, response: <json> }` (`better-call/dist/
endpoint.mjs:43`, `to-auth-endpoints.mjs:90-92`). So:
```ts
const { headers, response } = await auth.api.signInEmail({
  body: { email, password }, headers: fromNodeHeaders(request.headers), returnHeaders: true,
});
// forward headers.getSetCookie() → reply; shape from response.user.id
```
`headers.getSetCookie()` returns the `Set-Cookie` array (one session cookie, +`dont_remember` only
when `rememberMe:false` — we don't send it). Forward each onto the Fastify reply. **The round-trip's
crux is verified: the cookie lands on the reply via the returned `headers`.** (`asResponse:true` is
the alternative but yields a Response we'd have to re-parse + couldn't reshape — `returnHeaders` is
the right tool: cookie AND structured data.)

### §2.2 — generic errors + unverified behavior (CF-23) ✅
`signInEmail` throws `APIError("UNAUTHORIZED", INVALID_EMAIL_OR_PASSWORD)` (**401**) for unknown
email, no-credential account, AND wrong password — **identical, no enumeration** (`sign-in.mjs:208/
214/220/227`). For an unverified user with `requireEmailVerification:true` (set Commit 2), it
**re-sends** the verification email then throws `APIError("FORBIDDEN", EMAIL_NOT_VERIFIED)` (**403**)
(`:229-241`). `APIError` carries `.statusCode` (401/403 via the status-name map,
`better-call/dist/error.mjs:99`). **Discriminator: `err.statusCode === 403` → EMAIL_NOT_VERIFIED;
else → generic 401** (`FAILED_TO_CREATE_SESSION`, a rare 401 internal, folds into generic — correct,
don't leak internals). The signup wrap already catches `err instanceof APIError` — same pattern.

### §2.3 — `profile_type` reconstruction (CF-23, contract §5.2/§7.2 + FE source) ✅
FE `profile_type` enum (`types/auth.ts:8`): `'advertiser' | 'agency' | 'individual_owner' |
'fleet_owner'`. We store `role` + `business_type`, not `profile_type`. The inverse of the signup
mapping:
```ts
role==='advertiser' && business_type==='agency' → 'agency'
role==='advertiser'                              → 'advertiser'
role==='individual_owner'                        → 'individual_owner'
role==='fleet_owner'                             → 'fleet_owner'
role==='admin' | 'superadmin'                    → null   // no FE profile_type (admin login Phase 1f)
```
FE routing (`LoginForm.tsx:28-31`): `profile_type ∈ {individual_owner, fleet_owner}` → `/owner-
dashboard`, else → `/dashboard`. The reconstruction makes all four route correctly.

### §2.4 — routing fields sourced from a DB SELECT (M2)
`response.user` (parseUserOutput) carries the better-auth additionalFields (`role`, `status`,
`businessName`, `contactPhone`, `taxNumber`) + core (`id`, `email`, `name`→contactName) — but **NOT
`businessType` or `onboardingCompleted`** (those are columns, not registered additionalFields). So
after sign-in, **`db.select` the `users` row by `response.user.id`** for the full routing set (one
query; no auth-config change; the source of truth). The profile-edit endpoints already read `users`
directly.

### §2.5 — D5 refresh: NONE in the FE ✅
`grep` across all of `apps/web/src` for `refreshSession`/`session/refresh`/`refresh-token` →
**nothing**. The FE relies on better-auth's session cookie. **Refresh is out of slice 1** (no halt).

### §2.6 — sign-out (M5) ✅
`auth.api.signOut` (`dist/api/routes/sign-out.mjs`) calls `deleteSessionCookie(ctx)` (`:26`) →
clears the cookie. Call with `returnHeaders:true`, forward the (clearing) `Set-Cookie`. Guard with
`requireAuth` (must be signed in to sign out; unauthenticated → 401 via the guard). **Recommend
folding in** — ~20 lines, pairs naturally with sign-in (session lifecycle), reuses the guard, and
enables the sign-out leg of the round-trip (sign in → authenticates → sign out → no longer
authenticates).

### §2.7 — round-trip test construction (M8) ✅
`signin.test.ts` (real Postgres + mocked nodemailer, the signup.test pattern). A
`createVerifiedUser` helper calls `auth.api.signUpEmail` (real password hashing → `accounts` row)
then `db.update(users).set({ emailVerified: true, role?, businessType? })` (sign-in is blocked while
unverified). Cookie capture/replay: `res.headers['set-cookie']` from the sign-in inject → strip each
to `name=value` (before the first `;`), join with `; ` → send as the `cookie` header on the next
inject. The round-trip uses the **real** `getSession` (no mock) — the cookie's session row (created
by sign-in) is validated against the DB by the Commit-3 guard. (The other profile suites mock
getSession; this suite does not — that is the point.)

### §2.8 — CF-21/22
- **CF-21:** no new env var (AUTH_SECRET/BETTER_AUTH_URL exist). No cascade. `.env.example`/`ci.yml`
  untouched (confirm at 1.1).
- **CF-22 watch:** M2 (DB-select for routing fields vs adding additionalFields) and M5 (sign-out
  fold-in) are the two judgment calls; both surfaced, leaning to the cleaner option.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **1.0** | Plan (this file). Halt; surface M1–M8; ratify; commit + push (CF-6). |
| **1.1** | `routes/signin.ts` (signin + signout) + `routes/index.ts` + `tests/signin.test.ts`. Halt; CF-9 (incl. live: shape/cookie, generic errors, profile_type, the round-trip, sign-out); ratify; push (CF-7). |

1.1 judgment seams: the cookie-forwarding + the APIError 401/403 branch. The rest is mechanical.

---

## §4 — Per-commit verification gates

### Gate 2 — apps/api per-package
```
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # ~110-112 (needs Postgres)
pnpm --filter @toodooh/api build       # ok
```

### Gate 3 — root no-regression vs `fc2bd4d`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 259 | **~270-272** (+~11-13) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — live (real Postgres)
- Verified user → `POST /api/signin` **200**, response shape correct (all routing fields), **Set-Cookie
  present**.
- Wrong password and unknown email → **identical generic 401** (no enumeration).
- Unverified user → **403 EMAIL_NOT_VERIFIED**.
- `profile_type` reconstruction across role types (agency / advertiser / individual_owner /
  fleet_owner).
- Empty/invalid body → **400** (zod).
- **THE round-trip:** sign in → real cookie → `PATCH /api/profile/business` with it → **200**, the
  authed user's row updated (real `getSession`).
- Sign-out: signed-in → **200** + cookie cleared; the cleared cookie no longer authenticates;
  unauthenticated sign-out → **401**.

### Gate 5 — CI green (Postgres service present; no new service).

---

## §5 — Standing operating procedure
CF-6 for 1.0; CF-7 for 1.1. Node-20 prefix; heap bump. CF-18 re-sweep before first Write.
**No new deps** (better-auth/drizzle/zod present) — verify `pnpm-lock.yaml` untouched at 1.1.

---

## §6 — Hard-halt conditions
1. `signInEmail` cookie mechanism differs from §2.1 — **RESOLVED** (`returnHeaders` confirmed).
2. Sign-in leaks email-vs-password — **RESOLVED §2.2** (single generic code; no halt).
3. `profile_type` unreconstructable — **RESOLVED §2.3** (all four map; admin→null).
4. Round-trip can't be constructed — **RESOLVED §2.7** (cookie capture/replay + real getSession).
5. Any gate regresses vs `fc2bd4d`.

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| `getSetCookie()` typing/availability | Low | 1.1 typecheck / Gate 4 | Node-20 undici Headers has it; fallback to `get('set-cookie')` if needed, locked at 1.1 |
| `returnHeaders` result typing (option-dependent) | Medium | 1.1 typecheck | type via `Awaited<ReturnType<typeof <local call fn>>>` (§11 note) |
| cookie replay misses HttpOnly attrs in test | Low | Gate 4 round-trip | replay `name=value` only (the Cookie header needs no attrs) |
| unverified re-send hits SMTP in test | Low | Gate 4 | nodemailer mocked (signup.test pattern) |
| 403 vs 401 mis-branch | Low | Gate 4 | branch on `err.statusCode` (403=unverified) |

---

## §8 — Cross-references
- `auth/auth.ts` (the better-auth config — `requireEmailVerification`, additionalFields), `auth/
  plugin.ts` (the catch-all; only sign-up/email 404'd), `routes/signup.ts` (the `auth.api` wrap +
  APIError catch pattern), `middleware/require-auth.ts` (the guard the round-trip exercises),
  `routes/profile.ts` (the round-trip's authed endpoint), `tests/signup.test.ts` (real-PG + nodemailer
  mock pattern).
- `frontend-backend-contract.md` §3.2 (sign-in routing), §3.3 (admin-login note), §5.2/§7.2 (the four
  profile types + agency mapping), §6 (the Phase-1d response requirement).
- better-auth `dist/api/routes/sign-in.mjs` + `sign-out.mjs`, `better-call/dist/endpoint.mjs`
  (`returnHeaders`).

---

## §9 — Carry-forward methodology
- **CF-9** — 1.1 pause: full file contents + Gate-4 live (shape/cookie, generic errors, profile_type,
  the round-trip, sign-out) + count reconciliation.
- **CF-10** floor re-confirmed (§0). **CF-18** swept (§0).
- **CF-21** — no new env var; no cascade.
- **CF-22** — M2 (DB-select routing source) + M5 (sign-out fold-in) surfaced.
- **CF-23** — `signInEmail`/`signOut` signatures + the `returnHeaders` cookie mechanism + generic/
  unverified behavior + the `profile_type` mapping all verified at plan-write against installed
  source; the live round-trip is the execution-time layer.
- **CF-24** — the response is the (a)-class shape the FE adapts to at repoint (contract §6/§7.4); the
  generic-credentials + verify-first paths are class-(b) the FE must consume (Phase-1e carry-forward).

---

## §10 — Push policy + sequencing
**1.0** — `git add` plan; `docs(phase-1d): plan Commit 1 — signin`; push; `gh run watch` (CF-6). Node 20.
**1.1** — `git add apps/api`; `feat(api): POST /api/signin (shaped routing response) + POST /api/signout
+ real-cookie round-trip`; push; `gh run watch` (CF-7). Node 20. No `Co-Authored-By`. **Verify
`pnpm-lock.yaml` untouched** (no new deps).

---

## §11 — Exact file contents (Commit 1.1)

### `apps/api/src/routes/signin.ts` (new)
```ts
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';

const signinBodySchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

// Reconstruct the frontend's profile_type from role + business_type (inverse of the signup
// mapping; contract §5.2/§7.2). `agency` is NOT a role — it is advertiser + business_type='agency'.
// admin/superadmin have no FE profile_type (separate admin login, Phase 1f).
const toProfileType = (role: string, businessType: string | null): string | null => {
  if (role === 'advertiser') return businessType === 'agency' ? 'agency' : 'advertiser';
  if (role === 'individual_owner' || role === 'fleet_owner') return role;
  return null;
};

// better-auth's signInEmail/signOut set/clear the session cookie via setSessionCookie/
// deleteSessionCookie; with returnHeaders:true the Set-Cookie comes back on `headers`. Forward
// each cookie onto the Fastify reply (getSetCookie returns the array — avoids the Headers.forEach
// comma-join footgun for multiple cookies).
const forwardSetCookie = (reply: FastifyReply, headers: Headers): void => {
  for (const cookie of headers.getSetCookie()) void reply.header('set-cookie', cookie);
};

export const signinRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/signin', async (request, reply) => {
    const parsed = signinBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { email, password } = parsed.data;

    // Local fn so Awaited<ReturnType<...>> captures the returnHeaders:true overload shape.
    const signIn = () =>
      auth.api.signInEmail({
        body: { email, password },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = await signIn();
    } catch (err) {
      if (err instanceof APIError) {
        if (err.statusCode === 403) {
          return reply.status(403).send({
            error: 'EMAIL_NOT_VERIFIED',
            message: 'Please verify your email address before signing in.',
          });
        }
        // 401 INVALID_EMAIL_OR_PASSWORD — generic; wrong email and wrong password are identical
        // (no enumeration). Rare internal auth failures fold here too (don't leak internals).
        return reply.status(401).send({
          error: 'INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect.',
        });
      }
      request.log.error(err, 'signin failed');
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' });
    }

    forwardSetCookie(reply, result.headers);

    // businessType + onboardingCompleted are columns, not better-auth additionalFields, so they
    // are not on result.response.user — read the full routing set from the users row (§2.4).
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        onboardingCompleted: users.onboardingCompleted,
        businessType: users.businessType,
        contactName: users.contactName,
      })
      .from(users)
      .where(eq(users.id, result.response.user.id))
      .limit(1);
    if (!row) {
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'Account lookup failed.' });
    }

    return reply.status(200).send({
      user: {
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        onboarding_completed: row.onboardingCompleted,
        business_type: row.businessType,
        profile_type: toProfileType(row.role, row.businessType),
        contact_name: row.contactName,
      },
    });
  });

  app.post('/api/signout', { preHandler: requireAuth }, async (request, reply) => {
    const result = await auth.api.signOut({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    forwardSetCookie(reply, result.headers);
    return reply.status(200).send({ success: true });
  });
};
```
> **NOTE (1.1):** final typing of `result`/`getSetCookie` locked at 1.1 against the installed types —
> prefer the inferred better-auth types over any cast; if `getSetCookie()` typing is unavailable,
> fall back to splitting `headers.get('set-cookie')`. A mechanical deviation surfaced in CF-9, not a
> scope change.

### `apps/api/src/routes/index.ts` — register
```ts
import { signinRoutes } from './signin.js';
// ...
  await app.register(signinRoutes);
```

### `apps/api/tests/signin.test.ts` (new — real Postgres + mocked nodemailer)
- `vi.hoisted` + `vi.mock('nodemailer')` (signup.test pattern — `createVerifiedUser` calls
  `signUpEmail`, which sends; unverified sign-in re-sends).
- `createVerifiedUser(email, password, { role?, businessType? })`: `auth.api.signUpEmail({ body })`
  then `db.update(users).set({ emailVerified: true, ...role, ...businessType })`.
- `cookieHeader(setCookie)`: map each Set-Cookie to its `name=value` head, join `'; '`.
- Register `apiRoutes` (signin + profile + … ); **no getSession mock** (real cookie → real session).
- Cases (~12):
  1. valid → 200; body `user` has all 8 fields; `set-cookie` present.
  2. wrong password → 401 `INVALID_CREDENTIALS`.
  3. unknown email → 401 `INVALID_CREDENTIALS` (byte-identical to #2).
  4. unverified user → 403 `EMAIL_NOT_VERIFIED`.
  5. agency (advertiser + business_type='agency') → `profile_type='agency'`.
  6. individual_owner → `profile_type='individual_owner'`.
  7. advertiser (non-agency) → `profile_type='advertiser'`.
  8. fleet_owner → `profile_type='fleet_owner'`.
  9. empty/invalid body → 400.
  10. **round-trip:** signin → cookie → `PATCH /api/profile/business {business_name}` with it → 200;
      the user's `businessName` updated (real getSession).
  11. sign-out: signed-in (real cookie) → 200; replaying the cleared cookie on an authed endpoint →
      401.
  12. unauthenticated sign-out (no cookie) → 401.

**Test delta: apps/api 99 → ~110-112.** Exact locked + reconciled at 1.1.

`.env.example` + `ci.yml` — **unchanged** (no new env/deps; confirm at 1.1).

---

## §12 — Fire instruction

This is **Commit 1.0** (plan). Architect: ratify M1–M8; on approval, commit + push docs-only.
**Halt** until then.

- **M1 — cookie via `returnHeaders:true` + `headers.getSetCookie()`** forwarded to the reply (the
  verified mechanism, §2.1). *Recommend.*
- **M2 — routing fields from a `db.select` on the `users` row** (businessType + onboardingCompleted
  aren't better-auth additionalFields) — one query, no auth-config change. *Recommend.*
- **M3 — `profile_type` reconstruction** per §2.3 (admin/superadmin → null). *Recommend.*
- **M4 — generic 401** for all credential failures (no enumeration); **403 EMAIL_NOT_VERIFIED** for
  unverified (better-auth re-sends); branch on `err.statusCode`. *Recommend.*
- **M5 — fold `POST /api/signout` into this commit** (small, pairs with sign-in, enables the sign-out
  round-trip leg). *Recommend.*
- **M6 — refresh OUT of slice 1** (D5 verified — FE has no refresh endpoint, §2.5). *Confirm.*
- **M7 — response shape** `{ user: { id, email, role, status, onboarding_completed, business_type,
  profile_type, contact_name } }`; no token in the body (it's in the cookie). *Recommend.*
- **M8 — round-trip test uses the REAL `getSession`** (no mock) with a real cookie — the boundary
  Commit 3 left open; the signin suite mocks nodemailer but not getSession. *Recommend.*

Plus acknowledge: raw `/auth/sign-in/email` stays reachable (no plugin change); no new env var / no
new deps (lockfile untouched); count lift apps/api 99→~110-112 / root 259→~270-272; the Phase-1e
carry-forward (FE repoints to `/api/signin`, consumes the routing fields, adds the verify-first +
generic-credentials handling). CF-21/22/23/24 in §9.
