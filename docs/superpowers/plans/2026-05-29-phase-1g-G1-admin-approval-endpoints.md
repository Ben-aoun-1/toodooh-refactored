# Phase 1g · G1 — admin approval endpoints + requireAdmin guard

**Date:** 2026-05-29 · **Phase 1g commit 2 of 4** (G0 shipped / **G1 this** / G2 / G3) ·
**Companion:** `docs/handoff/phase-1g-admin-scoping.md` (ratified) + the G1 scoping CF-9
(ratified 2026-05-29; D-G1-1…7 ruled — this plan incorporates it inline, no intermediate
scoping commit per D-G1-7). **HEAD:** `1a49044` · **Floor:** apps/api typecheck 0 / lint 0 /
test 146; apps/web typecheck 34 / lint 1 / test 217 / build 134.53.

**Goal.** The backend for admin approval: a `requireAdmin` guard (sibling to `requireAuth`) +
four `/api/admin/*` endpoints — the pending/approved/rejected **queue**, **approve**, **reject**,
and **document review** (presign another user's doc) — each integration-tested on the 1b-1e
pattern. **BE-ONLY** — `apps/web` is untouched (G2 is the FE repoint). Built WITH G2's consumer
(`UserManagement.tsx`, currently dead-Supabase) in mind — keystone discipline, no speculative
middleware.

---

## §0 — Source-confirm (CF-23, verified at plan-write)

- **The keystone — `middleware/require-auth.ts:23-40`:** `requireAuth` validates the session,
  401-shapes on null, attaches `request.user = {id, role, status}`. `AuthUser.role: string`
  exists (`:6-10`). `require-auth.test.ts:20-34` proves a session carrying `role` flows through.
  → `requireAdmin` is its role-gated sibling: composed via a preHandler **array**, reads the
  already-attached `request.user.role`, no second `getSession`.
- **`role`/`status` are server-controlled session fields** — `auth.ts:126-128`
  (`input:false`, defaults `advertiser`/`pending`); clients cannot self-elevate. ✓ secure.
- **The approval substrate is READY (no schema change):** `userStatus` enum
  `pending|approved|rejected` (`schema.ts:32`), `onboardingCompleted` (`:81`), the validation
  trio `validatedBy`/`validatedAt`/`validationNotes` (`:49-51`, `validatedBy` is a
  self-FK→`users.id`). `users_status_idx` exists (`:109`) — the queue filter is indexed.
- **The route + response patterns to mirror:**
  - registration: `routes/index.ts:13-22` (`app.register(...)` per plugin; the placeholder
    comment names `/api/admin/users`).
  - the `/api/me` projection (`me.ts:22-82`) — the exact snake_case field set G2 renders +
    `toProfileType(role, businessType)` (`lib/profile-type.ts`).
  - the doc-presign (`profile-documents.ts:104-147`) — `GET /api/profile/documents/:type`,
    `typeParamSchema = z.enum(['rne','cin'])`, key lookup, **404 on null key**,
    `storage.getPresignedUrl({key})` → `{url}` | 502.
  - zod param/query validation + the shaped-400 `{error:'INVALID_INPUT',message,fields}`
    (`profile.ts`, `profile-documents.ts:32-39`). `z.uuid()` is the in-use API (`profile.ts:26`).
- **`StorageProvider.getPresignedUrl({key, expiresInSeconds?})`** → `{url}` | `{error}`
  (`storage/provider.ts:11`); the singleton is `storage` from `s3-storage.js`.
- **The G2 consumer (read-only, informs the shape — `admin-user.service.ts` + `UserManagement.tsx`):**
  - table row renders `contact_name`, `business_name`, `contact_phone`, `profile_type`,
    `status`, `created_at` (`UserManagement.tsx:634-652`); approve/reject buttons gate on
    `status === 'pending'` (`:668`).
  - detail modal adds `email`, `business_type`, `tax_number`, `street_address`, `city`,
    `postal_code`, `zone`, `agent_code`, document presence + "Voir le document" (`:820-1100`).
  - **functional reductions** (BE models none — audit §17.1): `verification_status` (was a
    Supabase mirror of `status`), `cin` *number*, `number_of_screens`, `formule`,
    `company_size`. **G1 invents no columns for these** (D-G1-2); G2 renders "Non fourni".
  - the FE `id`-vs-`user_id` split collapses — one `users` table; `:id` = `users.id`.

**Halt-on-finding** if any of the above differs at execution.

> **§0 amendment (CF-22 surface, ratified at execution).** The scoping inferred the queue's
> *response shape* but missed the dead-Supabase consumer's *filter logic*: `admin-user.service.ts:50-60`
> fetched `admin_profiles` and excluded those users from the queue. Under the role-on-users collapse
> the equivalent is **excluding `role ∈ {admin, superadmin}`** from `GET /api/admin/users`. A test
> (`status=approved`) caught it (the seeded superadmin actor appeared in the approved list). Ruled:
> add the role exclusion — it is the correct implementation of "the moderation queue for end-users",
> not a filter bolted on. **Scope: the list only**; approve/reject/doc-review take an explicit `:id`
> and are legitimate for any user (the idempotency-409 is the natural backstop for an already-decided
> admin). G3 scoping-discipline note: *when scoping a list endpoint, infer the filter behavior from
> the dead consumer's service logic, not just the response shape.*

---

## §1 — Locked constraints

- **No schema change, no migration** — the status enum + trio + onboarding column all exist.
- **BE-only** — zero `apps/web` files. G2 repoints the consumer.
- **Admin = `role ∈ {admin, superadmin}`** (D1). No `moderator`, no `permissions[]`.
- **`requireAdmin` composes, not duplicates** — `{ preHandler: [requireAuth, requireAdmin] }`;
  401 from `requireAuth` (no session), 403 from `requireAdmin` (authenticated, not admin).
- **One list endpoint with a required `status` filter** (D-G1-3): `/api/admin/users?status=…`,
  not `/api/admin/pending-users`. Forward-compatible with G2's all/approved/rejected tabs.
- **Reject notes REQUIRED, non-empty** (D-G1-4, CF-24 class-b — the rebuild establishes the
  contract the dead-Supabase FE lacked). Approve notes optional.
- **409 on same-state repeat** (D-G1-6), body carries the prior validation info.
- **No `admin_activities` action-log** (D4 — approval self-audits via the trio).
- **No pagination, no bulk endpoints** in G1 (the FE paginates client-side; bulk is a G2/later
  concern — surface, don't build). No speculative filters beyond `status`.

## §2 — Change set per file

### §2.A — `apps/api/src/middleware/require-auth.ts` — append `requireAdmin`
Add an `ADMIN_ROLES` set + a `requireAdmin` preHandler that reads the `request.user.role` set by
`requireAuth` (assumes the array-compose order) and 403-shapes on non-admin. **Judgment** (the
guard contract). No change to `requireAuth`.

### §2.B — `apps/api/src/routes/admin.ts` — NEW, the four endpoints
One cohesive plugin `adminRoutes` (slice-1 admin surface; split later if it grows). A private
`toAdminUserView(row)` maps the selected columns → the snake_case view (mirrors `me.ts`'s
mapping + `created_at` + the trio). **Judgment** (endpoint logic). The four routes:

1. **`GET /api/admin/users`** — `status` query required (`z.enum(['pending','approved','rejected'])`,
   400 on missing/invalid). Single-table select on `users` (no join — the collapse), the `/api/me`
   projection + `createdAt` + trio,
   `where(and(eq(users.status, status), notInArray(users.role, ['admin','superadmin'])))`,
   `orderBy(desc(users.createdAt))`. `{ users: rows.map(toAdminUserView) }`. **Admin-role exclusion**
   — the queue's semantic is end-user moderation; admin staff (seeded, pre-approved) are not in it
   (ratified finding — see §0 amendment).
2. **`POST /api/admin/users/:id/approve`** — `:id` `z.uuid()` (400 invalid); body
   `{ notes?: string }` (absent body OK). Fetch row → 404 unknown. If `status==='approved'` → 409
   + prior-state body. Else update `status='approved'`, `onboardingCompleted=true`,
   `validatedBy=request.user.id`, `validatedAt=new Date()`, `validationNotes = notes ?? null`
   (approve overwrites the trio). 200 `{ user: toAdminUserView(updated) }`.
3. **`POST /api/admin/users/:id/reject`** — `:id` `z.uuid()`; body `{ notes: string }` **required
   non-empty** (`z.string().trim().min(1)`, 400 missing/empty). Fetch → 404. If
   `status==='rejected'` → 409 + prior-state body. Else update `status='rejected'`, `validatedBy`,
   `validatedAt`, `validationNotes=notes` — **`onboardingCompleted` untouched**. 200 view.
4. **`GET /api/admin/users/:id/documents/:type`** — `:id` `z.uuid()`, `:type` `z.enum(['rne','cin'])`
   (400 invalid). Fetch the doc-key columns for that user → 404 NOT_FOUND (distinct messages:
   unknown user vs no-doc-on-file, **404 on null key per D-G1-1**). `storage.getPresignedUrl({key})`
   → `{url}` | 502. Mirrors `profile-documents.ts:104-147` but keyed by `:id`, not the session user.

### §2.C — `apps/api/src/routes/index.ts` — register `adminRoutes`
Add `import { adminRoutes }` + `await app.register(adminRoutes);` (after `passwordRoutes`, before
the public `referenceRoutes`). **Mechanical.**

### §2.D — shared 409 prior-state body
Both approve + reject emit, on same-state repeat:
`{ error:'CONFLICT', message:`User already ${status}.`, statusCode:409, requestId, currentStatus, validatedBy, validatedAt, validationNotes }`
so G2 can show "already approved on <date> by <admin>" (D-G1-6).

## §3 — Tests — `apps/api/tests/admin.test.ts` (NEW, 1b-1e pattern)

Real Postgres (+ real MinIO for the doc-review happy paths, exactly as `profile-documents.test.ts`).
`auth.api.getSession` mocked; seed actors + targets via `db.insert(users)` (D-G1-5 — NOT
`create-admin.ts`). A **local `mockSession(userId, role='superadmin', status='approved')` helper**
(D-G1-5: duplication across 4 endpoints is real → one local helper, per-file convention like the
other suites). `resetAuthTables()` in `beforeEach`; `sql.end()` in `afterAll`; MinIO key cleanup in
`afterEach` for the doc tests.

Per-endpoint coverage (the trio asserted on the DB row where written):
- **requireAdmin gate** (exercised through the endpoints): admin→pass, superadmin→pass,
  non-admin (`advertiser`)→**403**, no session→**401**.
- **GET /api/admin/users:** seed 3 users (pending×2 with distinct `createdAt`, approved×1,
  rejected×1); `status=pending` → only the 2 pending, **`created_at` DESC**; `status=approved`
  → the approved; missing `status` → 400; invalid `status` → 400; 403/401 gates.
- **approve:** happy → row `status='approved'` + `onboardingCompleted=true` + **trio**
  (`validatedBy=adminId`, `validatedAt` set, `validationNotes`); notes stored when supplied;
  unknown id → 404; non-uuid id → 400; already-approved → **409 + prior-state body**;
  **rejected→approve allowed** (not 409); 403/401.
- **reject:** happy → `status='rejected'` + trio, **`onboardingCompleted` untouched**; missing
  notes → 400; empty/whitespace notes → 400; unknown id → 404; already-rejected → **409 + body**;
  403/401.
- **doc-review:** seed a doc key + upload a real object → presign returns `{url}` (rne + cin);
  null key → 404; unknown user → 404; invalid `:type` → 400; 403/401.

**Estimate: +24–28 tests.**

## §4 — Gate expectations

| Gate | Baseline | Expected |
|---|---|---|
| apps/api typecheck | 0 | **0** |
| apps/api lint | 0 | **0** |
| apps/api test | 146 | **~170–174** (+24–28, all new admin endpoint tests) |
| apps/api build | success | **success** |
| apps/web (all gates) | 34/1/217/134.53 | **untouched** (zero `apps/web` files) |

Run ROOT `pnpm typecheck && pnpm lint && pnpm test` (CI parity, [[root-lint-vs-scoped]]).

## §5 — Hard-halt conditions
- §0 source-confirm drift (a route/projection/storage signature differs).
- typecheck/lint off 0; apps/web gates move (would mean a stray FE touch).
- A schema gap surfaces (a field the queue must return that no column backs) — surface, don't
  invent a column (D-G1-2 already ruled the known reductions out).
- The doc-review test needs MinIO and CI lacks `STORAGE_*` — surface (the `profile-documents`
  suite already relies on it, so this should hold; flag if not).

## §6 — Sub-factoring
**One commit** (G1). `requireAdmin` has no consumers without the endpoints (anti-keystone to
split); the doc-review presign folds in as the 4th endpoint (D-G1-1, built with its consumer).
Tests land in the same commit (the §7 test bar).

Commit subject: `feat(api): Phase-1g G1 — admin approval endpoints (queue/approve/reject/doc-review) + requireAdmin guard`. No `Co-Authored-By`. CF-7 gate-sweep code-push.

## §7 — Carry-forward / cross-refs
- CF-7 gate-sweep; CF-9 pause-summary; Node 20.20.2 for the commit ([[node-20-required-for-commits]]).
- This is the keystone discipline (requireAdmin built WITH its 4 consumers) + CF-24 (the
  endpoint shapes informed by `UserManagement.tsx`'s render; reject-notes-required is the class-b
  divergence).
- **G3 method note (D-G1-7):** single-commit phases skip the intermediate scoping commit — the
  CF-9 + plan-doc is the scoping deliverable. Record at the audit refresh.
- G2 follows: repoint `admin-user.service`/`useUsers`/the UserManagement UI at these endpoints
  (the `id`/`user_id` collapse, the functional-reduction fields rendered as "Non fourni").

## §10 — Files touched
```
M  apps/api/src/middleware/require-auth.ts   # + requireAdmin sibling (§2.A)
A  apps/api/src/routes/admin.ts              # the 4 endpoints + toAdminUserView (§2.B)
M  apps/api/src/routes/index.ts              # register adminRoutes (§2.C)
A  apps/api/tests/admin.test.ts              # integration tests, 1b-1e pattern (§3)
```
**4 files (2 M + 2 A), all `apps/api`.** No migration, no apps/web, no lockfile.

## §11 — Exact edits

### §2.A — `require-auth.ts` (append after `requireAuth`)
```ts
const ADMIN_ROLES = new Set(['admin', 'superadmin']);

// Admin role gate. Composes AFTER requireAuth in a preHandler array
// ({ preHandler: [requireAuth, requireAdmin] }) — requireAuth attaches request.user and
// 401s on no session; requireAdmin only adds the 403 role check. /api/admin/* existing is
// not a leak, so 403 (not 404) on a non-admin authenticated user.
export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const role = request.user?.role;
  if (role === undefined || !ADMIN_ROLES.has(role)) {
    await reply.status(403).send({
      error: 'FORBIDDEN',
      message: 'Administrator access required.',
      statusCode: 403,
      requestId: request.id,
    });
    return;
  }
};
```

### §2.B — `routes/admin.ts` (new) — shape
```ts
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { toProfileType } from '../lib/profile-type.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { storage } from '../storage/s3-storage.js';

const adminGuard = { preHandler: [requireAuth, requireAdmin] };

const listQuerySchema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
const idParamSchema = z.object({ id: z.uuid() });
const docParamSchema = z.object({ id: z.uuid(), type: z.enum(['rne', 'cin']) });
const approveBodySchema = z.object({ notes: z.string().optional() });
const rejectBodySchema = z.object({ notes: z.string().trim().min(1) });

// snake_case admin view — the /api/me projection + created_at + the validation trio.
// (toAdminUserView selects the same columns me.ts does + createdAt/validatedBy/At/Notes.)
```
- **GET /api/admin/users** — `listQuerySchema.safeParse(request.query)` → 400; select the
  projection + trio, `where(eq(users.status, status)).orderBy(desc(users.createdAt))`;
  `{ users: rows.map(toAdminUserView) }`.
- **POST …/:id/approve** — parse `:id` (400) + body (absent OK); `db.select` the row → 404;
  `status==='approved'` → 409 + prior-state; else `db.update(...).set({ status:'approved',
  onboardingCompleted:true, validatedBy:request.user!.id, validatedAt:new Date(),
  validationNotes: notes ?? null }).where(eq(users.id,id)).returning()`; 200 view.
- **POST …/:id/reject** — parse `:id` (400) + `rejectBodySchema` (400 missing/empty); row → 404;
  `status==='rejected'` → 409 + prior-state; else update `{ status:'rejected', validatedBy,
  validatedAt:new Date(), validationNotes:notes }` (no onboarding touch); 200 view.
- **GET …/:id/documents/:type** — parse params (400); select `{registrationDocUrl, cinDocUrl}`
  for `:id` → 404 if no user; `key = type==='rne'?reg:cin` → 404 if null; `storage.getPresignedUrl`
  → 502 | `{url}`.

### §2.C — `routes/index.ts`
```ts
import { adminRoutes } from './admin.js';
// …in apiRoutes, after passwordRoutes, before referenceRoutes:
await app.register(adminRoutes);
```

## §12 — Status
Drafted, awaiting ratification. BE-only; no schema/migration/apps/web change. On ratification:
§0 re-confirm → apply → ROOT gate-sweep → CF-9 → push. G2 follows.
