# Phase 1c Commit 3 — session-guard middleware + first field-edit endpoint (PATCH /api/profile/business) + schema-touch

The first authenticated endpoint, and the reusable session-guard every later authenticated
route reuses. Per the audit §7.1 ruling (Option B — Model 1 abandoned), there is no separate
onboarding step; profile fields are edited via section-scoped PATCH endpoints. This commit ships
the guard + the richest section (`PATCH /api/profile/business`) + a schema-touch (migration
0004): tax_number lenient CHECK, notify_* columns, and `name`→`contact_name`.

First commit **designed against the frontend contract** (`frontend-backend-contract.md`) — the
first real CF-24 test. Wire field names match the frontend exactly, so Phase-1e is a near-pure
repoint with no field-naming adapter.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `46649d8` (Commit 2 — MinIO + StorageProvider),
CI-green. Floor: apps/api **56** / root **216**; root typecheck 51 / lint 1 / build 139.80.

**CF-18 sweep.** No `apps/api/src/middleware/`. No `routes/profile.ts`. No `contact_name` column
(it's `name`). No `notify_*` columns. No `0004` migration. No tax_number CHECK.

**Node 20 PATH prefix** on every gate + git command; heap bump on commit.

---

## §1 — Locked constraints (architect)

1. **Session-guard built first-class** (Decision 4A) — reusable Fastify preHandler validating a
   better-auth session, attaching `request.user` (id/role/status), shaped-401 on failure. Every
   later authenticated endpoint reuses it. This commit only **validates** sessions; creation is
   Phase-1d sign-in.
2. **`PATCH /api/profile/business`** — section-scoped partial update of the **authenticated
   user's own** profile (id from the guard; never a body/path userId). Partial zod (all optional,
   ≥1 required; empty body → 400). Deferred owner-extras in the body are **ignored cleanly**, not
   errored.
3. **Schema-touch (0004):** 3a tax_number lenient CHECK (nullable already — see §2.6); 3b notify_*
   columns; 3c `name`→`contact_name` rename (VERIFIED supported — §2.1).
4. **B policy** — accept the frontend's exact wire field names (now trivially, columns match).
   Class-(b) security still holds: no privilege fields (role/status NOT in the PATCH schema).
5. role/status attached by the guard but **not editable** here (admin-controlled, Phase 1f).

**Out of scope:** other field endpoints (/contact, /address, /notifications — Commit 4),
documents (Commit 5), owner-extras COLUMNS, sign-in/sign-out/refresh (Phase 1d), admin
role/status (Phase 1f), the notify_* ENDPOINT (Commit 4; columns only here), frontend (Phase 1e).
**Also out (→ Q1):** the signup-route `tax_number` required→optional reversal (a `signup.ts`
change — signup-grows work, not this commit's `schema.ts` scope).

---

## §2 — Inventory & CF-23 verification (verified against installed source)

### §2.1 — THE LOAD-BEARING ONE: better-auth `name`→`contact_name` — VERIFIED, supported ✅
`@better-auth/core/dist/db/get-tables.mjs:133-136`:
```js
name: { ..., fieldName: options.user?.fields?.name || "name" }
```
better-auth 1.6.11 maps its core `name` field to any column via `user.fields.name`. The drizzle
adapter (`@better-auth/drizzle-adapter/dist/index.mjs:81,224`) resolves a field via
`getFieldName({model, field})` then indexes the drizzle table by that key (`schemaModel[field]`,
throws if absent). So `getFieldName` returns the configured value and the adapter accesses
`users[<that value>]` — **the drizzle PROPERTY KEY**, not the DB column name (proven by the
existing `emailVerified` field → `users.emailVerified` property → `email_verified` column).

**Config (exact):**
```ts
user: { fields: { name: 'contactName' }, additionalFields: { /* unchanged */ } }
```
**drizzle:** rename property `name` → `contactName`, column `text('name')` → `text('contact_name')`
⇒ `contactName: text('contact_name').notNull()`. DB column is `contact_name` (3c satisfied);
better-auth's logical `name` round-trips through the `contactName` property → `contact_name`
column. The verification email reads the logical `user.name` (populated on read via the mapping) —
unaffected. **No halt.**

### §2.2 — getSession (the guard's dependency) — verified
`auth.api.getSession` (exported endpoint `/get-session`, `dist/api/index.d.mts:232`,
`requireHeaders: true`). Called server-side as `auth.api.getSession({ headers })` → resolves to
`{ session, user } | null` (null on no/invalid session — the guard branches on null, no throw to
catch for the happy path). Fastify's node headers convert via **`fromNodeHeaders`** from
**`better-auth/node`** (`dist/integrations/node.d.mts`). Execution-time confirmation: the
`require-auth.test.ts` no-session→401 + valid-session→user-attached cases.

### §2.3 — entreprise sub-form wire fields (FE source: `auth.service.ts` updateProfile + signupData)
**Accept:** `business_name`, `tax_number`, `business_sector_id`, `business_type`.
**Ignore (deferred owner-extras, sent by the sub-form, no columns):** `number_of_screens`,
`number_of_rooms`, `company_size`. zod `.strip()` (default) drops unknown keys silently — present
→ ignored, not errored, not stored.

### §2.4 — notify_* (FE source: `auth.service.ts:832-834` + BusinessProfile type)
Exact names + types: `notify_news_updates` boolean, `notify_reminders_events` boolean,
`notify_promotions_offers` boolean. **Defaults (legacy schema-inventory §2.2):**
`notify_news_updates` **false**, `notify_reminders_events` **true**, `notify_promotions_offers`
**false**. Columns only this commit; the endpoint is Commit 4.

### §2.5 — the rename migration: drizzle-kit + RENAME (item 5, the execution risk)
drizzle-kit detects a column rename **interactively** (prompts "is name renamed to contact_name?"),
and interactive prompts aren't supported in this env. **Strategy:** edit schema.ts, run
`drizzle-kit generate`; the snapshot it writes describes the **end state** (column `contact_name`
present, `name` gone) and is correct regardless of how the SQL is phrased. If the generated SQL
expresses the rename as **drop+add** (data-loss) — or if generate can't resolve it
non-interactively — **hand-correct the SQL to `ALTER TABLE "users" RENAME COLUMN "name" TO
"contact_name"`** (the snapshot stays valid — it's end-state, not operation). The additive parts
(notify_* ADD COLUMN, tax CHECK) generate cleanly. **Hard-halt:** if 0004 ships drop+add for the
rename, STOP — verify RENAME + data-preservation (a pre-existing row's value survives) at Gate-4.

### §2.6 — tax_number nullable + lenient CHECK (finding → Q1)
**The column is ALREADY nullable** — `schema.ts:52` is `taxNumber: text('tax_number').unique()`
(no `.notNull()`). The Phase-1b "required" lived only in the **signup-route zod**
(`signup.ts: tax_number: z.string().refine(validateTaxNumber)`), not the column. So 3a at the
schema level reduces to **adding the lenient DB CHECK** (defense-in-depth; the route zod already
validates non-null):
```ts
check('users_tax_number_valid', sql`${table.taxNumber} ~ '^[A-Za-z0-9/]{7,20}$'`)
```
A Postgres CHECK passes on NULL by default, so it constrains only supplied values (same shape as
the existing postal_code CHECK). **Q1:** the signup-route required→optional reversal (audit §7.2)
is a `signup.ts` change, **out of this commit's `schema.ts` scope** — confirm we add only the
CHECK here and defer the route change to signup-grows, OR expand scope.

### §2.7 — guard pattern (item 7) — recommend a preHandler
Recommend an exported `requireAuth` **preHandler** function, attached per-route via
`{ preHandler: requireAuth }` (not a global plugin — not every route is authenticated:
`/health`, `/api/signup`, the better-auth `/auth/*` mount are public). `FastifyRequest` is
augmented (`declare module 'fastify'`) with `user?: AuthUser`. This matches the existing
per-route registration style and is the composable pattern later routes reuse.

### §2.8 — CF-22 watch
- Q1 (tax_number "make nullable" already done; only CHECK new; route reversal out of scope) —
  surfaced.
- No new env vars → no CF-21 cascade this commit (confirm: env.ts untouched).

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **3.0** | Plan (this file). Halt; surface Q1–Q3; ratify; commit + push (CF-6). |
| **3.1** | require-auth.ts + profile.ts + routes/index + schema.ts (3a/3b/3c) + auth.ts mapping + email template + 0004 + tests. Halt; CF-9 (incl. live auth round-trip + RENAME data-preservation); ratify; push (CF-7). |

3.1 judgment seams: the guard's session→401 logic, the rename migration (hand-correct to RENAME),
the deferred-extras ignore-list. The rest is mechanical.

---

## §4 — Per-commit verification gates

### Gate 2 — apps/api per-package
```
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # ~70 (needs Postgres)
pnpm --filter @toodooh/api build       # ok
```

### Gate 3 — root no-regression vs `46649d8`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 216 | **~230** (+~14) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — live (real Postgres, fresh volume)
- 0004 applies; **all 5 migrations clean** on fresh volume.
- `name`→`contact_name` is a **RENAME** (insert a row pre-rename in a scratch check, or inspect
  the SQL is `RENAME COLUMN`) — data preserved, not drop+add.
- tax_number nullable + CHECK present (null accepted; bad format rejected); notify_* present with
  the right defaults; `contact_name` present, `name` gone.
- Auth round-trip: a better-auth signup writes `name`→`contact_name` (verify the column holds the
  value); `auth.api.getSession` with the session → guard attaches user → `PATCH
  /api/profile/business` 200 + fields updated; no session → 401; verification email greets correctly.

### Gate 5 — CI green (Postgres service; no new service needed — MinIO from Commit 2 unaffected).

---

## §5 — Standing operating procedure
CF-6 for 3.0; CF-7 for 3.1. Node-20 prefix; heap bump. CF-18 re-sweep before first Write.
**No new deps expected** (better-auth mapping is config; the guard uses installed better-auth) —
verify `pnpm-lock.yaml` untouched at 3.1; if untouched, no lockfile in the commit.

---

## §6 — Hard-halt conditions
1. better-auth couldn't map `name`→`contact_name` — **RESOLVED §2.1** (it can; no halt).
2. 0004 ships drop+add (not RENAME) for the rename — STOP, hand-correct + verify data-preservation.
3. `auth.api.getSession` behaves unlike §2.2 (can't reliably validate) — surface.
4. Frontend wire field names unrecoverable — RESOLVED §2.3/§2.4.
5. Any gate regresses vs `46649d8`.

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| rename → drop+add data loss | Medium | Gate 4 / 0004 review | hand-correct to RENAME; snapshot is end-state-correct |
| drizzle-kit rename prompt hangs (non-TTY) | Medium | 3.1 generate | hand-author the rename SQL; surface what happened |
| better-auth mapping mis-keyed (DB name vs property) | **Resolved** §2.1 | Gate 4 round-trip | `user.fields.name='contactName'` (property key) |
| `users.name` drizzle refs break after rename | Low | typecheck | grep + update any `users.name` reads (logical `user.name` unaffected) |
| guard 401 shape diverges from error-handler | Low | require-auth.test | match the `{error,message,statusCode,requestId}` shape |

---

## §8 — Cross-references
- `auth/auth.ts` (the betterAuth config to extend with `user.fields`), `email/template.ts`
  (reads logical `user.name`), `routes/signup.ts` + `routes/index.ts` (route registration style),
  `error-handler.ts` (the shaped-error body to match for 401).
- `frontend-backend-contract.md` §3.1/§3.9 (entreprise + notifications sub-forms), §7.1 (Option B),
  §7.2 (tax_number reversal), §7.4 (CF-24 dispositions).
- `supabase-schema-inventory.md` §2.2 (notify_* defaults, postal/tax CHECK precedent).
- `docs/audit.md` §13 (Phase 1b better-auth). Prior `46649d8`.

---

## §9 — Carry-forward methodology
- **CF-9** — 3.1 pause: full file contents + Gate-4 auth round-trip + RENAME data-preservation proof.
- **CF-10** floor re-confirmed (§0). **CF-18** swept (§0).
- **CF-22** — Q1 (tax_number already nullable; route reversal out of scope) surfaced.
- **CF-23** — better-auth field-mapping + getSession + drizzle-adapter resolution verified against
  installed source at plan-write; the live auth round-trip + RENAME are the execution-time layer.
- **CF-24** — first endpoint built to the contract: wire names match the frontend (no Phase-1e
  adapter for this section). The contract drove `contact_name` + the accept/ignore field split.

---

## §10 — Push policy + sequencing
**3.0** — `git add` plan; `docs(phase-1c): plan Commit 3 — session-guard + profile/business`;
push; `gh run watch` (CF-6). Node 20.
**3.1** — `git add apps/api`; commit; push; `gh run watch` (CF-7). Node 20. No `Co-Authored-By`.
**Verify `pnpm-lock.yaml` untouched** (no new deps); if untouched it's not in the commit.

---

## §11 — Exact file contents (Commit 3.1)

### `apps/api/src/middleware/require-auth.ts` (new)
```ts
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from '../auth/auth.js';

export interface AuthUser {
  id: string;
  role: string;
  status: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// Reusable session-guard preHandler. Validates the better-auth session and attaches
// request.user; shaped-401 on no/invalid session. Every authenticated route attaches
// this via { preHandler: requireAuth }. (This commit only VALIDATES sessions; creation
// is Phase-1d sign-in.)
export const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) {
    await reply.status(401).send({
      error: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      statusCode: 401,
      requestId: request.id,
    });
    return;
  }
  request.user = {
    id: session.user.id,
    // role/status are additionalFields on the better-auth user (Commit 2).
    role: (session.user as { role?: string }).role ?? 'advertiser',
    status: (session.user as { status?: string }).status ?? 'pending',
  };
};
```
*(The `as { role?: string }` reads better-auth's additionalFields off the user object; final
typing locked at 3.1 against the better-auth inferred user type — prefer its type over a cast if
clean.)*

### `apps/api/src/routes/profile.ts` (new)
```ts
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateTaxNumber } from '../validation/tax-number.js';

// Section-scoped partial update of the authenticated user's business fields. All fields
// optional; at least one required (empty PATCH → 400). Deferred owner-extras
// (number_of_screens/number_of_rooms/company_size) are stripped by zod (.strip default) —
// the frontend sends them; we ignore, not error. role/status are NOT in this schema.
const businessPatchSchema = z
  .object({
    business_name: z.string().min(1).max(200).optional(),
    tax_number: z.string().refine(validateTaxNumber, 'Invalid tax number format').optional(),
    business_sector_id: z.uuid().optional(),
    business_type: z.enum(['local', 'national', 'agency', 'event_organizer']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.patch('/api/profile/business', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = businessPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const userId = request.user?.id;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }
    // map snake_case wire → drizzle camelCase columns (only supplied keys)
    const patch: Partial<typeof users.$inferInsert> = {};
    if (parsed.data.business_name !== undefined) patch.businessName = parsed.data.business_name;
    if (parsed.data.tax_number !== undefined) patch.taxNumber = parsed.data.tax_number;
    if (parsed.data.business_sector_id !== undefined) patch.businessSectorId = parsed.data.business_sector_id;
    if (parsed.data.business_type !== undefined) patch.businessType = parsed.data.business_type;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      businessName: updated?.businessName ?? null,
      taxNumber: updated?.taxNumber ?? null,
      businessSectorId: updated?.businessSectorId ?? null,
      businessType: updated?.businessType ?? null,
    });
  });
};
```
*(NOTE — wire is snake_case (Decision B/CF-24) but drizzle columns are camelCase; the explicit
field map is the only "adapter" and it's tiny. tax_number FK miss on business_sector_id surfaces
as a DB FK error → 500 via the error-handler, or we pre-check; exact handling locked at 3.1, a Q3
micro-decision.)*

### `apps/api/src/routes/index.ts` — register
```ts
await app.register(profileRoutes);
```

### `apps/api/src/db/schema.ts` — diffs
- **3c:** `name: text('name').notNull()` → `contactName: text('contact_name').notNull()`.
- **3b:** add `notifyNewsUpdates: boolean('notify_news_updates').notNull().default(false)`,
  `notifyRemindersEvents: boolean('notify_reminders_events').notNull().default(true)`,
  `notifyPromotionsOffers: boolean('notify_promotions_offers').notNull().default(false)`.
- **3a:** add to the table's third-arg array
  `check('users_tax_number_valid', sql\`${table.taxNumber} ~ '^[A-Za-z0-9/]{7,20}$'\`)`.

### `apps/api/src/auth/auth.ts` — map name→column (3c)
```ts
  user: {
    fields: { name: 'contactName' }, // logical `name` → drizzle property contactName → column contact_name
    additionalFields: { /* role/status/businessName/contactPhone/taxNumber unchanged */ },
  },
```

### `apps/api/src/email/template.ts`
No change needed — it receives `name` as an argument (auth.ts passes `user.name`, the logical
field, which better-auth populates from the mapped column). Verify at 3.1 the call site still
resolves (`sendVerificationEmail` reads `user.name`).

### `apps/api/drizzle/0004_*.sql` (drizzle-kit + hand-correct the rename per §2.5)
```sql
ALTER TABLE "users" RENAME COLUMN "name" TO "contact_name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_news_updates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_reminders_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_promotions_offers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tax_number_valid" CHECK ("users"."tax_number" ~ '^[A-Za-z0-9/]{7,20}$');
```

### Tests
- `apps/api/tests/require-auth.test.ts` (new): valid session → user attached; no session → 401
  shaped; invalid/expired → 401. (Mock `auth.api.getSession` for the unit-level guard; or
  integration via a real session.)
- `apps/api/tests/profile.test.ts` (new, real Postgres): authed PATCH updates supplied fields;
  partial (only supplied change); unauth → 401; empty body → 400; bad business_sector_id (FK) →
  handled; tax_number null ok / bad-format 400 / valid stored; deferred owner-extras ignored;
  role/status in body not applied.
- `apps/api/tests/db.test.ts` (modify): `contact_name` exists (`name` gone), tax_number nullable,
  notify_* present.
- `apps/api/tests/email.test.ts` (modify if needed): template renders with the mapped name.

**Test delta: apps/api 56 → ~70.** Exact split locked at 3.1.

---

## §12 — Fire instruction
This is **Commit 3.0** (plan). Architect: ratify Q1–Q3; on approval, commit + push docs-only.
**Halt** until then.

- **Q1 — tax_number:** the column is **already nullable**; this commit adds only the lenient DB
  CHECK. The signup-route required→optional reversal is a `signup.ts` change, **out of scope**
  (signup-grows). *Recommend: CHECK only here; defer the route change.*
- **Q2 — name→contact_name** via drizzle property `contactName` + `user.fields.name='contactName'`
  (the verified mechanism, §2.1). *Recommend (it's the verified config).*
- **Q3 — FK-miss handling on `business_sector_id`:** pre-check the sector exists for a clean 4xx,
  or let the DB FK error surface as a 500. *Recommend a pre-check → 400 INVALID_INPUT (consistent
  with signup's TAX_NUMBER_TAKEN pre-check style), lock exact at 3.1.*

Plus acknowledge: guard = per-route preHandler (§2.7); rename hand-corrected to RENAME COLUMN if
drizzle-kit emits drop+add (§2.5); no new deps (lockfile untouched); count lift apps/api 56→~70 /
root 216→~230. CF-22/23/24 in §9.
