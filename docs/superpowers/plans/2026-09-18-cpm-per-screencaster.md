# CPM per screencaster (CPM-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CPM a property of each screencaster (advertiser): an admin lists them, selects one or many, changes their standard and/or event CPM; drafts and new campaigns take the new CPM, every other campaign keeps its price.

**Architecture:** Two CPM columns on `users` (default = the global CPM at account creation) and an append-only `screencaster_cpm_changes` trail (migration 0076). A `BEFORE INSERT` trigger on `campaigns` copies the screencaster's CPMs onto every new campaign (replaces 0074's column default). One api lib (`lib/screencaster-cpm.ts`) owns list / bulk-update (reprices `draft` rows in the same transaction) / the caller's rates; two admin routes expose it; `pricing-config` and the event C_max read the caller's own CPM. The web page `/admin-dispatch-config` gains a searchable, multi-select table.

**Tech Stack:** Fastify 5 + Drizzle ORM + Postgres 16 (hand-written SQL migrations), zod v4, vitest (real Postgres); React 18 + TanStack Query v5 + Tailwind, vitest node env (pure `.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-09-18-cpm-per-screencaster-design.md` (read it first — §2 is the rule table).

## Global Constraints

- Node **20.20.2** for every command: prefix `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$HOME/.local/bin:$PATH"`; commits also `NODE_OPTIONS=--max-old-space-size=4096`.
- Work only in the worktree `.claude/worktrees/cpm-per-screencaster` (branch `feat/cpm-per-screencaster`). The main checkout runs the operator's review servers — never touch it.
- CLAUDE.md: no `any`, no `@ts-ignore`/`@ts-expect-error`, no `console.*` outside `scripts/`/tests, Tailwind only (no inline `style`), `date-fns` only for dates, files under 400 lines, Conventional Commits, **no `Co-Authored-By` trailer**.
- Money columns: CPM is `numeric(10,3)` TND / 1000, written as a string with 3 decimals (`n.toFixed(3)`).
- Migration number **0076**, journal idx **76**, tag `0076_screencaster_cpm`, `when` **1789800000000**. Statements separated by `--> statement-breakpoint`.
- Repriced statuses: **`draft` only**. Never touched: `pending`, `rejected`, `upcoming`, `active`, `completed`.
- The migration does **not** reprice existing drafts (spec Q1, ruled).
- Each task ends with a LOCAL commit. **Nothing is pushed** until the operator ratifies.
- api tests: one vitest run at a time (the per-worker DB clones collide otherwise). Run a single file with `cd apps/api && pnpm exec vitest run tests/<file>.test.ts`.
- Gate commands (name them in every report): `pnpm --filter @toodooh/api typecheck` (baseline 0), `pnpm --filter @toodooh/web typecheck` (≤ 14; today 11), `pnpm exec eslint . --no-error-on-unmatched-pattern --ignore-pattern '.claude/**'` (from the worktree root), `pnpm test`, `pnpm build`.

## File map

| File | Responsibility |
|---|---|
| `apps/api/drizzle/0076_screencaster_cpm.sql` (create) | columns + backfill, trail table, trigger, drop 0074 defaults |
| `apps/api/drizzle/meta/_journal.json` (modify) | journal entry 76 |
| `apps/api/src/db/schema.ts` (modify) | `users.cpmStandardTnd/cpmEventTnd`, `screencasterCpmChanges`, campaigns CPM columns' default marker |
| `apps/api/src/lib/screencaster-cpm.ts` (create) | `listScreencasterCpm`, `updateScreencasterCpm`, `screencasterCpmRates` |
| `apps/api/src/routes/admin-screencaster-cpm.ts` (create) | `GET/PATCH /api/admin/screencasters/cpm` |
| `apps/api/src/routes/index.ts` (modify) | register the new routes |
| `apps/api/src/routes/campaigns-pricing.ts` (modify) | caller's own CPM |
| `apps/api/src/routes/events.ts` (modify) | event C_max at the caller's event CPM |
| `apps/api/tests/cpm3-migration.test.ts` (create) | migration 0076 on a scratch DB |
| `apps/api/tests/cpm3-screencaster-cpm.test.ts` (create) | lib rules on real Postgres |
| `apps/api/tests/admin-screencaster-cpm.test.ts` (create) | route guards / validation / wire |
| `apps/api/tests/cpm1-backfill.test.ts`, `cpm1-campaign-cpm-snapshot.test.ts`, `campaigns-pricing.test.ts`, `ev2-event-pricing.test.ts` (modify) | superseded rule → CPM-3 rule |
| `apps/web/src/features/admin/services/admin-screencaster-cpm.service.ts` (create) | wire types + fetch |
| `apps/web/src/features/admin/hooks/queryKeys.ts` (modify), `hooks/useScreencasterCpm.ts` (create) | query + mutation |
| `apps/web/src/features/admin/lib/screencaster-cpm.ts` + `.test.ts` (create) | search, selection, patch composition |
| `apps/web/src/features/admin/components/screencaster-cpm/ScreencasterCpmSection.tsx` (create) | search + table + selection |
| `apps/web/src/features/admin/components/screencaster-cpm/ScreencasterCpmBulkBar.tsx` (create) | inputs + confirmation + apply |
| `apps/web/src/features/admin/pages/DispatchConfigManagement.tsx` (modify) | mount the section, relabel the default card |

---

### Task 1: Migration 0076 — screencaster CPM columns, trail, capture trigger

**Files:**
- Create: `apps/api/drizzle/0076_screencaster_cpm.sql`
- Modify: `apps/api/drizzle/meta/_journal.json` (append entry)
- Modify: `apps/api/src/db/schema.ts` (users columns after `termsAcceptedAt` ~line 135; campaigns CPM columns ~line 932; new table right after `userBankDetailsAudit` ~line 1557)
- Create: `apps/api/tests/cpm3-migration.test.ts`
- Modify: `apps/api/tests/cpm1-backfill.test.ts` (last test)
- Modify: `apps/api/tests/cpm1-campaign-cpm-snapshot.test.ts` (the first 2 tests of « the capture » — the rule the trigger replaces)

**Interfaces:**
- Produces (DB): `users.cpm_standard_tnd`, `users.cpm_event_tnd` (numeric(10,3) NOT NULL, default `current_*_cpm_tnd()`); table `screencaster_cpm_changes`; trigger `campaigns_capture_screencaster_cpm`.
- Produces (Drizzle): `users.cpmStandardTnd`, `users.cpmEventTnd` (string), `screencasterCpmChanges` table object, type `ScreencasterCpmChange`.

- [ ] **Step 1: Write the failing migration test** — `apps/api/tests/cpm3-migration.test.ts`

```ts
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/db/migrate-runner.js';
import { env } from '../src/env.js';
import { mainDatabaseName, sandboxUrl } from '../src/simulator/naming.js';
import { createSandboxDatabase, dropSandboxDatabase } from '../src/simulator/provisioning.js';

import { migrationsFolderBefore } from './helpers/migrations-before.js';

// CPM-3 — migration 0076 proven on a scratch database migrated to 0075 with the production shape
// of 2026-09-17: config 10 / 15, a draft restored to 15 by CPM-1. The scratch name is not
// `<main>_sim_…`, so the simulator's orphan sweep never sees it; it is dropped in afterAll.

const CPM3_IDX = 76;
const dbName = `${mainDatabaseName(env.DATABASE_URL)}_cpm3_${randomBytes(4).toString('hex')}`;
const url = sandboxUrl(env.DATABASE_URL, dbName);

type Rates = { standard: string; event: string };

describe('migration 0076 — the CPM per screencaster (scratch database)', () => {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const ids: Record<string, string> = {};
  let tmp = '';

  const insertCampaign = async (key: string, advertiser: string, rates?: Rates) => {
    const [row] = rates
      ? await client<{ id: string }[]>`
          insert into campaigns (advertiser_id, name, campaign_type, standard_cpm_tnd, event_cpm_tnd)
          values (${advertiser}, ${key}, 'standard', ${rates.standard}, ${rates.event}) returning id`
      : await client<{ id: string }[]>`
          insert into campaigns (advertiser_id, name, campaign_type)
          values (${advertiser}, ${key}, 'standard') returning id`;
    ids[key] = row?.id ?? '';
  };
  const campaignRates = async (key: string): Promise<Rates | undefined> => {
    const [row] = await client<Rates[]>`
      select standard_cpm_tnd::text as standard, event_cpm_tnd::text as event
      from campaigns where id = ${ids[key] ?? ''}`;
    return row;
  };
  const userRates = async (id: string): Promise<Rates | undefined> => {
    const [row] = await client<Rates[]>`
      select cpm_standard_tnd::text as standard, cpm_event_tnd::text as event
      from users where id = ${id}`;
    return row;
  };
  const insertUser = async (key: string) => {
    const [u] = await client<{ id: string }[]>`
      insert into users (email, contact_name) values (${`${key}@example.com`}, ${key}) returning id`;
    ids[key] = u?.id ?? '';
  };

  beforeAll(async () => {
    await createSandboxDatabase(dbName);
    tmp = migrationsFolderBefore(CPM3_IDX);
    await migrate(drizzle(client), { migrationsFolder: tmp });
    await client`update dispatch_config set standard_cpm_tnd = '10.000', event_cpm_tnd = '15.000'`;
    await insertUser('advertiser');
    // A draft restored by CPM-1 to its creation CPM (15) while the config says 10.
    await insertCampaign('restoredDraft', ids['advertiser'] ?? '', { standard: '15.000', event: '15.000' });
    await applyMigrations(url); // the real folder → applies 0076
  }, 300_000);

  afterAll(async () => {
    await client.end();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    await dropSandboxDatabase(dbName);
  }, 300_000);

  it('every existing account is backfilled with the global CPM in force', async () => {
    expect(await userRates(ids['advertiser'] ?? '')).toEqual({ standard: '10.000', event: '15.000' });
  });

  it('existing drafts keep their CPM (Q1)', async () => {
    expect(await campaignRates('restoredDraft')).toEqual({ standard: '15.000', event: '15.000' });
  });

  it('a new campaign captures its screencaster’s CPM through the trigger', async () => {
    await client`update users set cpm_standard_tnd = '12.500', cpm_event_tnd = '22.000'
      where id = ${ids['advertiser'] ?? ''}`;
    await insertCampaign('afterChange', ids['advertiser'] ?? '');
    expect(await campaignRates('afterChange')).toEqual({ standard: '12.500', event: '22.000' });
    expect(await campaignRates('restoredDraft')).toEqual({ standard: '15.000', event: '15.000' });
  });

  it('an explicit value still wins over the trigger', async () => {
    await insertCampaign('explicit', ids['advertiser'] ?? '', { standard: '9.000', event: '19.000' });
    expect(await campaignRates('explicit')).toEqual({ standard: '9.000', event: '19.000' });
  });

  it('the global CPM is only the default of NEW accounts', async () => {
    await client`update dispatch_config set standard_cpm_tnd = '11.000', event_cpm_tnd = '16.000'`;
    expect(await userRates(ids['advertiser'] ?? '')).toEqual({ standard: '12.500', event: '22.000' });
    await insertUser('newcomer');
    expect(await userRates(ids['newcomer'] ?? '')).toEqual({ standard: '11.000', event: '16.000' });
  });

  it('the campaign columns have no default any more; the trail table exists', async () => {
    const cols = await client<{ column_name: string; column_default: string | null }[]>`
      select column_name, column_default from information_schema.columns
      where table_name = 'campaigns' and column_name in ('standard_cpm_tnd', 'event_cpm_tnd')
      order by column_name`;
    expect(cols).toEqual([
      { column_name: 'event_cpm_tnd', column_default: null },
      { column_name: 'standard_cpm_tnd', column_default: null },
    ]);
    const [trail] = await client<{ n: number }[]>`
      select count(*)::int as n from information_schema.tables
      where table_name = 'screencaster_cpm_changes'`;
    expect(trail?.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm exec vitest run tests/cpm3-migration.test.ts`
Expected: FAIL — `column "cpm_standard_tnd" does not exist` (no 0076 yet, so the real folder adds nothing).

- [ ] **Step 3: Write the migration** — `apps/api/drizzle/0076_screencaster_cpm.sql`

```sql
-- CPM-3 (operator rulings 2026-09-18) — THE CPM BELONGS TO THE SCREENCASTER.
--
-- Until now the CPM was one global pair (dispatch_config) copied onto every campaign at INSERT
-- (0074). From here each screencaster (advertiser) has its OWN pair, set by an admin on
-- /admin-dispatch-config (PATCH /api/admin/screencasters/cpm), and:
--   • a DRAFT follows its screencaster: the admin change re-prices the screencaster's drafts in
--     the same transaction (lib/screencaster-cpm.ts), in the cart or not, event positionings too;
--   • a campaign CREATED after the change (the wizard, a positioning, a replay of a completed
--     campaign) captures the new CPM — the trigger below;
--   • pending, rejected, upcoming, active, completed keep the CPM they carry, and a boost keeps
--     the campaign's CPM (it prices at the frozen plan.cpm). Nothing here touches them.
-- The global dispatch_config CPM becomes the DEFAULT a new account starts at (the column default
-- below calls the 0074 functions); changing it never touches an existing screencaster.
--
-- Q1 (ruled): existing drafts are NOT re-priced here. The drafts CPM-1 restored to 15 on
-- 2026-09-17 keep 15 until their screencaster's first change on the new page.
--
-- WHY A TRIGGER (approach A, ruled). The CPM a campaign captures now depends on ANOTHER row (its
-- advertiser), which a column default cannot read. A BEFORE INSERT trigger can, and like 0074's
-- default it covers every insert path — routes, the simulator world writer, every test fixture —
-- with no per-site code. An explicit value still wins (COALESCE). NOT NULL is checked after
-- BEFORE triggers, so a campaign can never exist without a CPM.
ALTER TABLE "users" ADD COLUMN "cpm_standard_tnd" numeric(10, 3) DEFAULT public.current_standard_cpm_tnd() NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cpm_event_tnd" numeric(10, 3) DEFAULT public.current_event_cpm_tnd() NOT NULL;
--> statement-breakpoint
CREATE TABLE "screencaster_cpm_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict,
  "changed_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict,
  "old_standard_cpm_tnd" numeric(10, 3) NOT NULL,
  "new_standard_cpm_tnd" numeric(10, 3) NOT NULL,
  "old_event_cpm_tnd" numeric(10, 3) NOT NULL,
  "new_event_cpm_tnd" numeric(10, 3) NOT NULL,
  "drafts_repriced" integer NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "screencaster_cpm_changes_user_id_idx" ON "screencaster_cpm_changes" USING btree ("user_id", "changed_at");
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "standard_cpm_tnd" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "event_cpm_tnd" DROP DEFAULT;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.campaigns_capture_screencaster_cpm() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    own_standard numeric(10, 3);
    own_event numeric(10, 3);
  BEGIN
    SELECT u.cpm_standard_tnd, u.cpm_event_tnd INTO own_standard, own_event
      FROM public.users u WHERE u.id = NEW.advertiser_id;
    NEW.standard_cpm_tnd := COALESCE(NEW.standard_cpm_tnd, own_standard, public.current_standard_cpm_tnd());
    NEW.event_cpm_tnd := COALESCE(NEW.event_cpm_tnd, own_event, public.current_event_cpm_tnd());
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER "campaigns_capture_screencaster_cpm" BEFORE INSERT ON "public"."campaigns"
  FOR EACH ROW EXECUTE FUNCTION public.campaigns_capture_screencaster_cpm();
```

- [ ] **Step 4: Append the journal entry** — in `apps/api/drizzle/meta/_journal.json`, after the idx-75 object:

```json
    {
      "idx": 76,
      "version": "7",
      "when": 1789800000000,
      "tag": "0076_screencaster_cpm",
      "breakpoints": true
    }
```

- [ ] **Step 5: Update the Drizzle schema** — `apps/api/src/db/schema.ts`

In the `users` columns, right after `termsAcceptedAt`:

```ts
    // CPM-3 (operator rulings 2026-09-18) — the screencaster's OWN CPMs (TND / 1000). An account
    // starts at the global default in force when it is created (the 0074 functions); an admin
    // changes them per screencaster (lib/screencaster-cpm.ts). Only advertisers' are read.
    cpmStandardTnd: numeric('cpm_standard_tnd', { precision: 10, scale: 3 })
      .notNull()
      .default(sql`current_standard_cpm_tnd()`),
    cpmEventTnd: numeric('cpm_event_tnd', { precision: 10, scale: 3 })
      .notNull()
      .default(sql`current_event_cpm_tnd()`),
```

In `campaigns`, replace the two CPM column definitions:

```ts
    // CPM-3 — no database default any more: the BEFORE INSERT trigger of migration 0076 copies the
    // screencaster's CPMs (users.cpm_standard_tnd / cpm_event_tnd). `.default(sql\`NULL\`)` only
    // keeps the column insert-optional for Drizzle; an explicit value still wins in the trigger.
    standardCpmTnd: numeric('standard_cpm_tnd', { precision: 10, scale: 3 })
      .notNull()
      .default(sql`NULL`),
    eventCpmTnd: numeric('event_cpm_tnd', { precision: 10, scale: 3 })
      .notNull()
      .default(sql`NULL`),
```

Right after `export type UserBankDetailsAudit = …`:

```ts
// CPM-3 (operator rulings 2026-09-18) — the append-only trail of every per-screencaster CPM change:
// who, when, old → new for BOTH rates (an unchanged one is written old = new), and how many of the
// screencaster's drafts the change re-priced. restrict: a trail row never loses its subject.
export const screencasterCpmChanges = pgTable(
  'screencaster_cpm_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    oldStandardCpmTnd: numeric('old_standard_cpm_tnd', { precision: 10, scale: 3 }).notNull(),
    newStandardCpmTnd: numeric('new_standard_cpm_tnd', { precision: 10, scale: 3 }).notNull(),
    oldEventCpmTnd: numeric('old_event_cpm_tnd', { precision: 10, scale: 3 }).notNull(),
    newEventCpmTnd: numeric('new_event_cpm_tnd', { precision: 10, scale: 3 }).notNull(),
    draftsRepriced: integer('drafts_repriced').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('screencaster_cpm_changes_user_id_idx').on(table.userId, table.changedAt)],
);

export type ScreencasterCpmChange = typeof screencasterCpmChanges.$inferSelect;
```

- [ ] **Step 6: Update the superseded 0074 final-state test** — in `apps/api/tests/cpm1-backfill.test.ts` replace the whole last `it('both columns end NOT NULL with a function default …')` block with:

```ts
  it('after 0076 the columns stay NOT NULL, lose their default, and a new row takes its screencaster’s CPM', async () => {
    const cols = await client<
      { column_name: string; is_nullable: string; column_default: string | null }[]
    >`
      select column_name, is_nullable, column_default from information_schema.columns
      where table_name = 'campaigns' and column_name in ('standard_cpm_tnd', 'event_cpm_tnd')
      order by column_name`;
    expect(cols).toEqual([
      { column_name: 'event_cpm_tnd', is_nullable: 'NO', column_default: null },
      { column_name: 'standard_cpm_tnd', is_nullable: 'NO', column_default: null },
    ]);
    const volatility = await client<{ proname: string; provolatile: string }[]>`
      select proname, provolatile from pg_proc
      where proname in ('current_standard_cpm_tnd', 'current_event_cpm_tnd') order by proname`;
    expect(volatility.map((f) => f.provolatile)).toEqual(['s', 's']); // STABLE, still the default of new accounts

    // CPM-3 — the advertiser was backfilled at 0076 with the config then in force (20 / 25); a later
    // config change is only the default of NEW accounts, so the new row keeps 20 / 25.
    await client`update dispatch_config set standard_cpm_tnd = '21.000', event_cpm_tnd = '31.000'`;
    await insertCampaign('afterMigration', 'standard', null);
    expect(await ratesOf('afterMigration')).toEqual({ standard: '20.000', event: '25.000' });
    expect(await ratesOf('classic')).toEqual({ standard: '15.000', event: '25.000' });
  });
```

- [ ] **Step 6b: Move the CPM-1 capture tests to the CPM-3 rule** — in `apps/api/tests/cpm1-campaign-cpm-snapshot.test.ts`, inside `describe('the capture …')`, replace the first two `it(...)` blocks with:

```ts
    it('CPM-3 — a new row captures its SCREENCASTER’s CPM; a default change touches neither', async () => {
      const advertiser = await seedUser(); // created at the pinned default 15 / 15
      const [first] = await db
        .insert(campaigns)
        .values({ advertiserId: advertiser, name: 'Avant', campaignType: 'standard' })
        .returning();
      expect(first?.standardCpmTnd).toBe('15.000');
      expect(first?.eventCpmTnd).toBe('15.000');

      await setCpmConfig('20.000', '30.000');
      expect(await rowRates(first?.id ?? '')).toEqual({ standard: 15, event: 15 });
      const [second] = await db
        .insert(campaigns)
        .values({ advertiserId: advertiser, name: 'Après', campaignType: 'standard' })
        .returning();
      expect(second?.standardCpmTnd).toBe('15.000'); // the default is only for NEW screencasters
      expect(second?.eventCpmTnd).toBe('15.000');

      const newcomer = await seedUser(); // created after the default moved
      const [third] = await db
        .insert(campaigns)
        .values({ advertiserId: newcomer, name: 'Nouveau', campaignType: 'standard' })
        .returning();
      expect(third?.standardCpmTnd).toBe('20.000');
      expect(third?.eventCpmTnd).toBe('30.000');
    });

    it('with no dispatch_config row a new screencaster — and its campaign — start at 15 / 15', async () => {
      await setCpmConfig('20.000', '30.000');
      const rollback = new Error('rollback');
      await expect(
        sql.begin(async (tx) => {
          await tx`delete from dispatch_config`;
          const [u] = await tx<{ id: string }[]>`
            insert into users (email, contact_name) values ('cpm3-noconfig@example.com', 'Sans config')
            returning id`;
          const [row] = await tx<{ standard: string; event: string }[]>`
            insert into campaigns (advertiser_id, name, campaign_type)
            values (${u?.id ?? ''}, 'Sans config', 'standard')
            returning standard_cpm_tnd::text as standard, event_cpm_tnd::text as event`;
          expect(row).toEqual({ standard: '15.000', event: '15.000' });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });
```

- [ ] **Step 7: Migrate both local databases** (the test template is rebuilt by vitest's global setup, the dev DB is not):

```bash
cd apps/api && pnpm migrate
```
Expected: `migrations applied`.

- [ ] **Step 8: Run the migration tests to verify they pass**

Run: `cd apps/api && for f in cpm3-migration cpm1-backfill cpm1-campaign-cpm-snapshot; do pnpm exec vitest run tests/$f.test.ts || break; done`
Expected: all three PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @toodooh/api typecheck`
Expected: exit 0 (no `error TS`).

- [ ] **Step 10: Commit**

```bash
git add apps/api/drizzle/0076_screencaster_cpm.sql apps/api/drizzle/meta/_journal.json apps/api/src/db/schema.ts apps/api/tests/cpm3-migration.test.ts apps/api/tests/cpm1-backfill.test.ts apps/api/tests/cpm1-campaign-cpm-snapshot.test.ts
git commit -m "feat(api): CPM-3 — a screencaster has its own CPM; a new campaign captures it (migration 0076)"
```

---

### Task 2: Full api suite — sweep the tests that encode the superseded rule (right after the trigger lands)

**Files:** whichever `apps/api/tests/*.test.ts` fail (candidates: `admin-campaigns.test.ts:314-347`, `cpm1-sandbox-upgrade.test.ts`, `cpm1-restore-creation-cpm.test.ts`, `cpm2-t-snapshot.test.ts`, `ev3-positioning.test.ts`, `admin-dispatch-config.test.ts`).

- [ ] **Step 1: Run the whole suite**

Run: `cd apps/api && pnpm exec vitest run 2>&1 | tail -40`
Expected before fixes: PASS, or failures limited to tests that change the GLOBAL CPM after the advertiser exists and then expect a NEW campaign to capture it.

- [ ] **Step 2: Classify each failure** — for every failing test, read it and decide:
  - (a) it asserts « a new campaign captures the global config » for an advertiser created BEFORE the config change → the CPM-3 rule changed that on purpose. Fix by setting the screencaster's own CPM instead of (or in addition to) the config, e.g.:
    ```ts
    await db.update(users).set({ cpmStandardTnd: '20.000', cpmEventTnd: '30.000' }).where(eq(users.id, advertiserId));
    ```
    or by pinning the config BEFORE the advertiser is seeded. Keep the assertion's intent; write a one-line `// CPM-3 —` comment saying why.
  - (b) anything else (a timeout, an unrelated file, a numeric mismatch not explained by (a)) → **STOP and report it** with the output; do not change the test (see the standing rule « a green test asserting the defect argues against the reporter »).

- [ ] **Step 3: Re-run the full suite**

Run: `cd apps/api && pnpm exec vitest run 2>&1 | grep -E "Test Files|Tests "`
Expected: all files pass (origin/main: 177 passed + 1 skipped files; at this point the lane has added 1 file, `cpm3-migration`).

- [ ] **Step 4: Commit (only if Step 2 changed files)**

```bash
git add apps/api/tests/<the files you changed>
git commit -m "test(api): CPM-3 — fixtures that priced a new campaign at the global CPM now set the screencaster's"
```

---

### Task 3: `lib/screencaster-cpm.ts` — list, bulk update with draft repricing, the caller's rates

**Files:**
- Create: `apps/api/src/lib/screencaster-cpm.ts`
- Create: `apps/api/tests/cpm3-screencaster-cpm.test.ts`

**Interfaces:**
- Consumes: `users.cpmStandardTnd/cpmEventTnd`, `screencasterCpmChanges` (Task 1); `CpmRates` from `lib/dispatch/config.ts` (`{ standardCpmTnd: number; eventCpmTnd: number }`).
- Produces:
  - `listScreencasterCpm(): Promise<ScreencasterCpmRow[]>`
  - `updateScreencasterCpm(input: { userIds: readonly string[]; standardCpmTnd?: number; eventCpmTnd?: number; changedBy: string }): Promise<UpdateScreencasterCpmResult>` where `UpdateScreencasterCpmResult = { ok: true; updated: number; draftsRepriced: number } | { ok: false; error: 'NOT_ADVERTISER'; ids: string[] }`
  - `screencasterCpmRates(userId: string): Promise<CpmRates | null>` (null for a non-advertiser or unknown id)
  - `interface ScreencasterCpmRow { id: string; company_name: string | null; contact_name: string; email: string; business_type: string | null; status: string; cpm_standard_tnd: number; cpm_event_tnd: number; draft_count: number; last_change: { changed_at: string; changed_by_name: string } | null }`

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/cpm3-screencaster-cpm.test.ts`

```ts
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignDispatchPlan,
  campaigns,
  cartItems,
  screencasterCpmChanges,
  users,
} from '../src/db/schema.js';
import {
  listScreencasterCpm,
  screencasterCpmRates,
  updateScreencasterCpm,
} from '../src/lib/screencaster-cpm.js';

import { type CpmConfigSnapshot, pinCpmConfig, restoreCpmConfig } from './helpers/cpm-config.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// CPM-3 — the rule of spec §2 on real Postgres: an admin change re-prices the screencaster's
// DRAFTS only; every other status keeps its CPM; the trail records it; a new campaign captures it.

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `cpm3-${seq}@example.com`, contactName: `CPM3 ${seq}`, status: 'approved', ...values })
    .returning({ id: users.id });
  return u?.id ?? '';
};
const seedCampaign = async (
  advertiserId: string,
  status: 'draft' | 'pending' | 'upcoming' | 'active' | 'rejected' | 'completed',
  name: string,
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId, name, campaignType: 'standard', status })
    .returning({ id: campaigns.id });
  return c?.id ?? '';
};
const ratesOf = async (id: string) => {
  const [row] = await db
    .select({ s: campaigns.standardCpmTnd, e: campaigns.eventCpmTnd })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return { standard: Number(row?.s), event: Number(row?.e) };
};

describe('CPM-3 — the CPM per screencaster (real Postgres)', () => {
  let pinned: CpmConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('15.000', '15.000');
  });
  afterEach(async () => {
    await restoreCpmConfig(pinned);
  });
  afterAll(async () => {
    await sql.end();
  });

  it('re-prices the screencaster’s drafts only — every other status keeps its CPM', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const byStatus = {
      draft: await seedCampaign(adv, 'draft', 'Brouillon'),
      carted: await seedCampaign(adv, 'draft', 'Au panier'),
      pending: await seedCampaign(adv, 'pending', 'En attente'),
      rejected: await seedCampaign(adv, 'rejected', 'Refusée'),
      upcoming: await seedCampaign(adv, 'upcoming', 'Programmée'),
      active: await seedCampaign(adv, 'active', 'Active'),
      completed: await seedCampaign(adv, 'completed', 'Terminée'),
    };
    await db.insert(cartItems).values({ userId: adv, campaignId: byStatus.carted });

    const result = await updateScreencasterCpm({
      userIds: [adv],
      standardCpmTnd: 12,
      eventCpmTnd: 25,
      changedBy: admin,
    });

    expect(result).toEqual({ ok: true, updated: 1, draftsRepriced: 2 });
    expect(await ratesOf(byStatus.draft)).toEqual({ standard: 12, event: 25 });
    expect(await ratesOf(byStatus.carted)).toEqual({ standard: 12, event: 25 });
    for (const kept of ['pending', 'rejected', 'upcoming', 'active', 'completed'] as const) {
      expect(await ratesOf(byStatus[kept])).toEqual({ standard: 15, event: 15 });
    }
  });

  it('changing only one rate keeps the other; the trail records old → new and the drafts count', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    await seedCampaign(adv, 'draft', 'Brouillon');

    await updateScreencasterCpm({ userIds: [adv], eventCpmTnd: 30, changedBy: admin });

    expect(await screencasterCpmRates(adv)).toEqual({ standardCpmTnd: 15, eventCpmTnd: 30 });
    const trail = await db.select().from(screencasterCpmChanges).where(eq(screencasterCpmChanges.userId, adv));
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      changedBy: admin,
      oldStandardCpmTnd: '15.000',
      newStandardCpmTnd: '15.000',
      oldEventCpmTnd: '15.000',
      newEventCpmTnd: '30.000',
      draftsRepriced: 1,
    });
  });

  it('a campaign created after the change — a replay included — captures the new CPM', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const before = await seedCampaign(adv, 'completed', 'Avant');
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 9.5, changedBy: admin });
    const replay = await seedCampaign(adv, 'draft', 'Rejouée');
    expect(await ratesOf(replay)).toEqual({ standard: 9.5, event: 15 });
    expect(await ratesOf(before)).toEqual({ standard: 15, event: 15 });
  });

  it('an activated campaign keeps its frozen plan CPM (what a boost and the settlement price at)', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const active = await seedCampaign(adv, 'active', 'Active');
    await db.insert(campaignDispatchPlan).values({
      campaignId: active, iCible: 1000, cpm: '15', sSpotSeconds: 10, tTierCoef: '0.6',
      seuilDiffusable: 1334, sMin: '20', gJour: '3.33', fMaxSeconds: 300, rMinEfficace: 2,
      couvert: 1000, nMin: 1, nMax: 20, nRetenus: 1,
    });
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 8, changedBy: admin });
    const [plan] = await db.select({ cpm: campaignDispatchPlan.cpm }).from(campaignDispatchPlan)
      .where(eq(campaignDispatchPlan.campaignId, active));
    expect(plan?.cpm).toBe('15.000');
    expect(await ratesOf(active)).toEqual({ standard: 15, event: 15 });
  });

  it('several screencasters at once, each with its own trail row', async () => {
    const admin = await seedUser({ role: 'admin' });
    const a = await seedUser();
    const b = await seedUser();
    await seedCampaign(a, 'draft', 'A1');
    await seedCampaign(b, 'draft', 'B1');
    await seedCampaign(b, 'draft', 'B2');
    const result = await updateScreencasterCpm({ userIds: [a, b, a], standardCpmTnd: 11, changedBy: admin });
    expect(result).toEqual({ ok: true, updated: 2, draftsRepriced: 3 });
    const trail = await db.select().from(screencasterCpmChanges);
    expect(trail.map((t) => [t.userId, t.draftsRepriced]).sort()).toEqual([[a, 1], [b, 2]].sort());
  });

  it('refuses a non-advertiser id and writes nothing', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const result = await updateScreencasterCpm({ userIds: [adv, owner], standardCpmTnd: 11, changedBy: admin });
    expect(result).toEqual({ ok: false, error: 'NOT_ADVERTISER', ids: [owner] });
    expect(await screencasterCpmRates(adv)).toEqual({ standardCpmTnd: 15, eventCpmTnd: 15 });
    expect(await db.select().from(screencasterCpmChanges)).toEqual([]);
  });

  it('lists advertisers only, with their CPMs, drafts and last change', async () => {
    const admin = await seedUser({ role: 'admin', contactName: 'Admin Tarifs' });
    const adv = await seedUser({ businessName: 'Agence Zeta', businessType: 'agency' });
    await seedUser({ role: 'individual_owner' });
    await seedCampaign(adv, 'draft', 'D');
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 13, changedBy: admin });

    const rows = await listScreencasterCpm();
    expect(rows.map((r) => r.id)).toEqual([adv]);
    expect(rows[0]).toMatchObject({
      company_name: 'Agence Zeta',
      business_type: 'agency',
      cpm_standard_tnd: 13,
      cpm_event_tnd: 15,
      draft_count: 1,
      last_change: { changed_by_name: 'Admin Tarifs' },
    });
  });

  it('screencasterCpmRates is null for a non-advertiser', async () => {
    expect(await screencasterCpmRates(await seedUser({ role: 'admin' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && pnpm exec vitest run tests/cpm3-screencaster-cpm.test.ts`
Expected: FAIL — « Failed to load url ../src/lib/screencaster-cpm.js ».

- [ ] **Step 3: Implement** — `apps/api/src/lib/screencaster-cpm.ts`

```ts
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../db/client.js';
import { campaigns, screencasterCpmChanges, users } from '../db/schema.js';

import type { CpmRates } from './dispatch/config.js';

// CPM-3 (operator rulings 2026-09-18) — THE home of the CPM per screencaster. The price is a
// property of the advertiser account (users.cpm_standard_tnd / cpm_event_tnd). When an admin
// changes it:
//   • the screencaster's DRAFTS take the new CPM (re-priced here, in the same transaction);
//   • pending, rejected, upcoming, active and completed campaigns keep the CPM they carry — this
//     file never touches them; activated ones price at the frozen plan.cpm anyway;
//   • a campaign created afterwards captures the new CPM through the migration-0076 trigger.
// Every change writes one screencaster_cpm_changes row per screencaster.

export interface ScreencasterCpmRow {
  id: string;
  company_name: string | null;
  contact_name: string;
  email: string;
  business_type: string | null;
  status: string;
  cpm_standard_tnd: number;
  cpm_event_tnd: number;
  draft_count: number;
  last_change: { changed_at: string; changed_by_name: string } | null;
}

export type UpdateScreencasterCpmResult =
  | { ok: true; updated: number; draftsRepriced: number }
  | { ok: false; error: 'NOT_ADVERTISER'; ids: string[] };

const changer = alias(users, 'changer');

/** Every advertiser account with its CPMs, its draft count and its last CPM change. */
export const listScreencasterCpm = async (): Promise<ScreencasterCpmRow[]> => {
  const advertisers = await db
    .select({
      id: users.id,
      businessName: users.businessName,
      contactName: users.contactName,
      email: users.email,
      businessType: users.businessType,
      status: users.status,
      cpmStandardTnd: users.cpmStandardTnd,
      cpmEventTnd: users.cpmEventTnd,
    })
    .from(users)
    .where(eq(users.role, 'advertiser'))
    .orderBy(asc(sql`lower(coalesce(${users.businessName}, ${users.contactName}))`));
  if (advertisers.length === 0) return [];
  const ids = advertisers.map((a) => a.id);

  const drafts = await db
    .select({ advertiserId: campaigns.advertiserId, n: count() })
    .from(campaigns)
    .where(and(inArray(campaigns.advertiserId, ids), eq(campaigns.status, 'draft')))
    .groupBy(campaigns.advertiserId);
  const draftsBy = new Map(drafts.map((d) => [d.advertiserId, d.n]));

  const changes = await db
    .selectDistinctOn([screencasterCpmChanges.userId], {
      userId: screencasterCpmChanges.userId,
      changedAt: screencasterCpmChanges.changedAt,
      changedByName: changer.contactName,
    })
    .from(screencasterCpmChanges)
    .innerJoin(changer, eq(screencasterCpmChanges.changedBy, changer.id))
    .where(inArray(screencasterCpmChanges.userId, ids))
    .orderBy(screencasterCpmChanges.userId, desc(screencasterCpmChanges.changedAt));
  const changeBy = new Map(changes.map((c) => [c.userId, c]));

  return advertisers.map((a) => {
    const last = changeBy.get(a.id);
    return {
      id: a.id,
      company_name: a.businessName,
      contact_name: a.contactName,
      email: a.email,
      business_type: a.businessType,
      status: a.status,
      cpm_standard_tnd: Number(a.cpmStandardTnd),
      cpm_event_tnd: Number(a.cpmEventTnd),
      draft_count: draftsBy.get(a.id) ?? 0,
      last_change: last
        ? { changed_at: last.changedAt.toISOString(), changed_by_name: last.changedByName }
        : null,
    };
  });
};

/** The CPMs a NEW campaign of this screencaster captures, or null for a non-advertiser. */
export const screencasterCpmRates = async (userId: string): Promise<CpmRates | null> => {
  const [row] = await db
    .select({ role: users.role, s: users.cpmStandardTnd, e: users.cpmEventTnd })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.role !== 'advertiser') return null;
  return { standardCpmTnd: Number(row.s), eventCpmTnd: Number(row.e) };
};

/**
 * Change the CPM of one or many screencasters (either rate or both) in ONE transaction: lock
 * them, refuse any id that is not an advertiser (nothing written), update each account, re-price
 * its drafts to the account's rates, write its trail row.
 */
export const updateScreencasterCpm = async (input: {
  userIds: readonly string[];
  standardCpmTnd?: number;
  eventCpmTnd?: number;
  changedBy: string;
}): Promise<UpdateScreencasterCpmResult> =>
  db.transaction(async (tx) => {
    const ids = [...new Set(input.userIds)];
    const rows = await tx
      .select({
        id: users.id,
        role: users.role,
        cpmStandardTnd: users.cpmStandardTnd,
        cpmEventTnd: users.cpmEventTnd,
      })
      .from(users)
      .where(inArray(users.id, ids))
      .for('update');
    const bad = ids.filter((id) => rows.find((r) => r.id === id)?.role !== 'advertiser');
    if (bad.length > 0) return { ok: false as const, error: 'NOT_ADVERTISER' as const, ids: bad };

    let draftsRepriced = 0;
    for (const row of rows) {
      const newStandard =
        input.standardCpmTnd !== undefined ? input.standardCpmTnd.toFixed(3) : row.cpmStandardTnd;
      const newEvent =
        input.eventCpmTnd !== undefined ? input.eventCpmTnd.toFixed(3) : row.cpmEventTnd;
      await tx
        .update(users)
        .set({ cpmStandardTnd: newStandard, cpmEventTnd: newEvent })
        .where(eq(users.id, row.id));
      // A draft follows its screencaster: BOTH rates are aligned on the account's.
      const repriced = await tx
        .update(campaigns)
        .set({ standardCpmTnd: newStandard, eventCpmTnd: newEvent })
        .where(and(eq(campaigns.advertiserId, row.id), eq(campaigns.status, 'draft')))
        .returning({ id: campaigns.id });
      await tx.insert(screencasterCpmChanges).values({
        userId: row.id,
        changedBy: input.changedBy,
        oldStandardCpmTnd: row.cpmStandardTnd,
        newStandardCpmTnd: newStandard,
        oldEventCpmTnd: row.cpmEventTnd,
        newEventCpmTnd: newEvent,
        draftsRepriced: repriced.length,
      });
      draftsRepriced += repriced.length;
    }
    return { ok: true as const, updated: rows.length, draftsRepriced };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && pnpm exec vitest run tests/cpm3-screencaster-cpm.test.ts`
Expected: PASS (8 tests). If `last_change.changed_by_name` or ordering differs, fix the code, not the test.

- [ ] **Step 5: Typecheck + format**

Run: `pnpm exec prettier --write apps/api/src/lib/screencaster-cpm.ts apps/api/tests/cpm3-screencaster-cpm.test.ts && pnpm --filter @toodooh/api typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/screencaster-cpm.ts apps/api/tests/cpm3-screencaster-cpm.test.ts
git commit -m "feat(api): CPM-3 — change screencasters' CPM in bulk; their drafts follow, nothing else moves"
```

---

### Task 4: Admin routes `GET/PATCH /api/admin/screencasters/cpm`

**Files:**
- Create: `apps/api/src/routes/admin-screencaster-cpm.ts`
- Modify: `apps/api/src/routes/index.ts` (import next to `adminDispatchConfigRoutes`, register right after it)
- Create: `apps/api/tests/admin-screencaster-cpm.test.ts`

**Interfaces:**
- Consumes: `listScreencasterCpm`, `updateScreencasterCpm` (Task 3).
- Produces (wire): `GET → 200 { screencasters: ScreencasterCpmRow[] }`; `PATCH body { user_ids: string[]; standard_cpm_tnd?: number; event_cpm_tnd?: number }` → `200 { updated: number; drafts_repriced: number }` | `400 { error: 'INVALID_INPUT', fields }` | `400 { error: 'NOT_ADVERTISER', user_ids }`.

- [ ] **Step 1: Write the failing route tests** — `apps/api/tests/admin-screencaster-cpm.test.ts`

```ts
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, users } from '../src/db/schema.js';
import { adminScreencasterCpmRoutes } from '../src/routes/admin-screencaster-cpm.js';

import { type CpmConfigSnapshot, pinCpmConfig, restoreCpmConfig } from './helpers/cpm-config.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};
let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `sccpm${seq}@example.com`, contactName: `User ${seq}`, status: 'approved', ...values })
    .returning({ id: users.id });
  return u?.id ?? '';
};

describe('admin screencaster CPM — GET/PATCH /api/admin/screencasters/cpm (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let pinned: CpmConfigSnapshot;

  beforeEach(async () => {
    await resetAuthTables();
    pinned = await pinCpmConfig('15.000', '15.000');
    app = buildApp();
    await app.register(adminScreencasterCpmRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await restoreCpmConfig(pinned);
  });
  afterAll(async () => {
    await sql.end();
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/admin/screencasters/cpm', payload });

  it('a non-admin gets 403 on both routes', async () => {
    mockSession(await seedUser(), 'advertiser');
    expect((await app.inject({ method: 'GET', url: '/api/admin/screencasters/cpm' })).statusCode).toBe(403);
    expect((await patch({ user_ids: [], standard_cpm_tnd: 10 })).statusCode).toBe(403);
  });

  it('GET lists the screencasters with numbers in snake_case', async () => {
    const adv = await seedUser({ businessName: 'Café Média' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await app.inject({ method: 'GET', url: '/api/admin/screencasters/cpm' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      screencasters: [
        expect.objectContaining({
          id: adv,
          company_name: 'Café Média',
          cpm_standard_tnd: 15,
          cpm_event_tnd: 15,
          draft_count: 0,
          last_change: null,
        }),
      ],
    });
  });

  it('PATCH applies to several screencasters and reports the drafts it re-priced', async () => {
    const a = await seedUser();
    const b = await seedUser();
    await db.insert(campaigns).values({ advertiserId: a, name: 'Brouillon', campaignType: 'standard' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await patch({ user_ids: [a, b], standard_cpm_tnd: 12.5, event_cpm_tnd: 20 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, drafts_repriced: 1 });
  });

  it('PATCH validation: no id, no CPM, a non-positive CPM → 400 INVALID_INPUT', async () => {
    const adv = await seedUser();
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    for (const body of [
      { user_ids: [], standard_cpm_tnd: 10 },
      { user_ids: [adv] },
      { user_ids: [adv], standard_cpm_tnd: 0 },
      { user_ids: [adv], event_cpm_tnd: -1 },
      { user_ids: ['not-a-uuid'], standard_cpm_tnd: 10 },
    ]) {
      const res = await patch(body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_INPUT' });
    }
  });

  it('PATCH with a non-advertiser id → 400 NOT_ADVERTISER naming it', async () => {
    const adv = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const res = await patch({ user_ids: [adv, owner], standard_cpm_tnd: 10 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'NOT_ADVERTISER', user_ids: [owner] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm exec vitest run tests/admin-screencaster-cpm.test.ts`
Expected: FAIL — cannot load `../src/routes/admin-screencaster-cpm.js`.

- [ ] **Step 3: Implement the routes** — `apps/api/src/routes/admin-screencaster-cpm.ts`

```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { listScreencasterCpm, updateScreencasterCpm } from '../lib/screencaster-cpm.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';

// CPM-3 (operator rulings 2026-09-18) — the admin « CPM par screencaster » surface. GET lists
// every screencaster with its CPMs; PATCH changes one or many at once (either rate or both). The
// rule — drafts follow, every other campaign keeps its price — lives in lib/screencaster-cpm.ts.

// A CPM is a strictly-positive TND / 1000 rate (0 would blow up I_cible = ⌊budget·1000/cpm⌋);
// numeric(10,3) holds up to 9 999 999.999 — the cap keeps a typo from overflowing it.
const cpmField = z.number().positive().finite().max(1_000_000);
const patchSchema = z
  .object({
    user_ids: z.array(z.uuid()).min(1).max(500),
    standard_cpm_tnd: cpmField.optional(),
    event_cpm_tnd: cpmField.optional(),
  })
  .refine((b) => b.standard_cpm_tnd !== undefined || b.event_cpm_tnd !== undefined, {
    message: 'at least one CPM is required',
    path: ['standard_cpm_tnd'],
  });

export const adminScreencasterCpmRoutes: FastifyPluginAsync = async (app) => {
  const adminGuard = { preHandler: [requireAuth, requireAdmin] };

  app.get('/api/admin/screencasters/cpm', adminGuard, async (_request, reply) =>
    reply.status(200).send({ screencasters: await listScreencasterCpm() }),
  );

  app.patch('/api/admin/screencasters/cpm', adminGuard, async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const adminId = request.user?.id;
    if (!adminId) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'Authentification requise.' });
    }
    const result = await updateScreencasterCpm({
      userIds: parsed.data.user_ids,
      ...(parsed.data.standard_cpm_tnd !== undefined
        ? { standardCpmTnd: parsed.data.standard_cpm_tnd }
        : {}),
      ...(parsed.data.event_cpm_tnd !== undefined ? { eventCpmTnd: parsed.data.event_cpm_tnd } : {}),
      changedBy: adminId,
    });
    if (!result.ok) {
      return reply.status(400).send({
        error: 'NOT_ADVERTISER',
        message: 'Seuls les screencasters (annonceurs) ont un CPM.',
        user_ids: result.ids,
      });
    }
    return reply.status(200).send({ updated: result.updated, drafts_repriced: result.draftsRepriced });
  });
};
```

- [ ] **Step 4: Register it** — in `apps/api/src/routes/index.ts`: add `import { adminScreencasterCpmRoutes } from './admin-screencaster-cpm.js';` in the sorted import block (import-x/order is enforced — run `pnpm exec eslint --fix apps/api/src/routes/index.ts`), and right after `await app.register(adminDispatchConfigRoutes);`:

```ts
  await app.register(adminScreencasterCpmRoutes); // CPM-3 — the CPM per screencaster
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && pnpm exec vitest run tests/admin-screencaster-cpm.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm exec prettier --write apps/api/src/routes/admin-screencaster-cpm.ts apps/api/tests/admin-screencaster-cpm.test.ts
pnpm --filter @toodooh/api typecheck
git add apps/api/src/routes/admin-screencaster-cpm.ts apps/api/src/routes/index.ts apps/api/tests/admin-screencaster-cpm.test.ts
git commit -m "feat(api): CPM-3 — GET/PATCH /api/admin/screencasters/cpm"
```

---

### Task 5: The caller's own CPM — wizard estimate and event C_max

**Files:**
- Modify: `apps/api/src/routes/campaigns-pricing.ts` (handler + header comment)
- Modify: `apps/api/src/routes/events.ts:251-282` (`GET /api/events/:id/cmax`)
- Modify: `apps/api/tests/campaigns-pricing.test.ts` (add 2 tests)
- Modify: `apps/api/tests/ev2-event-pricing.test.ts` (add 1 test after the `/cmax` idiom test, ~line 390)

**Interfaces:**
- Consumes: `screencasterCpmRates(userId): Promise<CpmRates | null>` (Task 3); `updateScreencasterCpm` (Task 3) in tests.

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/campaigns-pricing.test.ts`, add the import `import { updateScreencasterCpm } from '../src/lib/screencaster-cpm.js';` and append inside the `describe`:

```ts
  it('CPM-3 — an advertiser reads THEIR OWN CPM: their change shows, a later default change does not', async () => {
    const admin = await seedUser({ role: 'admin' });
    const adv = await seedUser({ role: 'advertiser' }); // starts at the default 15 / 15
    await updateScreencasterCpm({ userIds: [adv], standardCpmTnd: 11, eventCpmTnd: 21, changedBy: admin });
    await db.update(dispatchConfig).set({ standardCpmTnd: '30.000', eventCpmTnd: '40.000' });

    mockSession(adv, 'advertiser');
    const body = (await getPricing()).json() as { standard_cpm_tnd: number; event_cpm_tnd: number };
    expect(body.standard_cpm_tnd).toBe(11);
    expect(body.event_cpm_tnd).toBe(21);
  });

  it('CPM-3 — a non-advertiser reads the global default', async () => {
    await db.update(dispatchConfig).set({ standardCpmTnd: '30.000', eventCpmTnd: '40.000' });
    mockSession(await seedUser({ role: 'admin' }), 'admin');
    const body = (await getPricing()).json() as { standard_cpm_tnd: number; event_cpm_tnd: number };
    expect(body.standard_cpm_tnd).toBe(30);
    expect(body.event_cpm_tnd).toBe(40);
  });
```

In `apps/api/tests/ev2-event-pricing.test.ts`, add `users` to the schema import if missing and, right after the `it('GET /api/events/:id/cmax — the campaign-cmax idiom …')` test:

```ts
    it('CPM-3 — GET /api/events/:id/cmax prices the match at the CALLER’s own event CPM', async () => {
      const sectors = await ownerSectors();
      await seedVenue({ sector: sectors[0] ?? '', affluence: [120] });
      const eventId = await seedEvent();
      const advId = await seedUser({ role: 'advertiser' });
      await db.update(users).set({ cpmEventTnd: '30.000' }).where(eq(users.id, advId));
      mockSession(advId, 'advertiser');

      const res = await app.inject({ method: 'GET', url: `/api/events/${eventId}/cmax` });
      expect(res.statusCode).toBe(200);
      expect(res.json().c_max_evt_tnd).toBe(Math.floor((30 * 120 * 20 * 6) / 1000)); // 432, not 216
    });
```

- [ ] **Step 2: Run to verify the new route tests fail**

Run: `cd apps/api && pnpm exec vitest run tests/campaigns-pricing.test.ts && pnpm exec vitest run tests/ev2-event-pricing.test.ts`
Expected: the two CPM-3 pricing tests FAIL (11 ≠ 30 / 30 ≠ 40…) and the event test FAILS (216 ≠ 432).

- [ ] **Step 3: Implement** — `apps/api/src/routes/campaigns-pricing.ts`

Add the import `import { screencasterCpmRates } from '../lib/screencaster-cpm.js';` and replace the handler body:

```ts
    async (request, reply) => {
      const cfg = await getDispatchConfig();
      // CPM-3 — an advertiser's estimate is priced at THEIR OWN CPM (the one a campaign they
      // create now captures); any other role sees the global default of new screencasters.
      const own = request.user ? await screencasterCpmRates(request.user.id) : null;
      return reply.status(200).send({
        standard_cpm_tnd: own?.standardCpmTnd ?? cfg.standardCpmTnd,
        event_cpm_tnd: own?.eventCpmTnd ?? cfg.eventCpmTnd,
        // CF-Q2 (spec §1.4) — the working-day start floor, computed server-side in ONE place
        // (lib/campaign-dates) so the wizard consumes it instead of hardcoding the rule.
        first_available_start_date: premiereDateDisponible(new Date(), cfg.campaignLeadWorkingDays),
      });
    },
```

Replace the last paragraph of the file header (the `// CPM-1 — these are the rates …` lines) with:

```ts
// CPM-3 — for an advertiser these are THEIR OWN rates (users.cpm_*_tnd), the ones a campaign they
// create now captures; other roles get the global default of new screencasters. An existing
// campaign carries its own copy (the campaign projection's standard_cpm_tnd / event_cpm_tnd).
```

In `apps/api/src/routes/events.ts`, add `import { screencasterCpmRates } from '../lib/screencaster-cpm.js';` and in `GET /api/events/:id/cmax` replace the `// CPM-1 — this prices the MATCH …` comment + `const cfg = …` + the `computeEventCmax(…)` call with:

```ts
    // CPM-3 — this prices the MATCH for THIS caller (no positioning exists yet): at the event CPM
    // a positioning they create now would capture — their own. An existing positioning's ceiling
    // is GET /api/campaigns/:id/cmax, priced at its own copy.
    const own = request.user ? await screencasterCpmRates(request.user.id) : null;
    const eventCpm = own?.eventCpmTnd ?? (await getDispatchConfig()).eventCpmTnd;
    const result = await computeEventCmax(
      { id: row.id, kickoffAt: row.kickoffAt, endsAt: row.endsAt },
      eventCpm,
    );
```

- [ ] **Step 4: Run the four files**

Run (one at a time): `cd apps/api && for f in campaigns-pricing ev2-event-pricing cpm1-event-cpm-snapshot; do pnpm exec vitest run tests/$f.test.ts || break; done`
Expected: all PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm exec prettier --write apps/api/src/routes/campaigns-pricing.ts apps/api/src/routes/events.ts apps/api/tests/campaigns-pricing.test.ts apps/api/tests/ev2-event-pricing.test.ts 
pnpm --filter @toodooh/api typecheck
git add apps/api/src/routes/campaigns-pricing.ts apps/api/src/routes/events.ts apps/api/tests/campaigns-pricing.test.ts apps/api/tests/ev2-event-pricing.test.ts 
git commit -m "feat(api): CPM-3 — the wizard estimate and the event ceiling use the caller's own CPM"
```

---

### Task 6: Web data layer — service, query key, hooks, pure helpers

**Files:**
- Create: `apps/web/src/features/admin/services/admin-screencaster-cpm.service.ts`
- Modify: `apps/web/src/features/admin/hooks/queryKeys.ts` (add after `dispatchConfig`)
- Create: `apps/web/src/features/admin/hooks/useScreencasterCpm.ts`
- Create: `apps/web/src/features/admin/lib/screencaster-cpm.ts`
- Create: `apps/web/src/features/admin/lib/screencaster-cpm.test.ts`

**Interfaces:**
- Consumes (wire, Task 4): `GET /api/admin/screencasters/cpm`, `PATCH /api/admin/screencasters/cpm`.
- Produces:
  - types `ScreencasterCpmRow`, `ScreencasterCpmPatch { user_ids: string[]; standard_cpm_tnd?: number; event_cpm_tnd?: number }`, `ScreencasterCpmPatchResult { updated: number; drafts_repriced: number }`
  - `adminScreencasterCpmService.list(): Promise<{ screencasters: ScreencasterCpmRow[] }>`, `.update(body): Promise<ScreencasterCpmPatchResult>`
  - `adminKeys.screencasterCpm(): readonly ['admin', 'screencasterCpm']`
  - hooks `useScreencasterCpmList()` → `{ rows: ScreencasterCpmRow[]; loading: boolean; isError: boolean; refetch: () => void }`, `useUpdateScreencasterCpm()` (TanStack mutation)
  - helpers `screencasterName(row)`, `filterScreencasters(rows, query)`, `toggleSelected(selected, id)`, `setFilteredSelected(selected, filtered, on)`, `allFilteredSelected(selected, filtered)`, `draftsAffected(rows, selected)`, `composeScreencasterCpmPatch(ids, standardInput, eventInput)` → `{ ok: true; body: ScreencasterCpmPatch } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing helper tests** — `apps/web/src/features/admin/lib/screencaster-cpm.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import type { ScreencasterCpmRow } from '@/features/admin/services/admin-screencaster-cpm.service';

import {
  allFilteredSelected,
  composeScreencasterCpmPatch,
  draftsAffected,
  filterScreencasters,
  screencasterName,
  setFilteredSelected,
  toggleSelected,
} from './screencaster-cpm';

const row = (over: Partial<ScreencasterCpmRow>): ScreencasterCpmRow => ({
  id: 'id',
  company_name: null,
  contact_name: 'Contact',
  email: 'c@example.com',
  business_type: null,
  status: 'approved',
  cpm_standard_tnd: 15,
  cpm_event_tnd: 15,
  draft_count: 0,
  last_change: null,
  ...over,
});
const rows = [
  row({ id: 'a', company_name: 'Café Médina', email: 'cafe@medina.tn', draft_count: 2 }),
  row({ id: 'b', contact_name: 'Sami Ben Ali', email: 'sami@example.com', draft_count: 1 }),
  row({ id: 'c', company_name: 'Agence Zeta', email: 'zeta@agence.tn' }),
];

describe('screencasterName', () => {
  it('prefers the company, falls back to the contact', () => {
    expect(screencasterName(rows[0]!)).toBe('Café Médina');
    expect(screencasterName(rows[1]!)).toBe('Sami Ben Ali');
  });
});

describe('filterScreencasters — accent- and case-insensitive over company, contact, email', () => {
  it('matches without accents or case', () => {
    expect(filterScreencasters(rows, 'cafe medina').map((r) => r.id)).toEqual(['a']);
    expect(filterScreencasters(rows, 'SAMI').map((r) => r.id)).toEqual(['b']);
    expect(filterScreencasters(rows, 'agence.tn').map((r) => r.id)).toEqual(['c']);
  });
  it('an empty query keeps everything', () => {
    expect(filterScreencasters(rows, '  ')).toHaveLength(3);
  });
});

describe('selection', () => {
  it('toggles one id', () => {
    expect([...toggleSelected(new Set(['a']), 'b')].sort()).toEqual(['a', 'b']);
    expect([...toggleSelected(new Set(['a']), 'a')]).toEqual([]);
  });
  it('« tout sélectionner » acts on the FILTERED rows only, keeping other selections', () => {
    const filtered = filterScreencasters(rows, 'cafe');
    expect([...setFilteredSelected(new Set(['b']), filtered, true)].sort()).toEqual(['a', 'b']);
    expect([...setFilteredSelected(new Set(['a', 'b']), filtered, false)]).toEqual(['b']);
    expect(allFilteredSelected(new Set(['a']), filtered)).toBe(true);
    expect(allFilteredSelected(new Set(['a']), [])).toBe(false);
  });
  it('counts the drafts the change will re-price', () => {
    expect(draftsAffected(rows, new Set(['a', 'b']))).toBe(3);
  });
});

describe('composeScreencasterCpmPatch', () => {
  it('sends only the rates typed, accepting a French decimal comma', () => {
    expect(composeScreencasterCpmPatch(['a'], '12,5', '')).toEqual({
      ok: true,
      body: { user_ids: ['a'], standard_cpm_tnd: 12.5 },
    });
    expect(composeScreencasterCpmPatch(['a', 'b'], '', '20')).toEqual({
      ok: true,
      body: { user_ids: ['a', 'b'], event_cpm_tnd: 20 },
    });
  });
  it('refuses no selection, no rate, or a non-positive rate', () => {
    expect(composeScreencasterCpmPatch([], '10', '')).toEqual({
      ok: false,
      error: 'Sélectionnez au moins un screencaster',
    });
    expect(composeScreencasterCpmPatch(['a'], ' ', '')).toEqual({
      ok: false,
      error: 'Saisissez au moins un CPM',
    });
    expect(composeScreencasterCpmPatch(['a'], '0', '')).toEqual({
      ok: false,
      error: 'Le CPM doit être un nombre strictement positif',
    });
    expect(composeScreencasterCpmPatch(['a'], 'abc', '')).toEqual({
      ok: false,
      error: 'Le CPM doit être un nombre strictement positif',
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/features/admin/lib/screencaster-cpm.test.ts`
Expected: FAIL — cannot resolve `./screencaster-cpm`.

- [ ] **Step 3: Write the service** — `apps/web/src/features/admin/services/admin-screencaster-cpm.service.ts`

```ts
import { apiClient } from '@/lib/api-client';

// CPM-3 (operator rulings 2026-09-18) — the admin « CPM par screencaster » surface over REST
// (GET/PATCH /api/admin/screencasters/cpm, both [requireAuth, requireAdmin]). apiClient prepends
// '/api'. A change re-prices the screencasters' drafts; every other campaign keeps its price.

export interface ScreencasterCpmRow {
  id: string;
  company_name: string | null;
  contact_name: string;
  email: string;
  business_type: string | null;
  status: string;
  cpm_standard_tnd: number;
  cpm_event_tnd: number;
  draft_count: number;
  last_change: { changed_at: string; changed_by_name: string } | null;
}

export interface ScreencasterCpmPatch {
  user_ids: string[];
  standard_cpm_tnd?: number;
  event_cpm_tnd?: number;
}

export interface ScreencasterCpmPatchResult {
  updated: number;
  drafts_repriced: number;
}

export const adminScreencasterCpmService = {
  list(): Promise<{ screencasters: ScreencasterCpmRow[] }> {
    return apiClient.get<{ screencasters: ScreencasterCpmRow[] }>('/admin/screencasters/cpm');
  },
  update(body: ScreencasterCpmPatch): Promise<ScreencasterCpmPatchResult> {
    return apiClient.patch<ScreencasterCpmPatchResult>('/admin/screencasters/cpm', body);
  },
};
```

- [ ] **Step 4: Write the helpers** — `apps/web/src/features/admin/lib/screencaster-cpm.ts`

```ts
import type {
  ScreencasterCpmPatch,
  ScreencasterCpmRow,
} from '@/features/admin/services/admin-screencaster-cpm.service';

// CPM-3 — the pure logic of the « CPM par screencaster » table (apps/web has no render harness,
// so it is tested here): search, selection of the FILTERED rows, the drafts a change re-prices,
// and the PATCH body.

/** Accent-, case- and space-insensitive form used by the search. */
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The name the table shows: the company when there is one, else the contact. */
export const screencasterName = (row: ScreencasterCpmRow): string =>
  row.company_name?.trim() || row.contact_name;

export const filterScreencasters = (
  rows: readonly ScreencasterCpmRow[],
  query: string,
): ScreencasterCpmRow[] => {
  const q = fold(query);
  if (q === '') return [...rows];
  return rows.filter((r) =>
    [r.company_name ?? '', r.contact_name, r.email].some((field) => fold(field).includes(q)),
  );
};

export const toggleSelected = (selected: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** « Tout sélectionner » — adds or removes the FILTERED rows, leaving other selections alone. */
export const setFilteredSelected = (
  selected: ReadonlySet<string>,
  filtered: readonly ScreencasterCpmRow[],
  on: boolean,
): Set<string> => {
  const next = new Set(selected);
  for (const r of filtered) {
    if (on) next.add(r.id);
    else next.delete(r.id);
  }
  return next;
};

export const allFilteredSelected = (
  selected: ReadonlySet<string>,
  filtered: readonly ScreencasterCpmRow[],
): boolean => filtered.length > 0 && filtered.every((r) => selected.has(r.id));

/** How many drafts the change will re-price (Σ draft_count of the selected screencasters). */
export const draftsAffected = (
  rows: readonly ScreencasterCpmRow[],
  selected: ReadonlySet<string>,
): number => rows.reduce((sum, r) => (selected.has(r.id) ? sum + r.draft_count : sum), 0);

const parseRate = (input: string): number | null | 'invalid' => {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 'invalid';
};

export const composeScreencasterCpmPatch = (
  ids: readonly string[],
  standardInput: string,
  eventInput: string,
): { ok: true; body: ScreencasterCpmPatch } | { ok: false; error: string } => {
  if (ids.length === 0) return { ok: false, error: 'Sélectionnez au moins un screencaster' };
  const standard = parseRate(standardInput);
  const event = parseRate(eventInput);
  if (standard === 'invalid' || event === 'invalid') {
    return { ok: false, error: 'Le CPM doit être un nombre strictement positif' };
  }
  if (standard === null && event === null) return { ok: false, error: 'Saisissez au moins un CPM' };
  return {
    ok: true,
    body: {
      user_ids: [...ids],
      ...(standard !== null ? { standard_cpm_tnd: standard } : {}),
      ...(event !== null ? { event_cpm_tnd: event } : {}),
    },
  };
};
```

- [ ] **Step 5: Query key + hooks**

In `apps/web/src/features/admin/hooks/queryKeys.ts`, right after the `dispatchConfig` entry:

```ts
  /** CPM-3 — the « CPM par screencaster » table (GET /api/admin/screencasters/cpm). */
  screencasterCpm: () => [...adminKeys.all, 'screencasterCpm'] as const,
```

Create `apps/web/src/features/admin/hooks/useScreencasterCpm.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminScreencasterCpmService,
  type ScreencasterCpmPatch,
  type ScreencasterCpmRow,
} from '@/features/admin/services/admin-screencaster-cpm.service';

import { adminKeys } from './queryKeys';

/** CPM-3 — every screencaster with its CPMs. */
export function useScreencasterCpmList(): {
  rows: ScreencasterCpmRow[];
  loading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: adminKeys.screencasterCpm(),
    queryFn: () => adminScreencasterCpmService.list(),
  });
  return {
    rows: query.data?.screencasters ?? [],
    loading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** CPM-3 — change the CPM of the selected screencasters; the list is re-read afterwards. */
export function useUpdateScreencasterCpm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ScreencasterCpmPatch) => adminScreencasterCpmService.update(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.screencasterCpm() });
    },
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && pnpm exec vitest run src/features/admin/lib/screencaster-cpm.test.ts src/features/admin/hooks/queryKeys.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm exec prettier --write apps/web/src/features/admin/services/admin-screencaster-cpm.service.ts apps/web/src/features/admin/lib/screencaster-cpm.ts apps/web/src/features/admin/lib/screencaster-cpm.test.ts apps/web/src/features/admin/hooks/useScreencasterCpm.ts apps/web/src/features/admin/hooks/queryKeys.ts
pnpm --filter @toodooh/web typecheck 2>&1 | grep -c "error TS"   # expect 11, all pre-existing
git add apps/web/src/features/admin/services/admin-screencaster-cpm.service.ts apps/web/src/features/admin/lib/screencaster-cpm.ts apps/web/src/features/admin/lib/screencaster-cpm.test.ts apps/web/src/features/admin/hooks/useScreencasterCpm.ts apps/web/src/features/admin/hooks/queryKeys.ts
git commit -m "feat(web): CPM-3 — the screencaster CPM service, hooks and table logic"
```

---

### Task 7: Web UI — the « CPM par screencaster » section on `/admin-dispatch-config`

**Files:**
- Create: `apps/web/src/features/admin/components/screencaster-cpm/ScreencasterCpmBulkBar.tsx`
- Create: `apps/web/src/features/admin/components/screencaster-cpm/ScreencasterCpmSection.tsx`
- Modify: `apps/web/src/features/admin/pages/DispatchConfigManagement.tsx` (mount above `ConfigForm`, relabel the « CPM éditable » card)

**Interfaces:**
- Consumes: everything Task 6 produces.
- Produces: `<ScreencasterCpmSection />` (no props).

- [ ] **Step 1: The bulk bar** — `ScreencasterCpmBulkBar.tsx`

```tsx
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'react-hot-toast';

import { useUpdateScreencasterCpm } from '@/features/admin/hooks/useScreencasterCpm';
import { composeScreencasterCpmPatch } from '@/features/admin/lib/screencaster-cpm';
import { getErrorMessage } from '@/lib/errors';

// CPM-3 — appears once ≥ 1 screencaster is selected: two optional rates, then a confirmation that
// states the rule before anything is written (no browser dialog: an inline step).

interface Props {
  selectedIds: string[];
  draftCount: number;
  onDone: () => void;
}

const inputClass =
  'w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent';

export function ScreencasterCpmBulkBar({ selectedIds, draftCount, onDone }: Props) {
  const mutation = useUpdateScreencasterCpm();
  const [standard, setStandard] = useState('');
  const [event, setEvent] = useState('');
  const [confirming, setConfirming] = useState(false);
  const n = selectedIds.length;

  const ask = () => {
    const composed = composeScreencasterCpmPatch(selectedIds, standard, event);
    if (!composed.ok) {
      toast.error(composed.error);
      return;
    }
    setConfirming(true);
  };

  const apply = async () => {
    const composed = composeScreencasterCpmPatch(selectedIds, standard, event);
    if (!composed.ok) return;
    try {
      const result = await mutation.mutateAsync(composed.body);
      toast.success(
        `CPM mis à jour pour ${result.updated} screencaster${result.updated > 1 ? 's' : ''} — ${result.drafts_repriced} brouillon${result.drafts_repriced > 1 ? 's' : ''} re-tarifé${result.drafts_repriced > 1 ? 's' : ''}`,
      );
      setStandard('');
      setEvent('');
      setConfirming(false);
      onDone();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e) || 'Mise à jour impossible');
    }
  };

  return (
    <div className="rounded-xl border border-brand-primary/40 bg-brand-primary/5 p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm font-medium text-gray-900 mr-2">
          {n} screencaster{n > 1 ? 's' : ''} sélectionné{n > 1 ? 's' : ''}
        </p>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Nouveau CPM standard (TND / 1000)</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={standard}
            onChange={(e) => setStandard(e.target.value)}
            placeholder="inchangé"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Nouveau CPM événement (TND / 1000)</span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            placeholder="inchangé"
          />
        </label>
        {!confirming && (
          <button
            type="button"
            onClick={ask}
            className="px-4 py-2.5 rounded-xl bg-brand-primary text-brand-deep text-sm font-medium hover:opacity-90"
          >
            Appliquer à {n} screencaster{n > 1 ? 's' : ''}
          </button>
        )}
      </div>
      {confirming && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p>
            Les brouillons de ces screencasters ({draftCount}) passent au nouveau CPM, ainsi que
            leurs prochaines campagnes. Les campagnes en attente, refusées, programmées, actives et
            terminées gardent leur prix.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-deep text-white text-sm font-medium disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmer
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: The section** — `ScreencasterCpmSection.tsx`

```tsx
import { Loader2, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ScreencasterCpmBulkBar } from '@/features/admin/components/screencaster-cpm/ScreencasterCpmBulkBar';
import { formatAdminDateTime } from '@/features/admin/lib/admin-dates';
import {
  allFilteredSelected,
  draftsAffected,
  filterScreencasters,
  screencasterName,
  setFilteredSelected,
  toggleSelected,
} from '@/features/admin/lib/screencaster-cpm';
import { useScreencasterCpmList } from '@/features/admin/hooks/useScreencasterCpm';

// CPM-3 (operator rulings 2026-09-18) — every screencaster with its own CPMs; search, select one
// or many, change their CPM together (ScreencasterCpmBulkBar).

const STATUS_LABEL: Record<string, string> = {
  pending: 'en attente',
  approved: 'validé',
  rejected: 'refusé',
  banned: 'banni',
};

export function ScreencasterCpmSection() {
  const { rows, loading, isError, refetch } = useScreencasterCpmList();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => filterScreencasters(rows, query), [rows, query]);
  const allOn = allFilteredSelected(selected, filtered);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-brand-primary" />
        <h3 className="text-lg font-semibold text-gray-900">CPM par screencaster</h3>
      </div>
      <p className="text-sm text-gray-500">
        Chaque screencaster a son propre CPM. Un changement s’applique à ses brouillons et à ses
        prochaines campagnes ; les campagnes déjà confirmées gardent leur prix.
      </p>
      <label className="relative block max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un screencaster (société, contact, e-mail)"
          aria-label="Rechercher un screencaster"
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 focus:ring-2 focus:ring-brand-primary focus:border-transparent"
        />
      </label>

      {selected.size > 0 && (
        <ScreencasterCpmBulkBar
          selectedIds={[...selected]}
          draftCount={draftsAffected(rows, selected)}
          onDone={() => setSelected(new Set())}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
        </div>
      ) : isError ? (
        <div className="text-sm text-rose-600">
          Impossible de charger les screencasters.{' '}
          <button type="button" onClick={refetch} className="underline">
            Réessayer
          </button>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-3">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner (résultats filtrés)"
                    checked={allOn}
                    onChange={() => setSelected(setFilteredSelected(selected, filtered, !allOn))}
                  />
                </th>
                <th className="py-2 pr-4">screencaster</th>
                <th className="py-2 pr-4">e-mail</th>
                <th className="py-2 pr-4">type</th>
                <th className="py-2 pr-4">statut</th>
                <th className="py-2 pr-4">CPM standard (TND / 1000)</th>
                <th className="py-2 pr-4">CPM événement (TND / 1000)</th>
                <th className="py-2 pr-4">brouillons</th>
                <th className="py-2 pr-4">dernière modification</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${screencasterName(r)}`}
                      checked={selected.has(r.id)}
                      onChange={() => setSelected(toggleSelected(selected, r.id))}
                    />
                  </td>
                  <td className="py-1.5 pr-4 font-medium text-gray-900">{screencasterName(r)}</td>
                  <td className="py-1.5 pr-4 text-gray-600">{r.email}</td>
                  <td className="py-1.5 pr-4">{r.business_type === 'agency' ? 'agence' : 'annonceur'}</td>
                  <td className="py-1.5 pr-4">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{r.cpm_standard_tnd.toFixed(3)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{r.cpm_event_tnd.toFixed(3)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{r.draft_count}</td>
                  <td className="py-1.5 pr-4 text-xs text-gray-500">
                    {r.last_change === null
                      ? '—'
                      : `${formatAdminDateTime(r.last_change.changed_at)} · ${r.last_change.changed_by_name}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-400">Aucun screencaster trouvé.</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount it and relabel the default card** — in `DispatchConfigManagement.tsx`:
  - add `import { ScreencasterCpmSection } from '@/features/admin/components/screencaster-cpm/ScreencasterCpmSection';` (sorted import block);
  - in `DispatchConfigManagement`, wrap the body so the section renders first, independent of the config load:

```tsx
    <AdminLayout
      title="Tarification (CPM) et attention (T)"
      subtitle="CPM par screencaster, CPM par défaut, délai de lancement, indice d'attention et répartition des reversements"
    >
      <div className="space-y-6">
        <ScreencasterCpmSection />
        {loading ? (
          /* …the existing loading / ConfigForm / error branches, unchanged… */
        ) : null}
      </div>
    </AdminLayout>
```
  (Move the existing `{loading ? … : config ? … : isError ? … : null}` expression inside the new `<div className="space-y-6">` verbatim.)
  - in `ConfigForm`, change the card title `CPM éditable` → `CPM par défaut (nouveaux screencasters)` and add under the heading:

```tsx
        <p className="-mt-2 mb-4 text-sm text-gray-500">
          Le CPM de départ d’un nouveau screencaster. Le modifier ne change pas le CPM des
          screencasters existants.
        </p>
```

- [ ] **Step 4: Typecheck, lint, tests**

```bash
pnpm exec prettier --write apps/web/src/features/admin/components/screencaster-cpm apps/web/src/features/admin/pages/DispatchConfigManagement.tsx
pnpm --filter @toodooh/web typecheck 2>&1 | grep "error TS" | grep -v -E "GeographicZonesManagement|MyCampaigns|export.service|dooh-location-affluence-engine"   # expect no output
pnpm exec eslint apps/web/src/features/admin --no-error-on-unmatched-pattern
cd apps/web && pnpm exec vitest run
```
Expected: no new `error TS` lines; eslint exit 0; web tests all pass. Check `wc -l` of the two components and the page: each < 400.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/admin/components/screencaster-cpm apps/web/src/features/admin/pages/DispatchConfigManagement.tsx
git commit -m "feat(web): CPM-3 — « CPM par screencaster »: search, multi-select, change together"
```

---

### Task 8: Gates, local QA, halt

- [ ] **Step 1: All gates** (from the worktree root; report each command and result)

```bash
pnpm --filter @toodooh/api typecheck                     # 0
pnpm --filter @toodooh/web typecheck 2>&1 | grep -c "error TS"   # ≤ 14 (11 today), no new line vs memory/web-typecheck-baseline-d2215bf.txt
pnpm exec eslint . --no-error-on-unmatched-pattern --ignore-pattern '.claude/**'   # exit 0
(cd apps/api && pnpm exec vitest run)                   # all pass
(cd apps/web && pnpm exec vitest run)                   # all pass
pnpm build                                              # exit 0
```

- [ ] **Step 2: Local QA on the dev stack** — the operator's review servers run from the main checkout on :4000/:5173; stop them first **only with the operator's go**, or run this worktree's servers on other ports (`PORT=4100` for the api; `pnpm --filter @toodooh/web exec vite --port 5273` with the proxy target changed via `VITE_API_PROXY` if supported — otherwise ask). Then: `/admin-dispatch-config` → search « cafe », select two screencasters, set a standard CPM, confirm; check the toast counts, the table's new values and « dernière modification », one of their drafts' CPM in the wizard, and that an `upcoming` campaign's CPM did not move. Screenshots to `docs/qa/cpm3/`.

- [ ] **Step 3: Halt** — report the commits (local, unpushed), the gate commands and results, and any Task 2 test that was changed and why. Wait for the operator's ratify before pushing.

---

## Self-review

- **Spec coverage:** §2 rule → Task 3 tests (every status, carted draft, replay, plan CPM) + Task 1 trigger; event CPM same rules → both rates handled everywhere; global = default of new → Task 1 column default + Task 1 capture test (Step 6b); §3 data → Task 1; Q1 → Task 1 test « existing drafts keep their CPM »; §4 API → Tasks 4–5; §5 page → Task 7 (search, filtered select-all, bulk bar, confirmation text, relabel); §6 simulator → no code (generic upgrade; covered by Task 2 full run incl. `cpm1-sandbox-upgrade`); §7 testing → Tasks 1–6; audit trail → Task 1 table + Task 3 test.
- **Placeholders:** none; Task 2 is inherently data-driven (unknown failing set) and gives the exact fix recipe and the stop rule.
- **Type consistency:** `screencasterCpmRates → CpmRates | null`, `updateScreencasterCpm → { ok, updated, draftsRepriced } | { ok: false, error, ids }`, wire `drafts_repriced`, `ScreencasterCpmRow` identical api ↔ web.
