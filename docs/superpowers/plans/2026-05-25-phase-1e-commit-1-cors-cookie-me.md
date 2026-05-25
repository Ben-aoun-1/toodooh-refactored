# Phase 1e (Part A) — Commit 1: browser-reachable API + identity-readable

**Date:** 2026-05-25 · **Phase:** 1e (backend prerequisites) · **Commit:** 1 of Part A
**Branch:** main · **Entry HEAD:** `3d84dd8` (survey doc) · **Node:** 20.20.2 (PATH prefix)
**Status:** RATIFIED (architect rulings D1–D3 folded in §11) — ready to implement after this doc
commits.

Goal: the smallest coherent "make `apps/api` browser-reachable + identity-readable" unit —
`@fastify/cors` (minimal), the same-origin Vite dev proxy, the better-auth `trustedOrigins` the proxy
actually requires (D1), `GET /api/me` returning the full self-view (D2), and the origin-check
positive+negative tests that close the CF-23 execution-time gap (D3). Per survey §8.4.

---

## §0 — Pre-flight verification

- Working tree clean at `3d84dd8`; survey doc committed + CI-green.
- Gate floor entering: **apps/api 122 / root 282** (typecheck 51 / lint 1 / build apps/web
  139.80 kB gzip). `apps/web` source untouched (only the dev-only `vite.config` `server` block;
  not bundled).
- `node -v` → v20.20.2 before any pnpm/git.
- `@fastify/cors` absent (confirmed: not in node_modules nor package.json).

## §1 — Locked constraints (architect, survey §8)

- **Same-origin proxy, NOT `SameSite=None`** (§8.2.1). Dev: Vite proxies `/api` + `/auth` → `:4000`.
  Prod: nginx fronts both (Phase 1h). Cookie stays `Lax` (better-auth default — unchanged).
- **Integrated dev model** (both apps running, proxied).
- **`@fastify/cors` minimal** — future-proofs non-proxied callers (player-api later); near-moot for
  the proxied browser path.
- Out of scope (own commits): signup-grows (§8.2.2), reference-data GETs (§8.2.3). No touch to
  signup / profile-write / password routes.

## §2 — Inventory & CF-23 verification (verified against installed better-auth 1.6.11 + source)

### §2.1 — `GET /api/me` confirmed absent ✅
Registered routes: signup, signin, signout, password×3, profile×4, documents/:type, health. No
`/api/me`/session-read route (only `require-auth.ts`'s internal `getSession`). Greenfield.

### §2.2 — Full self-view columns all live on `users` (D2) ✅
No separate `business_profiles` table — Phase 1b/1c consolidated everything onto `users`
(`schema.ts:34`). The self-view reads one row: identity (`id,email,emailVerified,contactName,role,
status`), business profile (`businessName,taxNumber,contactPhone,fonction,businessSectorId,
businessType,streetAddress,city,postalCode,governorateId,zone`), document presence
(`registrationDocUrl,cinDocUrl` → booleans), notifications (`notify{NewsUpdates,RemindersEvents,
PromotionsOffers}`), `onboardingCompleted`. One `requireAuth` GET, one row read, complete self-view.

### §2.3 — THE LOAD-BEARING ONE: trustedOrigins is a THIRD origin layer (D1, RATIFIED) ✅
`better-auth/dist/api/middlewares/origin-check.mjs` (CF-23 source-read): `originCheckMiddleware`
skips GET/OPTIONS/HEAD; for non-GET it runs `validateOrigin` when the request carries a cookie OR
`formCsrfMiddleware` fires on `Sec-Fetch-*` (browsers always send these), requiring an **exact**
`matchesOriginPattern(Origin, trustedOrigins)` (default `[baseURL]` = `localhost:4000`). A same-origin
Vite/nginx proxy **forwards the browser's real Origin** (`localhost:5173`) ≠ `baseURL` → the FE's
Phase-1f POST `/api/signin|signup|password/*` would 403 `INVALID_ORIGIN` unless `:5173` is trusted.
`GET /api/me` is GET-exempt (unaffected), but Commit 1 is the right home for `trustedOrigins:
[env.WEB_ORIGIN]`. The ruling resize "CORS near-moot AND trustedOrigins required" is ratified.
**The third layer (separate from CORS + SameSite): CORS, SameSite cookie scoping, AND better-auth
origin-check.** See [[better-auth-origin-check-vs-proxy]].

**Open empirical question → resolved by D3's test, not assumed.** Whether the check fires on the
custom-route path (`auth.api.signInEmail`, server-side) vs only the `/auth/*` handler path is NOT
fully determinable by source-read. D3's negative test characterizes it empirically (CF-23 two-layer);
§6 halts-and-surfaces if reality differs from the hypothesis (bogus origin → 403).

### §2.4 — `WEB_ORIGIN` env + the CF-21 cascade (D1) ✅
New `env.ts` var `WEB_ORIGIN: z.url().default('http://localhost:5173')`. Consumers: `@fastify/cors`
`origin` + better-auth `trustedOrigins`. CF-21 verified at plan-write:
- **CF-21a (runtime shim):** defaulted → **no entry needed** in `vitest.config.ts` `test.env` (the
  shim injects only required-without-default vars — STORAGE_BUCKET/REGION/BETTER_AUTH_URL are
  defaulted-and-uncascaded; WEB_ORIGIN follows that precedent). Confirmed.
- **CF-21b (typed `Env` literal):** `tests/error-handler.test.ts:9` passes a full inline `Env` object
  to `buildErrorHandler(env: Env)` — adding `WEB_ORIGIN` to the `Env` type **forces this one site to
  add the field** or typecheck fails. **§11 adds it there.** (No other typed-`Env` literal exists.)
- `env.test.ts` gets a default-assertion (`expect(env.WEB_ORIGIN).toBe('http://localhost:5173')`),
  parity with the STORAGE_BUCKET/REGION default assertions at `:27-28`.

### §2.5 — `toProfileType` extracted verbatim (D2 reuse) ✅
Lives in `signin.ts:20`. Extract **verbatim** to `src/lib/profile-type.ts`
([[extraction-without-rewrite-discipline]]); `signin.ts` + the new `me.ts` import it. signin.ts
behavior unchanged (import swap only) — signin.test.ts must stay byte-green.

### §2.6 — `@fastify/cors` ✅
Pin **`11.2.0`** (CF-19; Fastify-5 compatible — registry-confirmed). `fastify-plugin`-wrapped →
hooks apply app-wide regardless of registration order; register in `start()` before routes.

## §3 — Commit factoring

Single commit (one coherent backend unit, gated the 1b–1d way). Files in §11.

| File | Change |
|---|---|
| `apps/api/package.json` | add `@fastify/cors` `11.2.0` (exact pin) |
| `pnpm-lock.yaml` | regenerate (dependency→lockfile same commit — `249fc87` guard) |
| `apps/api/src/env.ts` | + `WEB_ORIGIN` |
| `apps/api/src/server.ts` | register `@fastify/cors` (origin=WEB_ORIGIN, credentials) |
| `apps/api/src/auth/auth.ts` | + `trustedOrigins:[env.WEB_ORIGIN]` |
| `apps/api/src/lib/profile-type.ts` | **new** — `toProfileType` verbatim |
| `apps/api/src/routes/signin.ts` | import `toProfileType` (delete local copy) |
| `apps/api/src/routes/me.ts` | **new** — `GET /api/me` full self-view |
| `apps/api/src/routes/index.ts` | register `meRoutes` |
| `apps/web/vite.config.ts` | + `server.proxy` `/api`,`/auth` → `:4000` |
| `apps/api/tests/me.test.ts` | **new** — self-view + auth gating tests |
| `apps/api/tests/origin-check.test.ts` | **new** — D3 positive+negative origin tests |
| `apps/api/tests/error-handler.test.ts` | + `WEB_ORIGIN` in the `Env` literal (CF-21b) |
| `apps/api/tests/env.test.ts` | + `WEB_ORIGIN` default assertion |

## §4 — Per-commit verification gates

- **Gate 2 — apps/api per-package:** `pnpm --filter @toodooh/api typecheck && lint && test` with the
  full env block ([[local-migrate-needs-full-env-block]]). New tests in §11.5/§11.6.
- **Gate 3 — root no-regression vs `3d84dd8`:** typecheck **51** / lint **1** UNCHANGED (backend-only;
  apps/web source untouched — `vite.config` `server` is dev-only, not type-checked into the floor).
  apps/web build **139.80 kB** unchanged (proxy not bundled).
- **Gate 4 — live (real Postgres):** `me.test.ts` + `origin-check.test.ts` against real PG; serialized
  suite (Phase-1c). apps/api test count rises ~+9 — **deliberate ratchet-up**, reasoned in the body.
- **Gate 5 — CI green:** Postgres service present; no new service. headSha verification (Step-13).
- signin.test.ts stays green (import-swap behavior-preserving).

## §5 — Standing operating procedure

Node-20 PATH prefix on every pnpm/git. Dependency→lockfile same commit (§3 list is the guard).
CF-7 gate-sweep push flow; CI headSha verify; fix-forward if red (main append-only). Full env block
for local `tsx`/test.

## §6 — Hard-halt conditions

- **D3 negative test does NOT 403 on a bogus origin** → the origin-check does not fire on the
  `auth.api.*` custom-route path (only `/auth/*`). Record the corrected behavior (CF-23 two-layer:
  execution refines source-read), surface the resulting CSRF-posture question (custom routes rely on
  SameSite-Lax only), keep `trustedOrigins` (harmless + covers `/auth/*`), and re-scope the 1f
  assumption. Do NOT silently pass a green test that contradicts the hypothesis.
- `@fastify/cors@11.2.0` rejects Fastify 5.8.5 at install/boot → halt, re-pin.
- Extracting `toProfileType` changes any signin.test assertion → stop (must be verbatim).
- Root typecheck/lint floor MOVES (it shouldn't this commit) → halt, investigate.

## §7 — Risk register

| Risk | Surfacing |
|---|---|
| origin-check path ambiguity (`auth.api.*` vs `/auth/*`) | D3 negative test is the empirical resolver; §6 halt |
| CORS double-handling (browser same-origin → CORS unused; non-proxied callers use it) | OPTIONS preflight smoke asserts headers |
| `WEB_ORIGIN` breaks the `Env` typed literal | §2.4 / §11.7 adds it to error-handler.test |
| Vite `server.proxy` vs FE test env (`environment:node`, `include:['*.test.ts']`) | proxy is `server`-scoped, not `test`-scoped — no test impact; build unchanged |
| cookie across `localhost:5173`↔`:4000` (ports) | localhost cookies are not port-scoped — shared; proxy makes it same-origin anyway |

## §8 — Cross-references

Survey §5 (prereqs) + §8 (rulings). Contract §3.2 / §7.2 (profile_type map). Audit §15 / §7.6.
Memory: [[better-auth-origin-check-vs-proxy]], [[node-20-required-for-commits]],
[[local-migrate-needs-full-env-block]], [[extraction-without-rewrite-discipline]].

## §9 — Carry-forward methodology

CF-19 (`@fastify/cors@11.2.0` pin + lockfile). CF-21a/b (WEB_ORIGIN default; error-handler.test
typed-literal cascade). CF-23 two-layer (origin-check source-read §2.3 + execution test §11.6).
CF-22 (the §2.3 resize surfaced + ratified, not unilateral). New-feature test-floor ratchet.

## §10 — Push policy + sequencing

Plan doc pushes immediately (CF-6). Then implement → full gate sweep → CF-9 pause → push code in the
gate-sweep flow (CF-7) → CI headSha watch. No visual-QA pause (backend-only, nothing rendered).

## §11 — Exact file contents (Commit 1) — D1/D2/D3 folded in

### §11.1 — `apps/api/src/env.ts` (diff: after `BETTER_AUTH_URL`, before SMTP)
```ts
  BETTER_AUTH_URL: z.url().default('http://localhost:4000'),
  // Browser origin allowed to reach the API: @fastify/cors `origin` + better-auth
  // `trustedOrigins` (D1). Dev = Vite's origin (same-origin proxy fronts :4000);
  // prod overrides to the web origin (joins BETTER_AUTH_URL/SMTP/STORAGE at deploy).
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
```

### §11.2 — `apps/api/src/server.ts` (diff)
```ts
import cors from '@fastify/cors';            // ← new import (top, with other plugins)
...
const start = async (): Promise<void> => {
  try {
    // Registered first; fastify-plugin-wrapped so it applies app-wide. Same-origin
    // proxy makes this near-moot for the browser, but it future-proofs non-proxied
    // callers (player-api). Credentialed → explicit origin, never '*'.
    await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
    await app.register(authPlugin);
    await app.register(apiRoutes);
    await app.register(healthRoute);
    await app.listen({ port: env.PORT, host: env.HOST });
  } ...
```

### §11.3 — `apps/api/src/auth/auth.ts` (diff: in the `betterAuth({...})` config, near `basePath`)
```ts
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/auth',
  // The browser's Origin (forwarded by the same-origin proxy) is WEB_ORIGIN, not
  // baseURL — without this, cookie-bearing non-GET auth requests 403 INVALID_ORIGIN
  // (D1 / origin-check.mjs). The third origin layer beyond CORS + SameSite.
  trustedOrigins: [env.WEB_ORIGIN],
```

### §11.4 — `apps/api/src/lib/profile-type.ts` (new — verbatim from signin.ts:17-24)
```ts
// Reconstruct the frontend's profile_type from role + business_type (inverse of the signup
// mapping; contract §5.2/§7.2). `agency` is NOT a role — it is advertiser + business_type='agency'.
// admin/superadmin have no FE profile_type (separate admin login, Phase 1f).
export const toProfileType = (role: string, businessType: string | null): string | null => {
  if (role === 'advertiser') return businessType === 'agency' ? 'agency' : 'advertiser';
  if (role === 'individual_owner' || role === 'fleet_owner') return role;
  return null;
};
```
`signin.ts`: delete the local `toProfileType` (lines 17-24) + its comment; add
`import { toProfileType } from '../lib/profile-type.js';`.

### §11.5 — `apps/api/src/routes/me.ts` (new — full self-view, D2)
```ts
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { toProfileType } from '../lib/profile-type.js';
import { requireAuth } from '../middleware/require-auth.js';

// GET /api/me — the cookie-authenticated self-view the FE store rehydrates from on reload
// (the httpOnly cookie carries the session; JS can't read it, so identity comes from here).
// Routing fields (signin parity) + the full business profile + document presence + notifications:
// the store derives identity and the profile pages render from one round-trip (D2).
export const meRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/me', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
        role: users.role,
        status: users.status,
        onboardingCompleted: users.onboardingCompleted,
        contactName: users.contactName,
        businessName: users.businessName,
        taxNumber: users.taxNumber,
        contactPhone: users.contactPhone,
        fonction: users.fonction,
        businessSectorId: users.businessSectorId,
        businessType: users.businessType,
        streetAddress: users.streetAddress,
        city: users.city,
        postalCode: users.postalCode,
        governorateId: users.governorateId,
        zone: users.zone,
        registrationDocUrl: users.registrationDocUrl,
        cinDocUrl: users.cinDocUrl,
        notifyNewsUpdates: users.notifyNewsUpdates,
        notifyRemindersEvents: users.notifyRemindersEvents,
        notifyPromotionsOffers: users.notifyPromotionsOffers,
      })
      .from(users)
      .where(eq(users.id, userId))
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
        email_verified: row.emailVerified,
        role: row.role,
        status: row.status,
        onboarding_completed: row.onboardingCompleted,
        profile_type: toProfileType(row.role, row.businessType),
        contact_name: row.contactName,
        business_name: row.businessName,
        tax_number: row.taxNumber,
        contact_phone: row.contactPhone,
        fonction: row.fonction,
        business_sector_id: row.businessSectorId,
        business_type: row.businessType,
        street_address: row.streetAddress,
        city: row.city,
        postal_code: row.postalCode,
        governorate_id: row.governorateId,
        zone: row.zone,
        documents: { registration: row.registrationDocUrl !== null, cin: row.cinDocUrl !== null },
        notifications: {
          news_updates: row.notifyNewsUpdates,
          reminders_events: row.notifyRemindersEvents,
          promotions_offers: row.notifyPromotionsOffers,
        },
      },
    });
  });
};
```
`routes/index.ts`: `import { meRoutes } from './me.js';` + `await app.register(meRoutes);`.

### §11.6 — Tests
**`apps/api/tests/me.test.ts`** (real PG; reuse signin.test's `buildApp`/`createVerifiedUser`/
`cookieHeader`/nodemailer-mock):
- authenticated (real cookie) → 200; assert routing fields (role/status/onboarding_completed/
  profile_type/contact_name) + profile fields (business_name/tax_number/contact_phone) +
  `documents.{registration,cin}` booleans + `notifications.*`.
- no cookie → 401 `UNAUTHENTICATED`.
- profile_type parity: agency / individual_owner / fleet_owner (proves the extracted helper).
- signed-out cookie → 401 (reuses the signout→cleared-cookie pattern).

**`apps/api/tests/origin-check.test.ts`** (D3 — the CF-23 execution layer; drives POST `/api/signin`
with an `origin` header via `app.inject({ ..., headers: { origin } })`):
- (a) `Origin: <WEB_ORIGIN>` (`http://localhost:5173`) + valid creds → **200** (WEB_ORIGIN is trusted —
  the browser path works at the origin layer before any FE exists).
- (b) `Origin: https://evil.com` + valid creds → **403 INVALID_ORIGIN** (the check is ACTIVE; we're
  whitelisting INTO a working CSRF defense, not disabling it — the negative case proves protection).
- If (b) returns 200 → §6 hard-halt (the check doesn't fire on this path; surface, don't bury).

**`apps/api/tests/error-handler.test.ts`** (CF-21b): add `WEB_ORIGIN: 'http://localhost:5173',` to the
inline `Env` literal at `:9`.
**`apps/api/tests/env.test.ts`:** add `expect(env.WEB_ORIGIN).toBe('http://localhost:5173');` to the
defaults test.

### §11.7 — `apps/web/vite.config.ts` (diff: add `server` to the config object)
```ts
  server: {
    // Same-origin dev proxy (survey §8.2.1): the browser talks to Vite's origin; /api
    // and /auth proxy to the API on :4000, so the Lax cookie rides same-origin and
    // dev mirrors the prod nginx single-origin model. The browser's Origin (WEB_ORIGIN)
    // is forwarded to the API → matched by better-auth trustedOrigins (D1).
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
```
(Dev-only; not bundled — apps/web build floor unchanged.)

## §12 — Fire instruction

Commit + push this plan (CF-6). Then implement §11 in order, gate-sweep, CF-9 pause, push, CI watch.
