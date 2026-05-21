# Phase 1b Commit 3 — signup endpoint (POST /api/signup wrapping auth.api.signUpEmail) + verification token machinery + real-Postgres integration tests

Third commit of Phase 1b. Commit 2 (`1648159`) wired better-auth into the API.
Commit 3 adds the first business-logic endpoint — `POST /api/signup` — which
validates application fields (business_name, contact_phone, tax_number) and
delegates to better-auth's **server-side** `auth.api.signUpEmail()`. It also
introduces the project's **first integration tests against real Postgres**
(CI gains a Postgres service container).

**The CF-23 verification (better-auth 1.6.11 source, read directly:
`api/routes/sign-up.mjs`) surfaced findings that conflict with several locked
decisions. They are surfaced for ratification BEFORE any code.** The two
load-bearing ones are security-class (CLAUDE.md rule 10):

- **F1 (CRITICAL, security → Q1)** — with `requireEmailVerification: true`,
  better-auth **deliberately masks duplicate emails** (anti-enumeration):
  signUpEmail returns a *generic synthetic success*, it does **not** error. So
  **Decision 5's `email conflict → 409 EMAIL_TAKEN` is not achievable and
  should not be reintroduced** (doing so re-opens the enumeration hole).
- **F2 (→ Q2/Q3)** — `signUpEmail` only persists user columns registered as
  `additionalFields`; business fields must be **added to the better-auth config
  as additionalFields**, and the **raw `/auth/sign-up/email`** (live via the
  Commit-2 catch-all) must be **blocked** so `/api/signup` is the only
  validated signup path.

Plus F3–F9 (atomicity reality, tax/phone regex, vitest DB wiring, baseURL,
import paths). All are micro-decisions in §2/§12. **No code until ratified.**

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `1648159` (Phase 1b Commit 2.1),
pushed + CI-green (run `26249452210`).

**Baseline floor (CF-10, plan-time).** Confirmed at `1648159` during the 2.1
push sweep (HEAD unchanged since): typecheck **51** / lint **1** / test **181**
(160 web + 21 api) / build apps/web **139.80 kB**.

**CF-18 sweep — clean.** No `apps/api/src/routes/signup.ts`, no
`src/validation/`, no `routes/index.ts`, no `tests/signup.test.ts`, no
`tests/helpers/`. No `services:` block in `.github/workflows/ci.yml`. No
`/api/*` route registered yet. `auth.ts` additionalFields = only `role` +
`status` (Commit 2).

**Node 20 PATH prefix** on every gate + git command (memory:
`node-20-required-for-commits`). Heap bump on commit.

---

## §1 — Locked constraints

**Already pinned (no version change this commit):** better-auth **1.6.11**,
drizzle-orm 0.45.2, fastify 5.8.5, zod 4.4.3, vitest 4.1.6, postgres 3.4.9.

**In scope (Commit 3.1), reflecting the recommended F1–F9 resolutions:**

| File | Action |
| --- | --- |
| `apps/api/src/routes/signup.ts` | **new** — `POST /api/signup` plugin |
| `apps/api/src/routes/index.ts` | **new** — `/api/*` route aggregator |
| `apps/api/src/validation/tax-number.ts` | **new** — Tunisian matricule validator |
| `apps/api/src/validation/phone.ts` | **new** — E.164 validator (legacy regex) |
| `apps/api/src/auth/auth.ts` | modify (**Q2/Q8, beyond architect list**) — businessName/contactPhone/taxNumber additionalFields + `baseURL` |
| `apps/api/src/auth/plugin.ts` | modify (**Q3, beyond architect list**) — block raw `POST /auth/sign-up/email` |
| `apps/api/src/env.ts` | modify (**Q8, beyond architect list**) — `BETTER_AUTH_URL` (default `http://localhost:4000`) |
| `apps/api/src/server.ts` | modify — register the `/api/*` aggregator |
| `apps/api/vitest.config.ts` | modify (**Q7, beyond architect list**) — read real `DATABASE_URL` from env for integration tests |
| `apps/api/.env.example` | modify (**Q8**) — add `BETTER_AUTH_URL` |
| `apps/api/tests/signup.test.ts` | **new** — real-Postgres integration tests |
| `apps/api/tests/helpers/db-test-setup.ts` | **new** — truncate/setup helpers |
| `.github/workflows/ci.yml` | modify — Postgres service container + migrate step + test env |

**Out of scope (unchanged from architect SCOPE-OUT):** real email send (Commit
4, OVH SMTP), sign-in/out/refresh (Phase 1d), onboarding (Phase 1c), admin
approval (Phase 1f), frontend (Phase 1e), OAuth, password reset, rate limiting.

---

## §2 — Inventory phase & CF-23 better-auth findings

All verified against installed `better-auth@1.6.11` — `dist/api/routes/sign-up.mjs`
read directly (not docs, not recall).

### F1 (CRITICAL, security → Q1) — duplicate email is masked, not an error

`sign-up.mjs:160`:
`shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false`.
Our config has `requireEmailVerification: true` → **true**. So on a duplicate
email (`:165` `dbUser?.user`), better-auth hashes a throwaway password (timing
defense) and **returns a generic synthetic `{ token: null, user }` (`:200`) —
identical in shape to a real signup**. The `throw UNPROCESSABLE_ENTITY
USER_ALREADY_EXISTS` (`:205`) is **unreachable** in our config.

This is an intentional **email-enumeration defense**. Decision 5's
`email → 409 EMAIL_TAKEN` cannot be honored without us pre-checking the email
ourselves and thereby **re-introducing the enumeration vulnerability** the
Commit-2 posture (verification-required, input:false) was building toward.

**Recommend (Q1): drop `EMAIL_TAKEN`.** `/api/signup` returns **201 generic**
for both new and duplicate emails ("check your email"). The duplicate simply
creates no new row. (Commit 4's real email step can send an "account already
exists — sign in / reset" email to the duplicate address — the secure UX —
but that's Commit 4.) Surfaced per rule 10.

### F2 (security → Q2 + Q3) — business fields persistence + raw-route bypass

- `sign-up.mjs:162,222`: `additionalUserFields = parseUserInput(options, rest,
  "create")` → `createUser({ email, name, image, ...additionalUserFields })`.
  Only keys registered in `options.user.additionalFields` are written.
  `business_name`/`contact_phone`/`tax_number` are **not** registered (Commit 2
  added only role/status) → **they'd be silently dropped.**

  **Recommend (Q2): register `businessName`, `contactPhone`, `taxNumber` as
  additionalFields** (`input: true`, `required: false`) in `auth.ts`. They are
  real `users` columns already (Commit 1); registering them lets `createUser`
  write them **atomically with the user row**. `required: false` keeps
  better-auth from coupling other internal flows to them — `/api/signup`'s zod
  schema is the authority on presence. (Modifies `auth.ts` — beyond the
  architect's file list.)

- The Commit-2 catch-all (`plugin.ts`, `/auth/*`) exposes the raw
  `POST /auth/sign-up/email`. It does **not** run our format validation.
  *Privilege escalation is already blocked* (role/status `input:false` →
  dropped client-side, verified Commit 2), so this is a **data-integrity**
  hole, not a privilege one: the raw route can create accounts with missing /
  unvalidated business fields, bypassing `/api/signup`.

  **Recommend (Q3): block `POST /auth/sign-up/email` in the catch-all** (return
  404), leaving sign-in / get-session / sign-out / verify-email open. Makes
  `/api/signup` the only signup path. (Modifies `plugin.ts` — beyond the
  architect's file list. Note: cannot use `emailAndPassword.disableSignUp` —
  `sign-up.mjs:142` shows it also disables the server-side `auth.api.signUpEmail`
  we depend on.)

### F3 (→ Q4) — signup is sequential, NOT atomic across the three tables

`sign-up.mjs`: `createUser` (`:218`) → `linkAccount` (`:233`) →
verification-token create + `sendVerificationEmail` (`:240`) are **separate
sequential `internalAdapter` calls**, not one DB transaction. The **user row
(incl. our additionalFields) is atomic**; the account row and verification
token are best-effort sequential. better-auth exposes no transaction handle to
inject, so the wrapper **cannot** make all three atomic without forking the
library.

**Recommend (Q4): accept better-auth's sequential model; do NOT add transaction
wrapping.** This corrects Decision 2/9's "atomic transaction (signup +
verification in one DB write group)" premise — it is partly inaccurate for
better-auth 1.6.11. The failure window (createUser ok, linkAccount fails) yields
an orphan user with no credential — rare, recoverable (retry / cleanup job),
and is better-auth's own accepted behavior. Surfaced as a documented limitation.

### F4 (→ confirm) — error codes & return shape

- Return on our config: `{ token: null, user: <User> }` (`:249`,
  no session/cookie — verification gates sign-in). We map
  `user.id`/`user.email` → Decision-4 shape.
- Real errors throw `APIError` (e.g. `PASSWORD_TOO_SHORT` 400,
  `FAILED_TO_CREATE_USER` 422). Since `/api/signup` zod-validates first, these
  are rare; we catch `APIError` → 400, anything else → 500.
- `auth.api.signUpEmail` is a callable function on the constructed instance
  (verified at plan-time via tsx: `typeof auth.api.signUpEmail === 'function'`).

### F5 (→ Q5) — tax_number conflict IS detectable (unlike email)

tax_number is our column (UNIQUE), not better-auth's. We **pre-check it**
(`SELECT … WHERE tax_number = …`) before calling signUpEmail and return
**409 TAX_NUMBER_TAKEN** (Decision 5, tax half). tax_number is a semi-public
business identifier (matricule appears on invoices) — enumeration risk is far
lower than email, so a clean 409 is acceptable. **Recommend Q5: keep.**

### F6 (→ Q6) — tax_number format: legacy has NO constraint

Schema inventory **§2.2** (line 72): `tax_number text NOT NULL UNIQUE` —
**no CHECK/format regex**. The legacy accepted any non-empty unique string.
Decision 6's matricule regex (`\d{7}[A-Z]?(\/\d{3})?[A-Z]?`) is therefore a
**new** constraint with no legacy precedent, and the true Tunisian *matricule
fiscal* format is non-trivial and has varied over time (money/identity-adjacent
— rule 10). A too-strict regex **false-rejects real businesses at signup**.

**Surface (Q6) — architect to rule.** Options:
- (a) **Adopt Decision 6 regex** (anchored: `^\d{7}[A-Z]?(\/\d{3})?[A-Z]?$`).
  Risk: false rejections.
- (b) **Lenient now, strict later (recommend):** validate non-empty +
  length/charset bound (e.g. `^[A-Za-z0-9/]{6,20}$`), defer the precise
  matricule format to Phase 1c onboarding (legacy had none; don't gate signup
  on an unverified pattern). Validator lives in one isolated file, trivially
  tightened later.

### F7 (→ Q7, required for integration tests) — vitest DB wiring

`vitest.config.ts` currently **hard-codes** `env.DATABASE_URL =
postgresql://test:test@localhost:5432/test_db`, which **overrides**
`process.env` — integration tests would never reach a real DB.

**Recommend (Q7): `DATABASE_URL: process.env['DATABASE_URL'] ?? '<fallback>'`**
(same for AUTH_SECRET). CI/local set the real URL; unit suites keep the fallback
(postgres.js lazy-connects, so DB-free tests are unaffected). Necessary for the
integration suite. (Modifies `vitest.config.ts` — beyond the architect's list.)

### F8 (→ Q8, soft) — verification URL needs baseURL

`sign-up.mjs:242`: `url = ${ctx.context.baseURL}/verify-email?token=…`. With
baseURL unset (the Q7-deferred WARN), the **logged verification URL is
malformed** (the *token itself is valid and stored*). Commit 3's scope names
"verification token machinery"; the token works without baseURL, only the link
string is cosmetic until Commit 4's real send.

**Surface (Q8):** (a) **keep deferred** to Commit 4 (token still tested), or
(b) **set `BETTER_AUTH_URL` now** (one env line) so the link is well-formed and
the integration test can assert a valid URL. *Lean (b)* — trivial, and it makes
the "token machinery" observably correct this commit.

### F-import (execution-verify) — APIError import path

`/api/signup` needs `APIError` for the `instanceof` catch. Source imports it
from `@better-auth/core/error`; the public re-export is likely `better-auth/api`
or `better-auth`. **Resolved at 2.1** against installed exports; fallback noted.

### Integration-test isolation (inventory #5)

- `signup.test.ts` is the **only** DB-writing suite (db/auth/env/error/health
  stay DB-free) → no cross-file DB contention; vitest runs tests **within a file
  sequentially**, so `beforeEach` truncate is safe. Keep non-`concurrent`.
- Reset: `TRUNCATE users, accounts, sessions, verifications RESTART IDENTITY
  CASCADE` in `beforeEach` (FK CASCADE from users covers accounts/sessions;
  verifications truncated explicitly).
- Schema must exist first: **CI runs `migrate` before `test`**; locally the
  developer brings up Docker Postgres + runs migrate (documented in the helper).

### GitHub Actions service container (inventory #6)

Current `ci.yml` has one `verify` job, no services, `pnpm test` runs all
packages. Add a `services.postgres` block (current Actions schema: `services:`
under the job), `ports: ['5432:5432']`, health via `options:` `--health-cmd`,
job-level `env` (DATABASE_URL + AUTH_SECRET), and a **Migrate** step before
**Test**. typecheck/lint/build steps unaffected (DB-free). §11 has the diff.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **3.0** | Plan (this file). Halt; surface Q1–Q8; ratify; commit + push (CF-6). |
| **3.1** | routes + validation + auth.ts/plugin.ts/vitest deltas + integration tests + helper + ci.yml. Halt; CF-9; ratify; push (CF-7). |

3.1 is **judgment-dense** (it resolves F1–F8 + the tax/phone regexes), not
mechanical — hence the heavy plan-phase surfacing.

---

## §4 — Per-commit verification gates

### Gate 2 — per-package (apps/api floor: test 21 → 32)
```bash
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 32 (needs Postgres for signup.test.ts)
pnpm --filter @toodooh/api build       # success
```

### Gate 3 — root no-regression vs `1648159`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 181 | **192** (+11 signup) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — boot + live signup (local Docker Postgres)
```bash
docker compose -f infra/docker-compose.yml up -d postgres
cp apps/api/.env.example apps/api/.env   # set AUTH_SECRET (+BETTER_AUTH_URL if Q8=b)
pnpm --filter @toodooh/api migrate
pnpm --filter @toodooh/api dev
# POST /api/signup valid → 201 {userId,email,verificationRequired,message}
#   psql: users +1, accounts +1 (provider 'credential'), verifications +1
#   pino: verification stub fired with token
# POST /api/signup same email      → 201 generic, users count unchanged (F1)
# POST /api/signup same tax, new email → 409 TAX_NUMBER_TAKEN (F5)
# POST /api/signup password<12 / bad phone / bad tax → 400 + fields[]
# POST /auth/sign-up/email (raw)   → 404 (Q3 block)
# POST /api/signup role:'superadmin' → created user role still 'advertiser' (F2/Commit2)
```

### Gate 5 — CI with Postgres service container
Service starts, healthcheck passes, migrate applies, integration tests connect
and pass. On red: surface the workflow logs section showing container/migrate
state.

---

## §5 — Standing operating procedure

CF-6 for 3.0; CF-7 for 3.1 (gate sweep → boot/live-signup verify → CF-9 →
ratify → push → CI). Node-20 PATH prefix; heap bump on commit. CF-18 re-sweep
before first Write. CF-23 source verification done plan-time (§2); F-import
resolved at execution.

---

## §6 — Hard-halt conditions

1. Q1–Q3 unratified — they change the endpoint's contract and the auth/plugin
   config; no code until ruled.
2. `auth.api.signUpEmail` rejects inline additionalFields, or the adapter won't
   write businessName/contactPhone/taxNumber (verify Gate 4 row counts) — halt.
3. Blocking `/auth/sign-up/email` also breaks sign-in/get-session/verify-email
   (catch-all filter too broad) — halt.
4. Integration tests can't isolate (state leaks between tests) — halt, propose
   fix.
5. CI Postgres service won't start / migrate fails in CI — surface logs, halt.
6. tax_number/phone validator rejects a value the legacy CHECK would have
   accepted (phone) — halt (phone must match legacy `^\+[1-9]\d{1,14}$`).
7. Any gate regresses vs `1648159`.
8. `APIError` import path resolves from neither candidate — halt.

---

## §7 — Risk register

| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| 409 EMAIL_TAKEN reintroduces enumeration | **Resolved by Q1** | security | drop EMAIL_TAKEN; 201 generic |
| business fields silently dropped | **Resolved by Q2** | Gate 4 row counts | register additionalFields |
| raw /auth/sign-up/email bypasses validation | **Resolved by Q3** | Gate 4 raw POST | block in catch-all |
| non-atomic signup → orphan user | Low (accepted) | Gate 4 | documented limitation (F3) |
| tax regex false-rejects real business | Medium | Gate 4 / prod | Q6 lenient-now option |
| vitest never hits real DB | **Resolved by Q7** | Gate 2 signup suite | DATABASE_URL from env |
| CI service container syntax drift | Low | Gate 5 | current Actions schema (§11) |
| APIError import path wrong | Medium | Gate 2 typecheck | F-import execution-verify + fallback |
| signUpEmail needs `headers` arg | Low | Gate 2 test | pass `headers: new Headers()` if required |
| test parallelism DB contention | Low | Gate 2 | only signup suite writes; sequential |

---

## §8 — Cross-references

- `00-PROJECT_HANDOFF.md` §4 — stateful sessions; authorization is middleware.
- `supabase-schema-inventory.md` §2.2 (tax_number NO format CHECK; contact_phone
  CHECK `^\+[1-9]\d{1,14}$`), §9 (dual-identity collapse; "screenhost signup
  endpoint" is this commit).
- `better-auth@1.6.11` `dist/api/routes/sign-up.mjs` — anti-enumeration (:160),
  additionalFields write (:162/:222), sequential calls (:218/:233/:240),
  return shape (:249).
- `docs/audit.md` §12 (Phase 1a), §11 (P0a/P0b). Prior: `1648159` (Commit 2).
- Methodology: `docs/handoff/methodology-and-prompt-format.md`.

---

## §9 — Carry-forward methodology

- **CF-9** — 3.1 pause summary: full `signup.ts`, `signup.test.ts` outline +
  outputs, `ci.yml` diff, Gate-4 live-signup row counts, all gates, CI run.
- **CF-10** — floor re-confirmed plan-time (§0).
- **CF-18** — swept clean (§0).
- **CF-21** — `vitest.config.ts` env shim extended again (F7) — third instance.
- **CF-22 — sixth instance.** F1 (anti-enumeration vs Decision 5), F2 (business
  fields + raw-route bypass), F3 (atomicity premise) are locked-intent-vs-
  library-reality conflicts surfaced for ratification. Promote at audit refresh.
- **CF-23 — third worked instance.** Reading `sign-up.mjs` directly caught the
  enumeration-masking, the additionalFields write-path, and the sequential
  (non-atomic) reality — none of which are obvious from the API surface.
  Strengthens promotion.

---

## §10 — Push policy + sequencing

**3.0** — `git add` plan; `docs(phase-1b): plan Commit 3 — signup endpoint`;
push; `gh run watch` (CF-6). Under Node 20.

**3.1** — `git add apps/api .github`; commit (body: endpoint + the ratified
F1–F8 resolutions + CF movement); push; `gh run watch` (CF-7). Under Node 20.
No `Co-Authored-By`.

---

## §11 — Exact file contents (Commit 3.1)

> Reflects the **recommended** resolutions (Q1 drop EMAIL_TAKEN, Q2 register
> additionalFields, Q3 block raw route, Q4 no-tx, Q5 tax pre-check, Q6 **lenient**
> tax regex, Q7 env DATABASE_URL, Q8 set BETTER_AUTH_URL). Adjusts to the
> architect's actual rulings before code.

### `apps/api/src/validation/phone.ts` (new)
```ts
// Legacy parity: business_profiles.contact_phone CHECK valid_phone
// (supabase-schema-inventory §2.2). E.164: '+' then 1-15 digits, first 1-9.
const E164 = /^\+[1-9]\d{1,14}$/;

export const validatePhone = (value: string): boolean => E164.test(value);
```

### `apps/api/src/validation/tax-number.ts` (new — Q6 lenient, verification-backed)
```ts
// Q6 verification (plan-time, ratified): THREE authoritative project sources
// all enforce non-empty only, NO format — legacy schema §2.2 (NOT NULL UNIQUE,
// no CHECK), apps/web (.trim() only, OwnerSettings.tsx:274), and the legacy
// validation fn (fix-business-profiles.sql:40 "cannot be null or empty"). Zero
// sample tax_number values exist to validate a pattern, and the official DGI
// matricule fiscal format is non-trivial/variable and unverifiable. Per the Q6
// ruling, real uncertainty → lenient fallback. Strict matricule validation is
// deferred to Phase 1c onboarding (one isolated file to tighten later).
const TAX_NUMBER = /^[A-Za-z0-9/]{7,20}$/;

export const validateTaxNumber = (value: string): boolean => TAX_NUMBER.test(value);
```

### `apps/api/src/env.ts` (modify — Q8: BETTER_AUTH_URL, default avoids CF-21 cascade)
```ts
  // Optional with a dev default so tests/local need no shim (no CF-21 cascade);
  // production overrides to https://api.too-dooh.com (documented, Phase 1g).
  BETTER_AUTH_URL: z.string().url().default('http://localhost:4000'),
```

### `apps/api/.env.example` (modify — Q8)
```
# better-auth base URL — used to build verification links.
# Local dev default is http://localhost:4000; production: https://api.too-dooh.com (Phase 1g).
BETTER_AUTH_URL=http://localhost:4000
```

### `apps/api/src/auth/auth.ts` (modify — F2/Q2 additionalFields + Q8 baseURL)
```ts
export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL, // Q8 — well-formed verification URLs
  basePath: '/auth',
  // … database / emailAndPassword / emailVerification unchanged …
  user: {
    additionalFields: {
      role: { type: 'string', required: false, input: false, defaultValue: 'advertiser' },
      status: { type: 'string', required: false, input: false, defaultValue: 'pending' },
      // Commit 3 — business profile fields, client-settable, written atomically
      // with the user row by signUpEmail. /api/signup's zod schema is the
      // authority on presence/format; required:false avoids coupling other
      // better-auth flows to these.
      businessName: { type: 'string', required: false, input: true },
      contactPhone: { type: 'string', required: false, input: true },
      taxNumber: { type: 'string', required: false, input: true },
    },
  },
```

### `apps/api/src/auth/plugin.ts` (modify — F2/Q3: block raw signup)
```ts
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (request, reply) => {
      // /api/signup is the only validated signup path; block the raw endpoint
      // (privilege is already safe via input:false — this guards format/data
      // integrity). Other /auth/* routes (sign-in, get-session, sign-out,
      // verify-email) pass through.
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'POST' && path === '/auth/sign-up/email') {
        return reply.status(404).send({ error: 'Not Found', message: 'Use POST /api/signup' });
      }
      // … existing fromNodeHeaders → auth.handler → reply forwarding …
    },
  });
```

### `apps/api/src/routes/signup.ts` (new — full)
```ts
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { auth } from '../auth/auth.js';
import { db } from '../db/client.js';
import { accounts, users } from '../db/schema.js';
import { validatePhone } from '../validation/phone.js';
import { validateTaxNumber } from '../validation/tax-number.js';

// Q4 — better-auth's signup is sequential, not atomic (createUser → linkAccount
// → verification are separate calls; no injectable tx). If linkAccount throws
// after createUser, an orphan user (no credential account) can remain. Best-
// effort cleanup; the `if (acct) return` guard means a real (account-backed)
// user is never deleted, and the anti-enumeration duplicate path never reaches
// the catch (it returns success, F1). Cleanup is guarded by the caller so it
// never masks the original error.
const deleteOrphanUser = async (email: string): Promise<void> => {
  const normalized = email.toLowerCase();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (!u) return;
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, u.id))
    .limit(1);
  if (acct) return; // account-backed → real user, not an orphan
  await db.delete(users).where(eq(users.id, u.id));
};

// snake_case request shape (apps/web-facing per Decision 3); role/status are
// NOT accepted — they default server-side (input:false, Commit 2).
const signupBodySchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(1).max(100),
  business_name: z.string().min(1).max(200),
  contact_phone: z.string().refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)'),
  tax_number: z.string().refine(validateTaxNumber, 'Invalid tax number format'),
});

export const signupRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/signup', async (request, reply) => {
    const parsed = signupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { email, password, name, business_name, contact_phone, tax_number } = parsed.data;

    // tax_number is ours (UNIQUE) — pre-check for a clean 409 (email dupes are
    // masked by better-auth's anti-enumeration, F1, so no EMAIL_TAKEN).
    const taxOwner = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.taxNumber, tax_number))
      .limit(1);
    if (taxOwner.length > 0) {
      return reply.status(409).send({
        error: 'TAX_NUMBER_TAKEN',
        message: 'A business with this tax number is already registered.',
        fields: [{ field: 'tax_number', reason: 'already registered' }],
      });
    }

    try {
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
          businessName: business_name,
          contactPhone: contact_phone,
          taxNumber: tax_number,
        },
      });
      return reply.status(201).send({
        userId: result.user.id,
        email: result.user.email,
        verificationRequired: true,
        message: 'Account created. Please check your email to verify your address.',
      });
    } catch (err) {
      // Q4 — best-effort orphan cleanup; guarded so it never masks `err`.
      await deleteOrphanUser(email).catch(() => undefined);
      // APIError import path resolved at install (F-import). Known better-auth
      // errors → 400 (rare; we pre-validated). Anything else → 500.
      if (err instanceof Error && err.name === 'APIError') {
        return reply.status(400).send({ error: 'INVALID_INPUT', message: err.message, fields: [] });
      }
      request.log.error(err, 'signup failed');
      return reply
        .status(500)
        .send({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' });
    }
  });
};
```
*(Note: the `instanceof Error && err.name === 'APIError'` form avoids depending
on an unverified import path; if `better-auth/api` cleanly exports `APIError`,
2.1 switches to a real `instanceof APIError`.)*

### `apps/api/src/routes/index.ts` (new)
```ts
import type { FastifyPluginAsync } from 'fastify';

import { signupRoute } from './signup.js';

// Aggregates all application-shaped /api/* routes. Future routes
// (/api/onboarding, /api/admin/users) register here.
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(signupRoute);
};
```

### `apps/api/src/server.ts` (modify)
```ts
import { apiRoutes } from './routes/index.js';
// …
    await app.register(authPlugin);
    await app.register(apiRoutes);
    await app.register(healthRoute);
```

### `apps/api/vitest.config.ts` (modify — F7/Q7)
```ts
    env: {
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'postgresql://test:test@localhost:5432/test_db',
      AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'test-auth-secret-at-least-32-characters-long',
    },
```

### `apps/api/tests/helpers/db-test-setup.ts` (new)
```ts
import { sql } from '../../src/db/client.js';

// Truncate all auth tables (FK CASCADE from users covers accounts/sessions;
// verifications has no FK). Call in beforeEach for per-test isolation.
export const resetAuthTables = async (): Promise<void> => {
  await sql`TRUNCATE users, accounts, sessions, verifications RESTART IDENTITY CASCADE`;
};
```

### `apps/api/tests/signup.test.ts` (new — integration, **11 tests locked**, outline)
```ts
// Requires a real Postgres (DATABASE_URL env). beforeEach: resetAuthTables().
// Build a Fastify app with authPlugin + apiRoutes (logger:false).
//  1. valid payload → 201, body {userId,email,verificationRequired:true,message}
//  2. valid payload → users +1, accounts +1 (providerId 'credential'), verifications +1
//  3. (Q8) stub fires + verification URL well-formed — pino spy, url starts with
//     'http://localhost:4000/verify-email?token=' and token is non-empty
//  4. duplicate email → 201 generic (F1), users count unchanged (no 2nd row)
//  5. duplicate tax_number (new email) → 409 TAX_NUMBER_TAKEN + fields[]
//  6. password < 12 → 400 INVALID_INPUT, field 'password'
//  7. invalid email format → 400, field 'email'
//  8. invalid phone (no +) → 400, field 'contact_phone'
//  9. invalid tax_number (charset) → 400, field 'tax_number'
// 10. payload with role:'superadmin' → created user.role === 'advertiser' (F2 guard)
// 11. internal error → 500 (mock auth.api.signUpEmail to throw non-APIError)
```
**Count locked: apps/api 21 → 32 (+11), root 181 → 192.**

### `.github/workflows/ci.yml` (modify — service container + migrate)
```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://toodooh:toodooh@localhost:5432/toodooh_test
      AUTH_SECRET: ci-auth-secret-at-least-32-characters-long
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: toodooh
          POSTGRES_PASSWORD: toodooh
          POSTGRES_DB: toodooh_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U toodooh -d toodooh_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      # … checkout, pnpm, node 20.20.2, install (unchanged) …
      # NEW step, before Test:
      - name: Migrate (integration DB)
        run: pnpm --filter @toodooh/api migrate
      # Typecheck / Lint / Test / Build steps unchanged (Test now reaches Postgres)
```

---

## §12 — Fire instruction

This is **Commit 3.0** (plan). **All eight micro-decisions RATIFIED** by the
architect; §11 reflects them. On push, CF-6 docs flow under Node 20.

**Ratified rulings (locked):**

- **Q1 (CRITICAL, security) — DROP `EMAIL_TAKEN`; 201 generic** for new +
  duplicate emails (preserves better-auth's enumeration defense; overrides
  Decision 5, email half).
- **Q2 — register businessName/contactPhone/taxNumber as additionalFields**
  (input:true) in `auth.ts` — else dropped at signup.
- **Q3 (security) — 404 the raw `POST /auth/sign-up/email`** in the plugin
  (sign-in / get-session / verify-email stay open).
- **Q4 — accept sequential non-atomic signup; no tx wrapping**, BUT add
  best-effort **orphan-rollback** in the catch (`deleteOrphanUser`, guarded).
  Corrects the Decision 2/9 "atomic" premise.
- **Q5 — tax_number 409 via pre-check** before signUpEmail.
- **Q6 — VERIFIED at plan-time → LENIENT.** Three authoritative sources (legacy
  schema §2.2, apps/web `.trim()`, legacy `fix-business-profiles.sql`) enforce
  non-empty only; zero samples; official matricule format unverifiable → real
  uncertainty → lenient `^[A-Za-z0-9/]{7,20}$` per the ratified fallback. Strict
  matricule deferred to Phase 1c. *(Flagged for architect override before 3.1.)*
- **Q7 — vitest reads real `DATABASE_URL`/`AUTH_SECRET` from env** (fallback
  retained).
- **Q8 — SET `BETTER_AUTH_URL` now** — env default `http://localhost:4000`
  (avoids CF-21 cascade), prod `https://api.too-dooh.com` documented (Phase 1g);
  `auth.ts` `baseURL`; +1 well-formed-URL test.

**Acknowledged:** four file touches beyond the original SCOPE-IN (auth.ts,
plugin.ts, env.ts, vitest.config.ts — forced by Q2/Q3/Q7/Q8); **count locked**
apps/api 21 → 32 / root 181 → 192; F-import APIError execution-verify; CI
Postgres service container + migrate step. CF-21 third instance + CF-22 sixth +
CF-23 third worked instance (§9).
