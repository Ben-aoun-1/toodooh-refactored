# Phase 1b Commit 2 — better-auth integration (account + session [+ verification] tables, plugin mount, additionalFields)

Second commit of Phase 1b. Commit 1 (`d59bf75`) landed the `users` table.
Commit 2 adds the remaining better-auth tables and wires better-auth into
Fastify, so its signup/signin/signout/get-session endpoints exist (Commit
3 wraps signup; Commit 4 swaps the email stub for Resend).

**The CF-23 verification (better-auth's actual schema + API, checked via
Context7 `/better-auth/better-auth`, not training recall) surfaced two
CRITICAL findings that change the locked scope:**

- **F1 — a third table (`verification`) is REQUIRED** for the locked
  `requireEmailVerification: true` to function. The architect's "account +
  session pair" is incomplete.
- **F2 — `role`/`status` additionalFields need `input: false`** or a
  signup payload can self-assign `role: 'superadmin'` (privilege
  escalation). Security finding, surfaced per CLAUDE.md rule 10.

Plus five config corrections (F3–F7) and three benign deviations (F8–F10).
All are micro-decisions in §2/§12 for ratification **before** code.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `d59bf75` (Phase 1b Commit
1.1), pushed + CI-green (run `26179293028`).

**Baseline floor (CF-10, re-baselined plan-time):** typecheck **51** /
lint **1** / test **172** (160 web + 12 api) / build apps/web **139.80 kB**.

**CF-18 sweep — clean.** No `apps/api/src/auth/` dir. No `accounts`,
`sessions`, or `verifications` table in `schema.ts` (only the Commit-1
`users` table + the 2 enums). No `AUTH_SECRET` in `env.ts`/`.env.example`.
No `better-auth` in `package.json`. (The `better-auth` grep hits in
`schema.ts` are Commit-1 comments.)

**Node PATH prefix** on every gate + git command. `NODE_OPTIONS=--max-old-space-size=4096`
on commit (lint-staged OOM precedent).

---

## §1 — Locked constraints

**Pinned version (CF-19, plan-time):** `better-auth` **1.6.11** (exact;
`npm view better-auth version` → 1.6.11). The Drizzle adapter ships as a
subpath of the main package — **no separate `@better-auth/drizzle-adapter`
install** (import path verified at 2.1 — see F10).

**In scope (Commit 2.1), reflecting the recommended F1–F2 resolutions:**

| File | Action |
| --- | --- |
| `apps/api/src/db/schema.ts` | modify — add `accounts`, `sessions`, **`verifications`** (F1) + inferred types |
| `apps/api/drizzle/0002_*.sql` + meta | new — drizzle-kit `--name accounts_sessions_verifications` |
| `apps/api/src/env.ts` | modify — add `AUTH_SECRET` (min 32) |
| `apps/api/src/auth/auth.ts` | new — better-auth instance + exported email stub |
| `apps/api/src/auth/plugin.ts` | new — Fastify catch-all wrapping `auth.handler` (F4) |
| `apps/api/src/logger.ts` | modify — add a standalone `logger` pino instance for non-request contexts (F-log) |
| `apps/api/src/server.ts` | modify — register `authPlugin` |
| `apps/api/.env.example` | modify — add `AUTH_SECRET` (+ generation comment) |
| `apps/api/tests/db.test.ts` | modify — +3 schema tests (accounts/sessions/verifications) → 6 |
| `apps/api/tests/auth.test.ts` | new — ~5 DB-free smoke tests |
| `apps/api/package.json` | modify — add `better-auth` dep |
| `pnpm-lock.yaml` | modify — `better-auth` + its tree |

**Out of scope:** signup endpoint (Commit 3), real email send (Commit 4),
frontend (Phase 1e), OAuth/MFA/password-reset, RLS, custom session
middleware.

---

## §2 — Inventory phase & the CF-23 better-auth findings

Verified against better-auth's `auth-schema-pg-uuid` CLI snapshot + the
Fastify/email-password/database docs (Context7).

### F1 (CRITICAL, HARD-HALT-class → Q1) — the `verification` table is required

better-auth's standard schema is **four** tables: `user`, `account`,
`session`, **`verification`**. The `verification` table stores
email-verification and password-reset tokens. With the locked
`requireEmailVerification: true` + `sendVerificationEmail`, better-auth
**writes verification records on signup** — without the table, signup 500s
at runtime. The architect's "account + session (the standard pair)" omits
it.

**Recommend (Q1): add a third `verifications` table this commit** — the
locked email-verification config is *active now* (Decision 7: "wiring the
config now means no flag-flip at Commit 4"), so its storage must land now.
The table is trivial (5 cols, no FK). better-auth `verification` shape
(pg-uuid): `id` uuid PK · `identifier` text NOT NULL · `value` text NOT
NULL · `expires_at` ts NOT NULL · `created_at`/`updated_at`. Map
`verification: verifications` in the adapter.

### F2 (CRITICAL SECURITY → Q2) — `role`/`status` need `input: false`

The architect locked `role`/`status` as additionalFields with
`required: true` + `defaultValue`. **better-auth additionalFields are
settable from the signup/update API by default** — so a crafted
`POST /auth/sign-up/email` body with `"role":"superadmin"` or
`"status":"approved"` would **self-elevate privileges**. This is an
authorization/identity hole (CLAUDE.md rule 10 — surface, don't ship).

**Recommend (Q2):** `role`/`status` →
`{ type: 'string', required: false, input: false, defaultValue: '…' }`.
`input: false` makes them **server-controlled only** (the client cannot
set them; the `defaultValue` applies). `required` becomes `false` (you
can't require an input you forbid). Role assignment beyond the default
happens via the `promote-to-admin` script (Commit 1) or admin endpoints
(later), never via signup. **Overrides the locked `required: true`.**

### F3 (CF-23 → Q3) — `generateId` config path

Locked config has top-level `generateId: false`. better-auth 1.6.x nests
it: **`advanced: { database: { generateId: false } }`**. With it false,
better-auth defers to the Drizzle/Postgres `defaultRandom()` uuid. Correct
the path.

### F4 (CF-23 → Q4) — there is no first-party Fastify "plugin"

better-auth is framework-agnostic; the documented Fastify integration is a
**manual catch-all route** that converts the Fastify request → Web
`Request` (via `fromNodeHeaders` from `better-auth/node`) → `auth.handler(req)`
→ forwards the Web `Response`. Our `plugin.ts` is a **`FastifyPluginAsync`
that registers that catch-all** at `/auth/*` — encapsulating the documented
handler as a plugin (matches the architect's "plugin wrapping the handler"
intent; the mechanism is the catch-all, not a library plugin).

### F5 (CF-23 → Q5) — `basePath` must match the mount

better-auth's default `basePath` is **`/api/auth`**; `auth.handler`
matches routes against it. The architect locked the mount at `/auth/*`.
Mounting at `/auth/*` without telling better-auth → every route 404s
inside the handler. **Recommend: set better-auth `basePath: '/auth'`** to
honor the `/auth/*` lock (alternative: mount at `/api/auth/*` with the
default — but `/auth/*` is locked).

### F6 (CF-23 → Q6) — `sendOnSignUp: true`

`requireEmailVerification: true` gates *sign-in*; the verification email
fires at signup only when **`emailVerification.sendOnSignUp: true`**. The
locked config omits it, so the stub wouldn't fire at signup. **Recommend:
add `sendOnSignUp: true`** so Commit 3's signup triggers the stub (and
Commit 4's real send).

### F7 (CF-23 → Q7, soft) — `baseURL` / `trustedOrigins`

better-auth builds the verification `url` from `baseURL`. Unset, it infers
from the request (adequate for Commit 2's stub-logging + the DB-free smoke
tests). For correct verification links in Commit 3/4 it should be explicit.
**Recommend: defer** — verify at 2.1 whether better-auth warns/errors
without it; if so, add a `BETTER_AUTH_URL` env then. Not a Commit-2 blocker.

### F8–F10 (benign deviations from better-auth's default Drizzle schema — keep, noted)

- **F8 — `timestamptz`.** better-auth's account/session snapshot uses
  `timestamp` (no tz); we use `{ withTimezone: true }` for consistency with
  the Commit-1 `users` table and correctness. The adapter works with Date
  either way. Keep.
- **F9 — `updatedAt.defaultNow()`.** better-auth's account/session snapshot
  omits `.defaultNow()` on `updatedAt` (only `$onUpdate`); we add it
  (consistent with `users`, safe — the adapter sets it on insert anyway).
  Keep.
- **F10 — architect-added constraints.** account `UNIQUE(provider_id,
  account_id)` + session `expires_at` index are beyond better-auth's
  default (which has only the `user_id` index). Both are sound (one
  credential per provider+id; expiry-cleanup queries) and don't conflict.
  Keep.

### F-log (minor) — auth.ts needs a pino instance

`auth.ts` is in `src/` (no-console forbidden), and `sendVerificationEmail`
must log. `logger.ts` currently exports only `buildLoggerConfig` (a Fastify
config). **Add a standalone `export const logger = pino({ level:
env.LOG_LEVEL })`** to `logger.ts` for non-request contexts (the stub).
Touches `logger.ts` (one file beyond the architect's list). Minor.

### F-import (CF-23, execution-verify) — Drizzle adapter import path

Plan uses `import { drizzleAdapter } from 'better-auth/adapters/drizzle'`
(the documented subpath) and `import { fromNodeHeaders } from
'better-auth/node'`. A Context7 snippet showed `@better-auth/drizzle-adapter`
(older/separate package). **Verified at 2.1** by checking the installed
`better-auth` package exports; fallback to `@better-auth/drizzle-adapter`
only if the subpath isn't exported. Flagged, not assumed.

### Tests are DB-free (CI constraint, carried from Phase 1a)

CI has no Postgres service, so `auth.test.ts` must not need a live DB.
better-auth instance construction + plugin registration + `GET
/auth/get-session` (no cookie → no DB query) are DB-free; the
`sendVerificationEmail` stub is unit-tested in isolation (exported, called
with fake args, pino spy). The full signup flow (DB + verification write)
is exercised in Commit 3 (testcontainer/strategy decided there). Endpoint
*existence* is asserted via get-session (DB-free), not sign-up/email (which
would hit the DB).

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **2.0** | Plan (this file). Halt; surface Q1–Q7; ratify; commit + push (CF-6). |
| **2.1** | schema (3 tables) + migration + auth.ts + plugin.ts + logger.ts + env.ts + server.ts + .env.example + tests + package.json + lockfile. Halt; CF-9; ratify; push (CF-7). |

2.1 is **mechanical** with two judgment seams: the drizzle-kit-generated
SQL/meta bytes, and the F-import path resolution (both verified at
execution against §11).

---

## §4 — Per-commit verification gates

### Gate 1 — workspace registration.

### Gate 2 — per-package (apps/api floor: test 12 → 20)
```bash
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 20 passing (db 6 + auth 5 + existing 9)
pnpm --filter @toodooh/api build       # success
```

### Gate 3 — root no-regression vs `d59bf75`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 172 | **180** (+8: db +3, auth +5) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — migration + DB verification
```bash
docker compose -f infra/docker-compose.yml up -d postgres   # fresh volume
cp apps/api/.env.example apps/api/.env   # set a real 32+ char AUTH_SECRET
pnpm --filter @toodooh/api migrate
# psql: \d accounts \d sessions \d verifications
#   accounts: 13 cols, FK user_id→users(id) CASCADE, UNIQUE(provider_id,account_id), user_id idx
#   sessions: 8 cols, token unique, FK user_id→users(id) CASCADE, user_id + expires_at idx
#   verifications: 5 cols, identifier idx
#   __drizzle_migrations = 3 rows (postgis, users, accounts/sessions/verifications)
```

### Gate 5 — boot + AUTH_SECRET validation
```bash
pnpm --filter @toodooh/api dev                       # boots with valid AUTH_SECRET
curl -s -i localhost:4000/auth/get-session           # 200, empty/null session (no cookie)
curl -s localhost:4000/health                         # 200, checks.db ok
# SIGINT → clean shutdown (onClose ends sql)
AUTH_SECRET=short pnpm --filter @toodooh/api dev      # fast-fail: zod "min 32" error
# unset AUTH_SECRET                                    # fast-fail: zod required error
```

### Gate 6 — CI on push (no workflow change; tests DB-free).

---

## §5 — Standing operating procedure

CF-6 for 2.0; CF-7 for 2.1 (gate sweep → migration/DB + boot verify →
CF-9 → ratify → push → CI). Node PATH prefix; heap bump on commit. CF-18
re-sweep before first Write. CF-23 schema/API verification done plan-time
(§2); F-import resolved at execution.

---

## §6 — Hard-halt conditions

1. F1/F2 unratified — don't generate the migration or write auth.ts until
   Q1 (verification table) and Q2 (input:false) are ruled.
2. better-auth's installed schema diverges from the §2 snapshot beyond
   F8–F10 (a column it requires that we lack) — halt.
3. `advanced.database.generateId: false` produces ID conflicts / better-auth
   demands its own ID format somewhere — halt.
4. Fastify catch-all breaks pino reqId propagation or body handling such
   that `auth.handler` rejects valid requests — halt.
5. F-import: neither `better-auth/adapters/drizzle` nor
   `@better-auth/drizzle-adapter` resolves — halt.
6. AUTH_SECRET validation message not actionable — fix before commit.
7. Any gate regresses; or migration applies but `\d` shows missing
   columns/FKs/indexes.
8. better-auth hard-requires `baseURL` (F7) and the smoke tests can't pass
   without it — surface (add the env), don't work around.

---

## §7 — Risk register

| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| verification table omitted → signup 500 | **Resolved by Q1** | Commit 3 signup | add `verifications` now |
| role/status self-elevation | **Resolved by Q2** | security | `input: false` |
| wrong generateId path → ID conflict | Medium | Gate 4 migrate/insert | `advanced.database.generateId:false` (F3) |
| basePath mismatch → all /auth routes 404 | Medium | Gate 5 get-session | `basePath:'/auth'` (F5) |
| stub doesn't fire at signup | Low | Commit 3 | `sendOnSignUp:true` (F6) |
| adapter import path wrong | Medium | Gate 2 typecheck/build | F-import execution-verify + fallback |
| auth instance opens DB at construct (breaks CI tests) | Low | Gate 2 test | postgres.js lazy-connects; construction is DB-free |
| Fastify body re-serialize breaks better-auth POST | Low | Commit 3 signup | follow documented `JSON.stringify(body)` + `fromNodeHeaders` |
| baseURL required | Low | Gate 5 | F7 — add `BETTER_AUTH_URL` env if better-auth errors |
| lockfile pulls a large better-auth tree | Low | lockfile diff | expected; exact-pin top-level |

---

## §8 — Cross-references

- `00-PROJECT_HANDOFF.md` §4 — Better-auth (self-hosted), **stateful
  sessions not JWT** (the `sessions` table is the revocable store).
- `supabase-schema-inventory.md` §2.4 (admin cluster → collapsed into the
  Commit-1 `users.role`), §9 (auth ownership: drop itstrategix.tn, set
  password floor — here `minPasswordLength: 12` — and the email-verify
  policy: `enable_confirmations` was false in legacy; we set
  `requireEmailVerification: true`).
- Context7 `/better-auth/better-auth` — pg-uuid schema snapshot, Fastify
  integration, email-password + email-verification config, database
  generateId.
- `docs/audit.md` §12 (Phase 1a). Prior: `d59bf75` (users table).

---

## §9 — Carry-forward methodology

- **CF-9** — 2.1 pause summary per the architect's listed items + verbatim
  auth.ts/plugin.ts/schema additions + migration + boot/AUTH_SECRET verify.
- **CF-10** — floor re-baselined plan-time (§0).
- **CF-18** — swept clean (§0).
- **CF-19** — `better-auth@1.6.11` exact-pinned.
- **CF-22 — fifth+ instance.** F1 (verification table missing from the
  locked scope) and F2 (security: input:false overrides `required:true`)
  are literal-lock-vs-library/security-invariant conflicts surfaced for
  ratification. Reinforces the promotion due at the Phase-1b audit refresh.
- **CF-23 — SECOND worked instance → now promotable.** "Verify the
  integrating library's schema/API before locking your own." Commit 1
  (better-auth user schema) was the first; this commit is the second —
  the better-auth account/session schema check caught the missing
  `verification` table (F1), the `generateId` path (F3), the
  no-Fastify-plugin reality (F4), and `basePath` (F5). **Promote CF-23 at
  the Phase-1b audit refresh** alongside CF-22.

---

## §10 — Push policy + sequencing

**2.0** — `git add` plan; `docs(phase-1b): plan Commit 2 — better-auth
integration`; push; `gh run watch` (CF-6).

**2.1** — `git add apps/api pnpm-lock.yaml`; commit (body: 3 tables +
plugin + the ratified findings); push; `gh run watch` (CF-7). No
`Co-Authored-By`.

---

## §11 — Exact file contents (Commit 2.1)

> Reflects the **recommended** F1–F6 resolutions. If the architect rules
> otherwise on any Q, §11 adjusts before code.

### `apps/api/src/db/schema.ts` (append after `users` + types)

```ts
// ── better-auth tables (Commit 2) ──────────────────────────────────────
// account: credential + (future) OAuth provider records.
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('accounts_provider_account_idx').on(table.providerId, table.accountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

// session: stateful, revocable sessions (handoff §4 — not JWT).
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

// verification: email-verify + password-reset tokens (REQUIRED by
// requireEmailVerification — F1). No user FK (identifier is an email/token).
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
```

Schema imports gain `uniqueIndex` from `drizzle-orm/pg-core`.

### `apps/api/src/env.ts` (add to the zod object)

```ts
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters for cryptographic security'),
```

### `apps/api/src/logger.ts` (append a standalone instance)

```ts
import pino from 'pino';
// … existing buildLoggerConfig …

// Standalone logger for non-request contexts (scripts, better-auth hooks).
export const logger = pino({ level: env.LOG_LEVEL });
```
(adds `import pino from 'pino'` + `import { env } from './env.js'` if not
already present; `env` is needed for the level.)

### `apps/api/src/auth/auth.ts` (new)

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client.js';
import { accounts, sessions, users, verifications } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

interface VerificationEmailArgs {
  user: { id: string; email: string };
  url: string;
  token: string;
}

// Commit 4 replaces this body with the Resend send; signature stays.
export const sendVerificationEmailStub = async (args: VerificationEmailArgs): Promise<void> => {
  logger.info(
    {
      userId: args.user.id,
      email: args.user.email,
      verificationUrl: args.url,
      token: args.token,
    },
    'Verification email stub — Commit 4 replaces with Resend send',
  );
};

export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  basePath: '/auth',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: users, account: accounts, session: sessions, verification: verifications },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: sendVerificationEmailStub,
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: false, input: false, defaultValue: 'advertiser' },
      status: { type: 'string', required: false, input: false, defaultValue: 'pending' },
    },
  },
  advanced: {
    database: { generateId: false },
  },
});
```

### `apps/api/src/auth/plugin.ts` (new)

```ts
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsync } from 'fastify';

import { auth } from './auth.js';

// better-auth ships no first-party Fastify plugin (F4) — this plugin
// registers the documented catch-all that bridges Fastify ⇄ Web Request
// and delegates to auth.handler.
export const authPlugin: FastifyPluginAsync = async (app) => {
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        void reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });
};
```

### `apps/api/src/server.ts` (register the plugin in `start()`)

```ts
import { authPlugin } from './auth/plugin.js';
// …
const start = async (): Promise<void> => {
  try {
    await app.register(authPlugin);
    await app.register(healthRoute);
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
```
(The `onClose` db-shutdown hook from Phase 1a Commit 3 already covers
graceful disconnect — confirmed present.)

### `apps/api/.env.example` (add)

```
# Generate with: openssl rand -hex 32
AUTH_SECRET=replace-with-openssl-rand-hex-32-value-min-32-chars
```

### `apps/api/package.json` (add dependency)

```json
"better-auth": "1.6.11"
```

### `apps/api/tests/db.test.ts` (extend — +3 → 6 tests)

Add runtime assertions that `accounts`, `sessions`, `verifications` export
with their key columns (e.g. `expect(accounts.userId).toBeDefined()`,
`expect(sessions.token).toBeDefined()`, `expect(verifications.identifier).toBeDefined()`),
keeping them DB-free.

### `apps/api/tests/auth.test.ts` (new — ~5 DB-free smoke tests)

1. `auth` instance is defined / constructed without throwing.
2. `sendVerificationEmailStub` logs the URL+token (pino spy on the
   standalone `logger`).
3. `authPlugin` registers into a fresh Fastify app (`app.ready()` resolves).
4. `GET /auth/get-session` (no cookie) returns non-404 (route mounted;
   DB-free).
5. an unknown method/path under `/auth/*` is still routed by the catch-all
   (not a Fastify 404).

(Exact assertions finalized at 2.1; count locked at 5 → apps/api 12 → 20,
root 172 → 180.)

### `apps/api/drizzle/0002_*.sql` + meta

Generated by `drizzle-kit generate --name accounts_sessions_verifications`.
Expected: 3× `CREATE TABLE`, 2 FKs (account.user_id, session.user_id →
users.id ON DELETE CASCADE), `UNIQUE(provider_id, account_id)`, session
token unique, indexes (accounts user_id; sessions user_id + expires_at;
verifications identifier). Verified against this at execution.

---

## §12 — Fire instruction

This is **Commit 2.0** (plan). Architect: ratify the micro-decisions
below; on approval, commit + push docs-only. **Halt** until then.

**Micro-decisions for ratification (CF-22 surface, prose — no
AskUserQuestion):**

- **Q1 (CRITICAL) — add the `verifications` table** (3 tables this commit).
  Required for the locked `requireEmailVerification: true`. *Recommend yes.*
- **Q2 (CRITICAL, security) — `role`/`status` `input: false`** (override
  `required: true`). Prevents signup self-elevation to superadmin.
  *Recommend yes.*
- **Q3 — `generateId` path** → `advanced.database.generateId: false`.
  *Recommend (correction).*
- **Q4 — Fastify integration** is a catch-all route inside our
  `FastifyPluginAsync` (no library plugin exists). *Confirm understanding.*
- **Q5 — `basePath: '/auth'`** so `auth.handler` matches the `/auth/*`
  mount. *Recommend.*
- **Q6 — `emailVerification.sendOnSignUp: true`** so the stub fires at
  signup. *Recommend.*
- **Q7 — `baseURL`/`trustedOrigins`**: defer; add a `BETTER_AUTH_URL` env
  only if better-auth errors without it at 2.1. *Recommend defer.*

Plus acknowledge the benign deviations (F8 timestamptz, F9 updatedAt
defaultNow, F10 architect-added unique/index — all kept), the F-log
`logger.ts` touch (+1 file), the F-import execution-verify of the adapter
path, and the DB-free test design (CI has no Postgres). CF-22 (fifth
instance) + CF-23 (second instance — now promotable) recorded in §9.
