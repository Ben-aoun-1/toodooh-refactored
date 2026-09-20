# CPM per screencaster — design

**Date:** 2026-09-18 · **Lane:** CPM-3 · **Branch:** `feat/cpm-per-screencaster` (from `origin/main` 7f006d1)
**Status:** design and Q1 ruled by the operator 2026-09-18; spec approved.

## 1. Why

Today the CPM is **one global pair** in `dispatch_config` (`standard_cpm_tnd`, `event_cpm_tnd`),
edited on `/admin-dispatch-config`. Since CPM-1 (#226, migration 0074) every campaign copies both
rates at INSERT (`campaigns.standard_cpm_tnd` / `event_cpm_tnd`, column default
`current_*_cpm_tnd()`), and activation freezes the one in use into `campaign_dispatch_plan.cpm`.

The operator wants the CPM to be **negotiated per screencaster** (advertiser, including
agencies): an admin sees every screencaster with their CPM, selects one or many, and changes their
CPM together.

## 2. The rule (operator rulings, 2026-09-18)

When an admin changes a screencaster's CPM (standard, event, or both):

| Campaign of that screencaster | CPM after the change |
|---|---|
| `draft` — classic or event positioning, in the cart or not | **the new CPM** (repriced in the same transaction as the change) |
| `draft` that already has a frozen plan or event allocations (stranded after a cart confirm) | keeps its CPM (ruling A, 2026-09-19) |
| created after the change (wizard, event positioning, **replay of a completed campaign**) | **the new CPM** (captured at INSERT) |
| `pending` (confirmed from the cart, waiting for admin approval) | keeps its CPM |
| `rejected` | keeps its CPM |
| `upcoming`, `active` (paid and approved) | keeps its CPM |
| `completed` (played) | keeps its CPM — history stays truthful |
| a **boost** on an `upcoming`/`active` campaign | keeps the campaign's CPM |

- **The event CPM follows exactly the same rules** (ruling 2).
- **The global CPM** in `dispatch_config` becomes « CPM par défaut des nouveaux screencasters »: a
  new account starts at it; changing it never touches an existing screencaster (ruling 3).
- **Supersedes CPM-1's « a draft edited later keeps its creation CPM »** (ruling 5, intended). A
  draft is now priced at its screencaster's current CPM until it leaves `draft`.

Why the protected statuses need no code: `pending`/`rejected`/`upcoming`/`active`/`completed` rows
are simply never repriced — they keep the copy they carry. Activated campaigns additionally price
from the frozen `plan.cpm` (boost `lib/boost.ts:264`, settlement `reconcile-service.ts:67`); the
event refusal cascade and event boost read the campaign's own `event_cpm_tnd`, which a
non-draft never loses.

## 3. Data (migration 0076)

1. **`users.cpm_standard_tnd`, `users.cpm_event_tnd`** — `numeric(10,3) NOT NULL`, column DEFAULT
   `current_standard_cpm_tnd()` / `current_event_cpm_tnd()` (the 0074 functions: the global row,
   else 15). Every account is created with the default in force; existing rows are backfilled with
   today's global value. The columns exist on every role; only advertisers' are read.
   *Why on `users`:* the price is a property of the account, like the payout bank fields (REV1:
   payout per owner) — no join, no missing-row case.
2. **`screencaster_cpm_changes`** — append-only, one row per screencaster per change:
   `id`, `user_id → users` (RESTRICT), `changed_by → users` (RESTRICT), `changed_at`,
   `old_standard_cpm_tnd`, `new_standard_cpm_tnd`, `old_event_cpm_tnd`, `new_event_cpm_tnd`
   (numeric(10,3), all NOT NULL — an unchanged rate is written with old = new),
   `drafts_repriced integer`. Same pattern as `user_bank_details_audit`.
3. **Capture at INSERT — approach A (ruling 6): a `BEFORE INSERT` trigger on `campaigns`.**
   0074's column defaults are dropped; the trigger sets
   `NEW.standard_cpm_tnd := COALESCE(NEW.standard_cpm_tnd, u.cpm_standard_tnd, current_standard_cpm_tnd())`
   (same for event) from the row's `advertiser_id`. An explicit value still wins (the CPM-1
   restore script and tests that pin a rate keep working). NOT NULL is checked after BEFORE
   triggers, so a campaign can never be created without a CPM. The Drizzle columns keep an
   insert-optional default marker (`.notNull().default(sql\`NULL\`)`, commented: « the trigger fills
   it ») so no insert site changes type; Drizzle sends `DEFAULT`, the database has none, the trigger
   sees NULL and fills it. Every creation path — `POST
   /api/campaigns`, `POST /api/events/:id/positionner`, `POST /api/campaigns/:id/replay`, the
   simulator's world writer, the test fixtures — is covered without touching it, the property
   CPM-1 chose a function default for.
   The trigger's `SELECT … FROM users u WHERE u.id = NEW.advertiser_id` takes `FOR KEY SHARE`
   (ruling A follow-up, 2026-09-19): the bulk PATCH locks the same row `FOR UPDATE` for its whole
   transaction, so this makes a racing INSERT wait for it to commit and read the CPM it just
   wrote, instead of slipping through with the pre-change rate.
4. **Existing drafts are NOT repriced by the migration** (Q1, ruled).

## 4. API

| Endpoint | Guard | Behaviour |
|---|---|---|
| `GET /api/admin/screencasters/cpm` | admin | Every `advertiser` account: `id`, company / contact name, email, `business_type` (agence / annonceur), `status`, `cpm_standard_tnd`, `cpm_event_tnd`, `draft_count`, last change (`changed_at`, by whom). Sorted by name. The search is client-side (the list is small). |
| `PATCH /api/admin/screencasters/cpm` | admin | Body `{ user_ids: uuid[] (1–500, all advertisers), standard_cpm_tnd?: number > 0, event_cpm_tnd?: number > 0 }`, at least one rate. **One transaction:** lock the users rows `FOR UPDATE` (ordered by id) → write each audit row → update the users → `UPDATE campaigns SET standard_cpm_tnd/event_cpm_tnd … WHERE advertiser_id = ANY(ids) AND status = 'draft' AND NOT EXISTS(plan) AND NOT EXISTS(event_allocations)` (ruling A) → reply `{ updated, drafts_repriced }`. A non-advertiser or unknown id → 400, nothing written. |
| `GET /api/campaigns/pricing-config` | auth | For an advertiser: **their own** `standard_cpm_tnd` / `event_cpm_tnd` (the wizard's estimate before the draft exists). Other roles: the global default. |
| `GET /api/events/:id/cmax` | advertiser | Priced at the caller's `cpm_event_tnd` (was the global event CPM). |
| `GET/PATCH /api/admin/dispatch-config` | admin | Unchanged wire; the two CPMs now mean « défaut des nouveaux screencasters ». |

Unchanged, because they already read the campaign's own copy or the frozen plan: `GET
/api/campaigns/:id[/cmax]`, `/mine`, `POST /submit`, the cart, `GET /api/admin/campaigns`,
activation, boosts, settlement, the event refusal cascade. `GET /api/admin/events/:id/tarification`
keeps showing the global default event CPM.

## 5. Admin page (`/admin-dispatch-config`)

- New first section **« CPM par screencaster »** in its own components under
  `features/admin/components/screencaster-cpm/` (the page is already 309 lines):
  - a search bar (company, contact name, email — accent- and case-insensitive);
  - a table: checkbox · screencaster · email · type · statut · CPM standard (TND / 1000) · CPM
    événement (TND / 1000) · brouillons · dernière modification;
  - « tout sélectionner » selects the **filtered** rows only;
  - with ≥ 1 row selected, a bar: two optional inputs (new standard / new event CPM) and
    « Appliquer à N screencasters »;
  - a confirmation dialog naming the count and stating the rule: « Les brouillons de ces
    screencasters (N) passent au nouveau CPM ; les campagnes en attente, refusées, programmées,
    actives et terminées gardent leur prix. »; after success a toast with `drafts_repriced`.
- The existing « CPM éditable » card is relabelled « CPM par défaut (nouveaux screencasters) ».
- Pure logic (search normalisation, selection of the filtered set, patch body) lives in a tested
  `features/admin/lib/screencaster-cpm.ts` (apps/web has no render harness).

## 6. Simulator

Sandboxes migrate through the generic `simulator/upgrade.ts` (applies pending journal entries), so
0076 reaches existing sandboxes at boot / on open with no new code. The world writer inserts
advertisers and campaigns through the same tables, so the trigger prices sandbox campaigns at the
sandbox screencaster's CPM.

## 7. Testing

- **api integration** (real Postgres):
  - a new campaign copies its screencaster's CPMs (both types; an explicit value still wins);
  - PATCH reprices `draft` rows only — `pending`, `rejected`, `upcoming`, `active`, `completed`
    keep theirs; a carted draft is repriced; an event positioning draft gets the new event CPM;
  - one audit row per screencaster with old / new and `drafts_repriced`;
  - replay of a completed campaign after a change captures the new CPM;
  - a boost after a change still prices at the plan's CPM;
  - `pricing-config` and `/events/:id/cmax` answer the caller's own CPM;
  - validation: empty body, CPM ≤ 0, a non-advertiser id, a non-admin caller;
  - migration: backfill = global value; the trigger replaces the 0074 default.
- **web** pure tests for the search / selection / body helpers.
- Gates as CLAUDE.md rule 7, per-package typecheck commands named.

## 8. Out of scope

Per-screencaster T tiers (T stays global, CPM-2 snapshot at creation); a screencaster-facing view
of their CPM beyond the wizard estimate; CPM history charts; per-venue CPM.

## 9. Ruled question

**Q1 — drafts at deploy. RULED 2026-09-18: recommended — the migration leaves drafts as they are.** The migration gives every screencaster today's global CPM (prod: 10 /
15 on 2026-09-17 — re-read at deploy), but the drafts restored by CPM-1 on 2026-09-17 still carry
**15** standard. Recommended: **leave drafts as they are at deploy**; the « drafts follow the
screencaster » rule applies from each screencaster's first change on the new page. The
alternative — reprice every draft to its screencaster's backfilled CPM in the migration — would
undo yesterday's restore (ruling 1A) for those drafts.
