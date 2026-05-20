# Phase 1b Commit 1 — users table Drizzle schema + initial migration

First commit of Phase 1b (auth foundation). Phase 1a closed at `dc98e48`
with a bootable backend (Fastify + env + pino + /health + Drizzle +
Postgres + migration runner). This commit lands the **users table** —
the single-identity schema the dual-identity-collapse mandate
(`00-PROJECT_HANDOFF.md` §4, `supabase-schema-inventory.md` §9) requires.

**Schema-only.** better-auth integration = Commit 2; signup endpoint =
Commit 3; email send = Commit 4.

**This plan's CF-22 watch is load-bearing.** The architect-locked schema
must be compatible with better-auth's expected `user`/`account`/`session`
shape so Commit 2 maps cleanly *without renaming*. I verified better-auth's
current schema via Context7 (`/better-auth/better-auth`). Findings 1–6 in
§2 are the compatibility surface; two are genuine conflicts with the
locked decisions (watch-items 1, 2) that need ratification before code.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `dc98e48` (Phase 1a audit
refresh), pushed + CI-green.

**Baseline floor (CF-10, re-baselined plan-time):**

| Gate | Floor |
| --- | --- |
| `pnpm typecheck` (root) | **51** |
| `pnpm lint` (root) | **1** |
| `pnpm test` (root) | **170** (160 web + 10 api) |
| `pnpm build` (apps/web main gzip) | **139.80 kB** |
| `pnpm --filter @toodooh/api test` | **10** |

(typecheck/lint/test re-run live plan-time = 51/1/170; build cited from
the CI-green `dc98e48`. Live full re-baseline at 1.1 start.)

**CF-18 sweep — clean.** `apps/api/src/db/schema.ts` is the Phase-1a
empty stub (`export {}`). No `users` table, no `pgEnum`, no `pgTable`
anywhere in `apps/api/src/db/`. `apps/api/scripts/` holds only
`migrate.ts` — no `promote-to-admin.ts`. drizzle-orm 0.45.2 / drizzle-kit
0.31.10 / postgres 3.4.9 already present (no new deps → lockfile delta
expected **0**).

**Node PATH prefix** on every gate + git command (`v20.20.2`).

---

## §1 — Locked constraints

**In scope (Commit 1.1):**

| File | Action |
| --- | --- |
| `apps/api/src/db/schema.ts` | modify (empty → users table + 2 enums + inferred types) |
| `apps/api/drizzle/0001_users_table.sql` | new (drizzle-kit `--name users_table`) |
| `apps/api/drizzle/meta/0001_snapshot.json` | new (tool-gen) |
| `apps/api/drizzle/meta/_journal.json` | modify (tool-gen — appends 0001 entry) |
| `apps/api/tests/db.test.ts` | modify (+2 enum tests; **Finding 9** — extend existing, not a new `db.schema.test.ts`) |
| `apps/api/scripts/promote-to-admin.ts` | new (operator bootstrap; pure Drizzle) |
| `apps/api/package.json` | modify (**Finding 10** — add `promote` script; watch-item) |
| `pnpm-lock.yaml` | **no change expected** (deps already present) |

**Out of scope:** better-auth/account/session (Commit 2), password/signup
(Commit 3), email (Commit 4), business columns beyond the 4 named
(Phase 1c), frontend, RLS (Fastify route-auth replaces it), legacy data
migration (greenfield).

**No new dependencies.** drizzle-orm/drizzle-kit/postgres suffice.

---

## §2 — Inventory phase & the CF-22 better-auth compatibility surface

better-auth's expected Postgres schema (verified via Context7,
`/better-auth/better-auth`, `usePlural` snapshot):

```ts
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});
```

### Finding 1 (CF-22 resolution) — camelCase property, snake_case column

better-auth's Drizzle adapter reads the **JS property names** (camelCase:
`emailVerified`, `createdAt`, `updatedAt`), while the **DB column** is the
string argument (`boolean('email_verified')`). Drizzle separates the two.
So our schema defines camelCase properties mapped to snake_case columns —
**satisfying both the architect's snake_case SQL preference and
better-auth's adapter expectations, with zero renaming in Commit 2.** This
is the key compatibility resolution; all base columns follow it.

### Finding 2 (CF-22 CONFLICT → watch-item 1) — `name` nullability

The architect locked **`name (text, nullable)`**. better-auth's generated
schema has **`name: text('name').notNull()`**, and email/password
`signUp` *always* supplies `name` (it's a required signup field). A
nullable `name` diverges from better-auth's expected schema — its CLI
`generate`/`migrate` and runtime schema validation expect NOT NULL.
**Recommend `name` NOT NULL** to match better-auth and avoid a Commit-2
correction. (If a future flow needs nameless users, that's a deliberate
better-auth `additionalFields`/override, not the default.) **Awaiting
ratification — plan §11 currently writes `name` NOT NULL with a flag.**

### Finding 3 (CF-22 → watch-item 2) — uuid `id` requires Commit-2 config

The architect locked **`id uuid, gen_random_uuid()`**. better-auth's
default `id` is `text` and better-auth **generates the ID itself** (not
the DB). A uuid PK is *compatible* but requires Commit-2 better-auth
config:
- `advanced.database.generateId: false` (let Postgres `defaultRandom()`
  fill it) **or** a custom uuid `generateId`; and
- the Commit-2 `account.userId` / `session.userId` FK columns **must also
  be `uuid`** (matching the PK type), not better-auth's default `text`.

The PK type is **expensive to change after data exists**, so locking uuid
now is the right call — but it imposes the above on Commit 2. Plan §11
uses `uuid('id').primaryKey().defaultRandom()`. Flag for Commit 2.

### Finding 4 (CF-22) — plural table name needs Commit-2 adapter mapping

better-auth's default table is `user` (singular); we use `users`. The
Drizzle adapter maps it via `schema: { ...schema, user: schema.users }`
(confirmed pattern, Context7). Compatible — Commit-2 config item, not a
schema change.

### Finding 5 (CF-22) — toodooh columns are better-auth `additionalFields`

`role`, `status`, `validatedBy/At/Notes`, `businessName`, `taxNumber`,
`contactPhone`, `phone` are columns better-auth doesn't know natively.
In Commit 2 they're declared under `user.additionalFields` (so better-auth
can read/write the ones signup needs, e.g. `role`) or simply left as
columns our own Fastify routes manage. Either is compatible; no Commit-1
impact.

### Finding 6 (CF-22 → watch-item 3) — `phone` vs `contact_phone`, and the phoneNumber plugin

The architect locked **both** `contact_phone` (legacy business contact)
and `phone` ("better-auth phone field if used"). Two notes:
- better-auth has **no `phone` field in the base user table**; phone
  support is the **phoneNumber plugin**, which uses columns
  `phone_number` + `phone_number_verified` — *not* `phone`. So naming a
  column `phone` will **not** auto-map to that plugin later.
- Having both `contact_phone` and `phone` looks redundant for Commit 1's
  signup-only needs.
- **Ratified (architect, Q3, 2026-05-20):** **keep `phone`** (overrides
  the executor's drop recommendation). It is a generic nullable contact
  field, documented in `schema.ts` as *not* the phoneNumber plugin's
  `phone_number` column; a future plugin would coexist, not conflict.
  `contact_phone` is retained as the legacy business field.

### Finding 7 — drizzle-kit generates `pgEnum` natively

Unlike `CREATE EXTENSION` (Phase 1a's hand-written case), drizzle-kit
**does** emit `CREATE TYPE … AS ENUM (…)` for `pgEnum()`. So
`pnpm db:generate` produces the enums + table + indexes + FK with no
custom-SQL escape hatch. Verify the generated SQL at 1.1 execution.

### Finding 8 — self-referencing FK needs an `AnyPgColumn` annotation

`validatedBy uuid → users.id` is a self-reference on the same table.
Drizzle requires a typed callback to avoid TS circular-inference:
`uuid('validated_by').references((): AnyPgColumn => users.id)`. Without the
`AnyPgColumn` return annotation, `tsc` errors on the circular type.

### Finding 9 (→ watch-item 4) — test file naming

The architect referenced `apps/api/tests/db.schema.test.ts`, but the
existing file (Phase 1a) is **`apps/api/tests/db.test.ts`** (1 test —
schema imports cleanly). **Recommend extending `db.test.ts`** with the 2
enum tests (→ 3 tests in that file) rather than creating a near-duplicate
`db.schema.test.ts`. Keeps schema tests in one place. Watch-item.

### Finding 10 (→ watch-item 5) — promote-to-admin runner + scope

`scripts/promote-to-admin.ts` is already typecheck-covered (CF-20:
`tsconfig.test.json` includes `scripts/`) and console-allowed (eslint
`scripts/` carve-out). To run it ergonomically I **recommend adding a
`promote` package.json script** (`tsx --env-file-if-exists=.env
scripts/promote-to-admin.ts`), parallel to `migrate`. This touches
`package.json` — one file beyond the architect's listed 4. Minor; flag
for ratification. Also: `noUncheckedIndexedAccess` (inherited) forces the
`const [row] = result; if (!row) …` pattern over `result[0]`.

### Migration naming

`db:generate` is `drizzle-kit generate` (no `--name`), which auto-names
migrations. To produce `0001_users_table.sql` exactly, run
`pnpm --filter @toodooh/api exec drizzle-kit generate --name users_table`
for this migration. Note for execution.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **1.0** | Plan doc (this file). Halt; approve; commit + push (CF-6). |
| **1.1** | schema.ts + migration + meta + promote-to-admin.ts + db.test.ts + package.json. Halt; CF-9; approve; push (CF-7). |

1.1 is **mechanical** with one judgment seam (the drizzle-kit-generated SQL
+ meta bytes, verified against §11 at execution). Not split — the schema,
its migration, and the type tests are one coherent unit.

---

## §4 — Per-commit verification gates

### Gate 1 — Workspace registration
`pnpm -r ls --depth -1` shows both packages.

### Gate 2 — Per-package (apps/api floor: test 10 → 12)
```bash
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 12 passing, 0 failing
pnpm --filter @toodooh/api build       # success
```

### Gate 3 — Root no-regression vs `dc98e48`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 170 | **172** (+2 enum tests) |
| build (apps/web gzip) | 139.80 kB | **139.80 ±0.5** |

### Gate 4 — Migration + DB verification
```bash
docker compose -f infra/docker-compose.yml up -d postgres   # if not running
# (fresh volume recommended so 0001 applies cleanly atop 0000)
cp apps/api/.env.example apps/api/.env   # if absent
pnpm --filter @toodooh/api migrate                            # exits 0, applies 0001
# verify via psql:
#   \d users                       → all locked columns, types
#   SELECT enum_range(NULL::user_role);    → 5 values
#   SELECT enum_range(NULL::user_status);  → 3 values
#   \di users*                     → users_role_idx, users_status_idx, email unique idx
#   FK: validated_by → users(id) self-reference present
```

### Gate 5 — promote-to-admin smoke (captured, not gating)
```bash
# insert a test user via psql, run:
pnpm --filter @toodooh/api promote test@example.com
# verify role flipped to superadmin; report in CF-9
```

### Gate 6 — CI on push (no workflow change).

---

## §5 — Standing operating procedure

CF-6 for 1.0; CF-7 for 1.1 (gate sweep → migration/DB verify → CF-9 →
approve → push → CI watch). Node PATH prefix. `NODE_OPTIONS=--max-old-space-size=4096`
on the commit (the Phase-1a transient lint-staged OOM precedent). CF-18
re-sweep before first Write. CF-22 conflicts (Findings 2, 6) surfaced
here, ratified before code.

---

## §6 — Hard-halt conditions

1. `users` table or either enum already present in `schema.ts` (swept
   clean; re-verify).
2. Migration generation emits unexpected SQL (DROP, side effects on the
   0000 migration, or touches anything but `users`/enums).
3. **better-auth conflict beyond Findings 2/3/4/6** surfaces at execution
   (a column better-auth *requires* that we lack, forcing a Commit-1.5
   correction) — halt.
4. Any gate regresses vs `dc98e48`.
5. `promote-to-admin.ts` can't be written without auth code (it must be
   pure Drizzle — Finding 10 confirms it can).
6. drizzle-kit fails to generate the enums/FK cleanly (Finding 7/8).
7. Migration exits 0 but `\d users` shows missing columns/enums/indexes
   (silent success).

---

## §7 — Risk register

| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| better-auth `name` NOT NULL mismatch | **Resolved by watch-item 1** | Commit 2 schema validation | recommend NOT NULL now |
| uuid PK vs better-auth text-id default | Medium (Commit 2) | Commit 2 adapter config | `generateId:false` + uuid FKs in Commit 2; flagged |
| self-FK TS circular inference | Low | Gate 2 typecheck | `AnyPgColumn` annotation (Finding 8) |
| drizzle-kit enum/FK generation gap | Low | Gate 4 migrate | inspect generated SQL before commit |
| `0001` doesn't chain on `0000` meta | Low | Gate 4 migrate errors | drizzle-kit appends to `_journal.json`; verify |
| migration re-run not idempotent | Low | Gate 4 re-run | drizzle records applied migrations in `__drizzle_migrations` |
| `phone`/`contact_phone` redundancy ships | **Watch-item 3** | plan review | recommend dropping `phone` |
| existing `.env`/volume has stale 0000-only state | Low | Gate 4 | fresh volume or confirm 0000 applied first |
| lint-staged OOM on commit | Low | commit | `NODE_OPTIONS=--max-old-space-size=4096` |

---

## §8 — Cross-references

- `00-PROJECT_HANDOFF.md` §4 — dual-identity collapse → single `users`
  table with role enum.
- `supabase-schema-inventory.md` §2.2 — `business_profiles` (column-shape
  source: business_name/tax_number NOT NULL+UNIQUE/contact_phone, the
  `status`+validated_* audit trio, profile_type enum), §2.2 Defect 4
  (twin validation columns → pick `status`), §9 (collapse, "pick one
  validation column", RLS→route-auth, password floor/email-verify policy).
- Context7 `/better-auth/better-auth` — user/account/session schema,
  Drizzle adapter custom table mapping.
- `docs/audit.md` §12 — Phase 1a record.
- Prior commits: `dc98e48` (HEAD), Phase-1a `4a5289a` (Drizzle/Postgres).

---

## §9 — Carry-forward methodology

- **CF-9** — 1.1 pause summary covers the architect's listed items +
  verbatim file contents + migration/DB verification + smoke.
- **CF-10** — floor re-baselined plan-time (§0); live at 1.1 start.
- **CF-18** — swept clean (§0).
- **CF-19** — no new deps this commit (drizzle stack already exact-pinned);
  discipline holds (nothing to pin).
- **CF-22 (parked candidate) — fourth worked instance.** Findings 2 and 6
  are literal-lock-vs-system-invariant conflicts (architect-locked
  `name nullable` / dual `phone` vs better-auth's actual schema), surfaced
  here for ratification rather than silently implemented. This is the
  fourth instance (after P0a checkout, P0b column count, Phase-1a §11→§12)
  — **CF-22 is now at its promotion threshold**; promote at the Phase-1b
  audit refresh per the architect's parked-candidate note.

**New CF candidate (recorded):**
- **CF-23 candidate — "Verify the integrating library's schema before
  locking your own."** When a commit lands a schema another library will
  later adapt (better-auth, an ORM plugin, an external API contract),
  inventory must fetch that library's *current* expected shape (Context7 /
  official docs) and reconcile field-by-field *before* locking column
  names/types/nullability — not assume training-data recall. Worked
  example: this commit (Context7 better-auth lookup surfaced the
  camelCase/snake_case resolution + the `name`/uuid/`phone` conflicts).
  Promotion: a second instance (e.g., the MinIO/S3 SDK contract in
  Phase 1d, or the player-api APK contract).

---

## §10 — Push policy + sequencing

**1.0** — `git add` the plan; `docs(phase-1b): plan Commit 1 — users
table schema`; push; `gh run watch` (CF-6).

**1.1** — `git add apps/api`; commit (body: schema + migration +
promote script + the resolved findings); push; `gh run watch` (CF-7).
No `Co-Authored-By` trailer.

---

## §11 — Exact file contents (Commit 1.1)

> Reflects the architect's ratified locks (2026-05-20): `name` NOT NULL
> (Q1, overrides original nullable); uuid PK (confirmed); `phone` **kept**
> (Q3, overrides executor's drop recommendation) with a clarifying
> comment; enum tests extend `db.test.ts` (Q2); `promote` script added to
> `package.json` (Q4 — file count 4 → 5).

### `apps/api/src/db/schema.ts`

```ts
import { type AnyPgColumn, boolean, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Phase 1b Commit 1 — the single users table (dual-identity collapse).
// better-auth (Commit 2) adds account + session tables and maps its
// `user` model to this `users` table via the Drizzle adapter. Property
// names are camelCase (what better-auth's adapter reads); DB columns are
// snake_case (the column-name argument).

export const userRole = pgEnum('user_role', [
  'advertiser',
  'individual_owner',
  'fleet_owner',
  'admin',
  'superadmin',
]);

export const userStatus = pgEnum('user_status', ['pending', 'approved', 'rejected']);

export const users = pgTable(
  'users',
  {
    // better-auth core identity
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    image: text('image'),
    // toodooh role + moderation
    role: userRole('role').notNull().default('advertiser'),
    status: userStatus('status').notNull().default('pending'),
    // validation audit trio (validated_by self-references an admin user)
    validatedBy: uuid('validated_by').references((): AnyPgColumn => users.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validationNotes: text('validation_notes'),
    // business profile (subset; rest land in Phase 1c onboarding)
    businessName: text('business_name'),
    taxNumber: text('tax_number').unique(),
    contactPhone: text('contact_phone'),
    // Generic nullable contact field — NOT better-auth's phoneNumber plugin
    // column (that plugin uses `phone_number`). If the plugin is adopted
    // later it adds its own columns and coexists with this one.
    phone: text('phone'),
    // timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('users_role_idx').on(table.role), index('users_status_idx').on(table.status)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

(`email` `.unique()` creates the unique index that satisfies the
architect's "email index"; explicit `role`/`status` indexes added.)

### `apps/api/scripts/promote-to-admin.ts`

```ts
import { eq } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const email = process.argv[2];

const run = async (): Promise<void> => {
  if (!email) {
    console.error('usage: pnpm --filter @toodooh/api promote <email>');
    process.exit(1);
  }
  const updated = await db
    .update(users)
    .set({ role: 'superadmin' })
    .where(eq(users.email, email))
    .returning({ id: users.id, email: users.email, role: users.role });
  const [row] = updated;
  if (!row) {
    console.error(`no user found with email ${email}`);
    process.exit(1);
  }
  console.info(`promoted ${row.email} → ${row.role}`);
};

run()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('promote failed', err);
    await sql.end();
    process.exit(1);
  });
```

### `apps/api/tests/db.test.ts` (extend — Finding 9)

```ts
import { describe, expect, it } from 'vitest';

import * as schema from '../src/db/schema.js';
import { userRole, userStatus } from '../src/db/schema.js';

describe('db schema', () => {
  it('imports without opening a connection', () => {
    expect(schema).toBeDefined();
  });

  it('user_role enum has exactly the five locked values', () => {
    expect(userRole.enumValues).toEqual([
      'advertiser',
      'individual_owner',
      'fleet_owner',
      'admin',
      'superadmin',
    ]);
  });

  it('user_status enum has exactly the three locked values', () => {
    expect(userStatus.enumValues).toEqual(['pending', 'approved', 'rejected']);
  });
});
```

### `apps/api/package.json` (modify — Finding 10, add `promote` script)

Add to `scripts` (after `migrate`):
```json
    "promote": "tsx --env-file-if-exists=.env scripts/promote-to-admin.ts"
```
No dependency changes.

### `apps/api/drizzle/0001_users_table.sql` + `meta/`

Generated by `drizzle-kit generate --name users_table`. Expected SQL
(verified against this at execution): `CREATE TYPE "public"."user_role"
AS ENUM(...)`, `CREATE TYPE "public"."user_status" AS ENUM(...)`,
`CREATE TABLE "users" (...)` with the columns above, the self-FK
`validated_by → users(id)`, and `CREATE INDEX users_role_idx` /
`users_status_idx`. `meta/_journal.json` gains the `0001` entry;
`meta/0001_snapshot.json` is new. Exact bytes are tool-determined (§3
judgment seam) — committed verbatim after verification.

---

## §12 — Fire instruction

This is **Commit 1.0** (plan). All five watch-items are now
**architect-ratified (2026-05-20)**; on plan approval, commit + push
docs-only. **Halt** until then.

**Watch-items — resolved:**

1. **`name` NOT NULL** (Finding 2) — **NOT NULL** (Q1; overrides original
   nullable lock — matches better-auth, signup always supplies it).
2. **uuid `id`** (Finding 3) — **confirmed uuid PK**; imposes
   `generateId:false` + uuid `account`/`session` FKs on Commit 2.
3. **`phone` column** (Finding 6) — **kept** (Q3; overrides executor's
   drop recommendation) with a `schema.ts` comment marking it a generic
   contact field, not the phoneNumber plugin's `phone_number`.
4. **Test file** (Finding 9) — **extend `db.test.ts`** (Q2; → 3 tests,
   apps/api 10 → 12).
5. **`promote` script** (Finding 10) — **added** to `package.json` (Q4;
   file count 4 → 5).

Commit-2 obligations acknowledged: plural `users` mapping
(`{ user: schema.users }`, Finding 4); uuid FKs + `generateId` config
(Finding 3); toodooh columns as `additionalFields` (Finding 5). CF-22
promotion (fourth instance) + CF-23 candidate recorded in §9.
