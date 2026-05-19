# Supabase schema inventory — Phase 1 backend reference

**Source:** Legacy SQL artifacts under `docs/handoff/legacy-migrations/` (extracted in
Step P0a from `github.com/toodooh-source/toodooh` at `df0ef04`)
**Date generated:** May 2026 (cleanup phase exit); expanded P0b Session 1
**Purpose:** Reference document for Phase 1's self-hosted Node + Postgres backend to replicate

This document is a working inventory of what the migration history reveals about the existing Supabase project. It is the foundation for Phase 1's schema migration to Drizzle (per `docs/handoff/00-PROJECT_HANDOFF.md`).

**Status: PARTIAL** — `business_profiles`, the admin-tables cluster, storage buckets, and known RPCs are inventoried; campaign/geo/financial tables remain. Marked as `[GAP]` where additional migration files need to be read. See §8 for the gap list.

> **Important architectural note from handoff doc:** Phase 1's schema migration carries one mandatory simplification — collapse the dual identity model (`admin_profiles` as sibling of `auth.users`) into one `users` table with a role enum (`advertiser | owner | admin | superadmin`). The current schema's dual-identity model is the root cause of frontend auth complexity and most RLS rewrites. **Do not preserve this in Phase 1.** This inventory documents what exists; Phase 1 redesigns rather than ports.

---

## 1. Migration file timeline

### ⚠️ Migration chronology is unreliable

The previous developer used filename timestamps that **do not reflect actual execution order**. Multiple January 2025-dated files declare types/columns that are created in March 2025-dated files; `CREATE FUNCTION` resolves parameter types at creation time, so these files cannot have executed in filename order. Some files would error if run linearly (duplicate `ADD COLUMN` without `IF NOT EXISTS` guards — see §7 Defect 1).

This document reconstructs execution order from **dependency analysis**: which migration declares the types/columns each subsequent migration references. Where filename order conflicts with dependency order, dependency order wins.

**Worked example:** `20250101000003_create_business_profile_function.sql` references the `business_type`, `profile_type`, and `verification_status` enums plus the `is_admin` column. These are created in `20250313112646_wispy_leaf.sql`, `20250318000627_withered_sun.sql`, and `20250315114307_mute_snowflake.sql` respectively — all filename-dated *two and a half months later*. The January-dated file is reconstructed-ordered **after** all three March files.

### Reconstructed dependency order — `business_profiles` spine

| # | File | Effect |
|---|---|---|
| 1 | `20250313112340_empty_hall` | campaigns/clients + enums (not `business_profiles`, but earliest; admin policies later reference `campaigns`) |
| 2 | `20250313112646_wispy_leaf` | **CREATE** `business_profiles`, `business_sectors`, `governorates`; enums `business_type`, `verification_status`; 3 RLS policies; `update_updated_at_column()` + trigger |
| 3 | `20250315114307_mute_snowflake` | `ADD COLUMN is_admin`; admin seed user; 2 admin RLS on `business_profiles` + 2 on `campaigns` |
| 4 | `20250318000627_withered_sun` | `CREATE TYPE profile_type`; `ADD COLUMN profile_type`, `onboarding_completed` |
| 5 | `20250318000628_add_onboarding_completed` | `ADD COLUMN onboarding_completed` **again** (Defect 1) |
| 6 | `20250318000629_fix_rls_policies` | drop+recreate INSERT policy |
| 7 | `20250318000630_fix_rls_recursion` | drop+recreate SELECT/INSERT/UPDATE + anon-INSERT policy |
| 8 | `20250320000010 … 000016` (6 files) | column adds (`logo_url`, `number_of_rooms`, `fonction`, `company_size`, `notify_*`×3, `is_active`, `registration_doc_path`) |
| 9 | `20250101000000 … 000004` | RPC functions + RLS-fix files — **reconstructed here** (depend on enums/columns from steps 2–4) |
| 10 | `20260403123500_allow_authenticated_read_business_profiles` | adds permissive `SELECT USING(true)` policy |
| 11 | Undated root-scripts + backup-only `20250120000000` | column adds (`agent_toodooh`, `number_of_screens`, `cin`, `cin_doc_url`, `email`, `formule`, `zone`, `status` + validation fields); extra constraints; admin RLS via `admin_profiles` |

Steps 9 and 11 cannot be ordered *internally* — they are all late, undated patches and are treated as an unordered group.

---

## 2. Core tables

### 2.1 `auth.users` (Supabase managed, extended)

Standard Supabase `auth.users` table, extended by `20250101000005_add_user_profile_fields.sql` (reconstructed-late):

| Column | Type | Notes |
|---|---|---|
| `raison_social` | `text` | Business display name. **Column name is `raison_social`** (no trailing *e*) — a prior version of this inventory mis-spelled it `raison_sociale`. |
| `profile_type` | `text` | `CHECK (profile_type IN ('advertiser', 'individual_owner', 'fleet_owner'))` |

Index: `idx_users_profile_type` on `profile_type`.

The migration also back-fills both columns from `business_profiles` and defaults the rest. The admin seed in `mute_snowflake` inserts directly into `auth.users` (raw `INSERT` with `crypt()`-hashed password) — see §2.4.

**Phase 1 implication:** this dual-storage (`auth.users` + `business_profiles`) is part of the dual-identity model to collapse. New `users` table holds all identity fields in one place.

### 2.2 `business_profiles`

Created by `20250313112646_wispy_leaf.sql`. The cumulative schema below merges 12+ migrations and root-scripts; origin is in the right-hand column. **41 columns total.**

| Column | Type | Default / constraint | Origin |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | wispy_leaf |
| `user_id` | `uuid` | FK `auth.users(id)` ON DELETE CASCADE | wispy_leaf |
| `business_name` | `text` | NOT NULL | wispy_leaf |
| `tax_number` | `text` | NOT NULL, UNIQUE (inline) | wispy_leaf |
| `business_sector_id` | `uuid` | FK `business_sectors(id)` | wispy_leaf |
| `business_type` | `business_type` enum | NOT NULL | wispy_leaf |
| `contact_name` | `text` | NOT NULL | wispy_leaf |
| `contact_phone` | `text` | NOT NULL, CHECK `valid_phone` (`^\+[1-9]\d{1,14}$`) | wispy_leaf |
| `street_address` | `text` | NOT NULL | wispy_leaf |
| `city` | `text` | NOT NULL | wispy_leaf |
| `postal_code` | `text` | NOT NULL, CHECK `valid_postal_code` (`^\d{4}$`) | wispy_leaf |
| `governorate_id` | `uuid` | FK `governorates(id)` | wispy_leaf |
| `registration_doc_url` | `text` | — | wispy_leaf |
| `verification_status` | `verification_status` enum | DEFAULT `'pending'` | wispy_leaf |
| `terms_accepted` | `boolean` | NOT NULL DEFAULT false, CHECK `terms_must_be_accepted` (= true) | wispy_leaf |
| `terms_accepted_at` | `timestamptz` | — | wispy_leaf |
| `created_at` | `timestamptz` | DEFAULT `now()` | wispy_leaf |
| `updated_at` | `timestamptz` | DEFAULT `now()` | wispy_leaf |
| `is_admin` | `boolean` | NOT NULL DEFAULT false | `mute_snowflake:16` |
| `profile_type` | `profile_type` enum | NOT NULL DEFAULT `'advertiser'` | `withered_sun:23` |
| `onboarding_completed` | `boolean` | NOT NULL DEFAULT false | withered_sun (also re-added by `…000628`) |
| `logo_url` | `text` | — | `…000010_business_profiles_logo_and_rooms` |
| `number_of_rooms` | `integer` | — | `…000010_business_profiles_logo_and_rooms` |
| `fonction` | `text` | — | `…000011_business_profiles_fonction` |
| `company_size` | `text` | — | `…000012_business_profiles_company_size` |
| `notify_news_updates` | `boolean` | DEFAULT false | `…000013_business_profiles_notification_prefs` |
| `notify_reminders_events` | `boolean` | DEFAULT true | `…000013_business_profiles_notification_prefs` |
| `notify_promotions_offers` | `boolean` | DEFAULT false | `…000013_business_profiles_notification_prefs` |
| `is_active` | `boolean` | NOT NULL DEFAULT true | `…000014_business_profiles_is_active` |
| `registration_doc_path` | `text` | — | `…000016_business_profiles_registration_doc_path:5` |
| `agent_toodooh` | `text` | — | backup-only `20250120000000_add_owner_fields:6` |
| `number_of_screens` | `integer` | CHECK `check_positive_screens` (NULL or > 0) | backup-only `20250120000000_add_owner_fields` |
| `cin` | `text` | — | root `add_cin_column_to_business_profiles` |
| `cin_doc_url` | `text` | — | root `add_cin_doc_url_column` |
| `email` | `text` **or** `varchar(255)` | — | root `add_email_to_business_profiles` / `_final` — see §7 Defect 5 |
| `formule` | `text` | — | root `add_formule_column` |
| `zone` | `text` | — | root `add_zone_column_to_business_profiles` |
| `status` | `varchar(20)` | DEFAULT `'pending'`, CHECK `(pending\|approved\|rejected)` | root `add_validation_to_business_profiles` |
| `validation_notes` | `text` | — | root `add_validation_to_business_profiles` |
| `validated_by` | `uuid` | FK `admin_profiles(id)` | root `add_validation_to_business_profiles:15` |
| `validated_at` | `timestamptz` | — | root `add_validation_to_business_profiles` |

**Constraints beyond inline:** `business_profiles_tax_number_unique` UNIQUE(`tax_number`) and a phone-unique constraint — both from root `add_unique_constraints_signup`. The `tax_number` one is **redundant** (the column is already UNIQUE inline) — see §7 Defect 6.

**Indexes:** `idx_business_profiles_email` (root `add_email_to_business_profiles`), `idx_business_profiles_status` and `idx_business_profiles_validated_by` (root `add_validation_to_business_profiles`).

**Triggers:** `update_business_profiles_updated_at` → `update_updated_at_column()` (wispy_leaf); `trg_fill_business_profile_email` → `fill_business_profile_email()` SECURITY DEFINER, back-fills `email` from `auth.users` on INSERT/UPDATE (root `add_email_to_business_profiles_final`).

**⚠️ Phase 1 choice point — twin validation-state columns.** `business_profiles` carries **two parallel validation columns**: `verification_status` (enum `pending | verified | rejected`, from wispy_leaf) and `status` (varchar `pending | approved | rejected`, from root `add_validation_to_business_profiles`). They have different value vocabularies (`verified` vs `approved`) and `status` arrives with audit fields (`validated_by`, `validated_at`, `validation_notes`) that `verification_status` lacks. This is a partial-migration mid-state — the developer began moving to `status` but never retired `verification_status`. **Phase 1's new schema must pick one.** This document only describes the duplication; the decision belongs to the Phase 1 architecture conversation.

### 2.3 `business_profiles` — RLS policy history

The RLS on `business_profiles` was rewritten repeatedly. The effective end-state is **not deterministic from the artifacts alone** — the late `20250101*` files `DROP POLICY IF EXISTS` against both French- and English-named policy generations, and `20250101000002` even does `DISABLE` / `ENABLE ROW LEVEL SECURITY`. Rather than manufacture a false "final set," this section documents the **three generations of policy intent**.

**Generation 1 — own-row** (`wispy_leaf`; restored by `…000629` / `…000630`):
Each user sees / creates / updates only their own profile (`auth.uid() = user_id`). `…000630_fix_rls_recursion` re-establishes this after the intervening churn and adds an `anon`-role INSERT policy (`Création de profil lors de l'inscription`, `WITH CHECK (true)`) so signup can write before the session is fully authenticated.

**Generation 2 — permissive-all** (`20250101000001`, `20250101000002`, `20260403123500`):
SELECT opened to every authenticated user (`USING (true)` — policy names `Allow authenticated users to view business profiles` / `… view all business profiles` / `Authenticated can read basic business profiles`). Motivated by needing to display advertiser logos/names in owner-facing views. `20250101000002` disables then re-enables RLS around the rewrite.

**Generation 3 — admin-overlay** (`mute_snowflake`, `20250101000004`, root `create_admin_permissions`):
Admin policies layered on top so admins see/update all profiles. `mute_snowflake` and `20250101000004` express the admin check by sub-querying `business_profiles` itself (`auth.uid() IN (SELECT user_id FROM business_profiles WHERE is_admin = true)`); root `create_admin_permissions` expresses it via `admin_profiles` membership. The self-referential form is the **RLS infinite-recursion defect** (§7 Defect 3).

**Phase 1 implication:** all of this collapses. Authorization moves to Fastify route-level middleware predicates (per handoff §4 — "Authorization is middleware, not row-level policies"). The RLS history matters as a record of *what access each generation was trying to grant*, which the middleware must replicate intentionally.

### 2.4 Admin-tables cluster — `admin_profiles`, `admin_activities`, `admin_permissions`, `admin_roles`

**Structural finding:** the admin-tables cluster exists **only in root-scripts — never formally migrated.** No file in `legacy-migrations/migrations/` creates any of these tables; the only formal migration that names `admin_profiles` (`20260404210000_global_configuration_rls_admin_profiles`) merely references it in an RLS predicate. The dual-identity model's home is entirely ad-hoc SQL, which is *why* it is fragile: divergent `CREATE TABLE IF NOT EXISTS` scripts produce a non-deterministic live schema.

**`admin_profiles` — two divergent definitions** (both `CREATE TABLE IF NOT EXISTS`, so whichever ran first wins — §7 Defect 4):

- *Minimal* (`SOLUTION_FINALE_ADMIN_UPLOAD.sql`): `id uuid PK`, `user_id uuid UNIQUE FK auth.users(id) ON DELETE CASCADE`, `created_at`, `updated_at`.
- *Rich* (`admin_database_queries.sql`): `id uuid PK`, `user_id uuid FK auth.users(id) ON DELETE CASCADE`, `email varchar(255) NOT NULL UNIQUE`, `first_name varchar(100) NOT NULL`, `last_name varchar(100) NOT NULL`, `role varchar(20) NOT NULL CHECK (role IN ('superadmin','admin','moderator'))`, `permissions text[] DEFAULT '{}'`, `is_active boolean DEFAULT true`, `last_login timestamptz`, `created_at`, `updated_at`, `created_by uuid FK admin_profiles(id)`. Indexes: `idx_admin_profiles_user_id|email|role|active`. Trigger `update_admin_profiles_updated_at`.

The rich definition matches the columns the frontend's TypeScript types expect, so it is the **likely** live shape — but the artifacts cannot prove it.

**`admin_activities`** (`admin_database_queries.sql`): `id uuid PK`, `admin_id uuid FK admin_profiles(id) ON DELETE CASCADE`, `admin_name varchar(200) NOT NULL`, `action varchar(100) NOT NULL`, `resource varchar(100) NOT NULL`, `resource_id uuid`, `details jsonb`, `ip_address inet`, `user_agent text`, `created_at`. Indexes: `idx_admin_activities_admin_id|created_at|resource`.

**`admin_permissions` / `admin_roles`** — `[GAP]` creation migration unknown. `admin_database_queries.sql` only `ALTER`s them (`ADD COLUMN IF NOT EXISTS`) and seeds them, so they pre-exist some untracked source. Observed columns:
- `admin_permissions`: `name` (UNIQUE — used by `ON CONFLICT`), `description`, `resource varchar(50)`, `action varchar(50)`, `created_at`, `updated_at`. Seed: 15 rows (`users.read`, `users.write`, `screens.*`, `campaigns.*`, `verifications.*`, `reports.read`, `admins.*`).
- `admin_roles`: `name` (UNIQUE), `description`, `permissions text[]`, `is_system_role boolean`, `created_at`, `updated_at`. Seed: 3 rows — `superadmin` (`{*}`, system), `admin`, `moderator`.

**Dual-identity bridge — `is_admin_user(uuid)`** (`SOLUTION_FINALE_ADMIN_UPLOAD.sql`): a SECURITY DEFINER function returning true if the user is in `admin_profiles` **OR** has `business_profiles.is_admin = true`. It exists precisely to keep both identity systems alive at once.

**Dual-identity narrative:** admin identity evolved in three steps — (1) an `is_admin boolean` flag on `business_profiles` (`mute_snowflake`); (2) an `admin_profiles` sibling table added later via ad-hoc scripts (in two divergent shapes), with `admin_activities` / `admin_permissions` / `admin_roles` alongside; (3) the `is_admin_user()` bridge function so code can treat either system as authoritative. FKs such as `business_profiles.validated_by` point at `admin_profiles(id)`. This is exactly the model handoff §4 mandates collapsing into one `users` table with a `role` enum.

### 2.5 Reference tables

`business_sectors`, `governorates` created in `wispy_leaf` (`id uuid PK`, `name text NOT NULL UNIQUE`; RLS = authenticated SELECT `true`). Seeds: 10 sectors, 24 governorates (Tunisian). `owner_business_sectors`, `company_size_options` — `[GAP]`, deferred to a later P0b session.

---

## 3. Campaign & advertising tables

> Not yet inventoried in depth — P0b Session 2 scope. Summary below is from the cleanup-phase pass.

### `campaigns`

Created `20250313112340_empty_hall`. Columns: `id`, `name`, `client_id`, `category` enum (`commercial | cultural | promotional | institutional`), `start_date`, `end_date`, `status` enum (`draft | pending | active | paused | completed | rejected`), `budget` numeric(10,2), `views`, `user_id`, `created_at`. Constraints: `valid_dates`, `valid_budget`. Indexes: `user_id`, `client_id`, `status`. Subsequent additions `[GAP]`.

### `campaign_media`, `campaign_locations`, `campaign_screens`, `campaign_hourly_location_plan`

Junction / per-relationship tables. `campaign_media` and `campaign_locations` created in `empty_hall` (`campaign_locations` originally lat/lng/radius; replaced later by a `location_id` reference). `campaign_screens` and `campaign_hourly_location_plan` full schemas `[GAP]`.

### `clients`

Advertiser's own clients table. Created `20250313112340_empty_hall`. `valid_email` CHECK constraint.

### `locations`, `screens`, `location_affluence_schedule`

Geographic data model. `locations` uses PostGIS POINT. `screens` linked via `location_id`. `location_affluence_schedule` stores per-location-per-hour-per-day impression estimates (DOOH calculation input). Full schemas `[GAP]`.

---

## 4. Financial tables

> Not yet inventoried in depth — P0b Session 3 scope.

### `recharges`

Wallet recharge requests. From root `create_recharges_table`. Fields (partial): `id`, `user_id`, `amount`, `payment_method` (`card | bank | cash`), `status` (`pending | completed | rejected`), `description`, `created_at`. Full schema `[GAP]`.

### Balance / invoicing / monitoring subsystems

Defined in root-scripts `create_balance_system`, `create_automatic_invoicing_system`, `create_campaign_monitoring_system`, `create_monthly_invoices_view`, `create_platform_stats_functions` — none in formal migrations. Full schemas `[GAP]` — P0b Session 3.

---

## 5. Storage buckets

Three buckets identified:

- `media` (PRIVATE) — campaign videos, 100 MB max, signed URL access (1 yr)
- `registres` (PRIVATE) — RNE/CIN documents, signed URL access (7 d). Created/ensured by `SOLUTION_FINALE_ADMIN_UPLOAD.sql` (`INSERT INTO storage.buckets … ON CONFLICT DO NOTHING`) with RLS via `is_admin_user()` + `^cin_<uid>` / `^rne_<uid>` path matching.
- `event-images` (PUBLIC) — event marketing images, public read

`zone-images` storage bucket also appears in `20250330000002` — `[GAP]`, later session.

---

## 6. Functions (RPCs) and triggers

Known RPCs / functions:

- `get_business_profile_by_email(text)` — SECURITY DEFINER; returns a `business_profiles` row joined on email. **Signature is stale** — see §7 Defect 2.
- `create_business_profile(...)` — SECURITY DEFINER; validates input and inserts a `business_profiles` row. Accepts `p_is_admin boolean DEFAULT false` (the privilege-escalation hole noted in handoff §8).
- `create_default_business_profile(uuid, text)` — SECURITY DEFINER; inserts a placeholder profile derived from the email.
- `is_admin_user(uuid)` — SECURITY DEFINER; dual-identity bridge (§2.4).
- `fill_business_profile_email()` — SECURITY DEFINER trigger function; back-fills `business_profiles.email` from `auth.users`.
- `update_updated_at_column()` — generic `updated_at` trigger function (defined in `wispy_leaf`, re-defined in `admin_database_queries`).
- `update_expired_campaigns`, `upsert_location_affluence_schedule` — `[GAP]`, later sessions.

Triggers: `update_business_profiles_updated_at`, `trg_fill_business_profile_email`, `update_admin_profiles_updated_at`, `update_admin_roles_updated_at`, `update_admin_permissions_updated_at`.

`[GAP]` — full RPC inventory (campaign/geo/financial functions) requires P0b Sessions 2–3.

---

## 7. Legacy-migration defects

Defects in the *legacy* migration set, surfaced during P0b Session 1. They are not gaps in the inventory — they are flaws in the source artifacts. Recorded here so Phase 1 (which rebuilds the schema in Drizzle from scratch) does not reproduce them.

### Defect 1 — Duplicate `onboarding_completed` `ADD COLUMN`

*What:* `business_profiles.onboarding_completed` is added by two separate migrations. *Where:* `20250318000627_withered_sun.sql` and `20250318000628_add_onboarding_completed.sql` — both run `ALTER TABLE business_profiles ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false` with **no `IF NOT EXISTS` guard**. *Why it matters:* run in filename order, the second errors (`column already exists`) — direct proof the migration set was never executed as a clean linear sequence. *Phase 1:* the Drizzle schema declares the column once; the defect cannot recur.

### Defect 2 — Stale RPC signature (`get_business_profile_by_email`)

*What:* the RPC's `RETURNS TABLE` signature disagrees with the real column types. *Where:* `20250101000000_create_get_business_profile_function.sql` declares `business_sector_id INTEGER` and `governorate_id INTEGER`; `wispy_leaf` defines both columns as `uuid`. *Why it matters:* the function would fail at runtime (type mismatch on the returned set) — it is dead/broken as written. *Phase 1:* the RPC becomes a typed Fastify endpoint; the signature is derived from the Drizzle schema, so it cannot drift.

### Defect 3 — RLS infinite-recursion design

*What:* RLS policies that sub-query the very table they protect. *Where:* `20250315114307_mute_snowflake.sql` and `20250101000004_fix_business_profiles_rls.sql` — admin policies *on* `business_profiles` whose `USING` clause runs `SELECT … FROM business_profiles WHERE is_admin = true`; and `create_admin_permissions.sql` — a SELECT policy *on* `admin_profiles` sub-querying `admin_profiles`. *Why it matters:* Postgres re-evaluates the policy while evaluating its own sub-query → infinite recursion; this is the root cause of the ~18 `fix_*rls*` scripts in `root-scripts/`. *Phase 1:* authorization moves to Fastify middleware (handoff §4); no row-level policies, so no self-reference is possible.

### Defect 4 — Two divergent `admin_profiles` definitions

*What:* `admin_profiles` has two incompatible `CREATE TABLE IF NOT EXISTS` definitions and no formal migration. *Where:* `SOLUTION_FINALE_ADMIN_UPLOAD.sql` (minimal: 4 columns) vs `admin_database_queries.sql` (rich: 12 columns). *Why it matters:* whichever script ran first wins; the other no-ops silently — the **live schema is non-deterministic from the artifacts**. *Phase 1:* the admin concept is collapsed into the unified `users` table with a `role` enum — neither definition is ported.

### Defect 5 — `email` column added twice with different types

*What:* `business_profiles.email` is added by two scripts with conflicting types. *Where:* `add_email_to_business_profiles.sql` adds `email VARCHAR(255)`; `add_email_to_business_profiles_final.sql` adds `email text` — both `IF NOT EXISTS`. *Why it matters:* the live type depends on run order; downstream length assumptions are unsafe. *Phase 1:* the column is declared once as `text`.

### Defect 6 — Redundant `tax_number` unique constraint

*What:* a second UNIQUE constraint is added to an already-unique column. *Where:* `wispy_leaf` declares `tax_number text NOT NULL UNIQUE` inline; `add_unique_constraints_signup.sql` adds `business_profiles_tax_number_unique UNIQUE (tax_number)`. *Why it matters:* two unique indexes on one column — wasted writes/storage, and confusing for anyone reading `pg_constraint`. *Phase 1:* one uniqueness declaration.

---

## 8. Gaps requiring additional inventory work

Closed by P0b Session 1: `business_profiles` (full), `admin_profiles` / `admin_activities` (full), `auth.users` extension, `business_sectors` / `governorates`.

Remaining gaps:

- `admin_permissions`, `admin_roles` — **creation migration unknown** (only `ALTER`/seed scripts found; see §2.4)
- `recharges` (full schema and lifecycle), balance / invoicing / monitoring subsystems
- `campaigns` later additions; `campaign_screens`, `campaign_hourly_location_plan` (full columns)
- `clients`, `campaign_media`, `campaign_locations` (cumulative schema)
- `locations`, `screens`, `location_affluence_schedule` (full schemas)
- `special_events`, `event_campaign_links`
- `notifications`, `unavailability_periods`, `global_configuration`
- `monthly_statements` / `versements`, `invoices` / `factures`, `bank_details` / `payment_methods`
- `owner_business_sectors`, `company_size_options`, `predefined_zones` (+ seeds)
- `zone-images` / `event-images` bucket policies; DOOH-specific config tables
- Full RPC function bodies for campaign/geo/financial functions

Additional work: complete per-table RLS inventory for the remaining tables, seed data extraction, auth provider config, realtime subscription patterns.

**Estimated work to close gaps:** P0b Sessions 2–3 (campaign + geo + reference tables, then financial + RPCs + remaining).

---

## 9. Phase 1 architecture implications

### The dual-identity collapse

Current: `auth.users` + `business_profiles` + `admin_profiles` for what should be one conceptual entity. Phase 1 target: a single `users` table with a `role` enum. Eliminates ~30–40% of RLS complexity and removes the entire admin-tables-only-in-root-scripts fragility (§2.4).

### Schema ports vs. rewrites

- **Port 1:1:** reference tables, campaigns / campaign_media / campaign_locations / locations, location_affluence_schedule, screens, recharges, storage buckets (→ MinIO).
- **Rewrite:** `auth.users` + `business_profiles` + `admin_profiles` → single `users` table. All RLS policies → Fastify route-level authorization (stateful sessions, not RLS).
- **Functions:** trigger functions port; business-logic RPCs become Fastify endpoints.
- **Pick one validation column** — resolve the `verification_status` / `status` duplication (§2.2).

### PostGIS dependency

`locations.coordinates` uses POINT. Phase 1 Postgres needs `CREATE EXTENSION postgis;`. Drizzle has limited PostGIS support; may need raw SQL for spatial queries.

### Storage migration

Supabase Storage → MinIO. Three buckets to recreate. File path conventions preserved (`^cin_<uid>` / `^rne_<uid>`, `registration_doc_path`) to avoid breaking references.

---

## 10. Cleanup-phase findings relevant to Phase 1

- **TBD-R (#37)** — simulated revenue data. Phase 1 backend must serve real data. CEO/CTO decision pending.
- **TBD-K (#32)** — storage service abstraction. 9+ files call `supabase.storage` directly. Phase 1 introduces an abstraction so the provider can swap.
- **TBD-O (#34)** — OwnerScreens missing-persistence cluster. Phase 1 needs an optimistic-update + reconciliation story.
- **CF-18 source/target axis** — the codebase carries partial-migration artifacts. Phase 1 inventory should assume similar artifacts elsewhere. See §12 for the full instance list.

---

## 11. Leviosa / Toodooh naming reconciliation

The project was renamed **Leviosa → Toodooh** at some point; the rename was applied incompletely. The legacy SQL artifacts carry the old `Leviosa` name in exactly **two live places**:

| Location | Value |
|---|---|
| `legacy-migrations/migrations/20250315114307_mute_snowflake.sql:25, :50` | `admin@leviosa.tn` (seed admin email) |
| `legacy-migrations/migrations/20250315114307_mute_snowflake.sql:83` | `'Leviosa Administration'` (seed `business_name`) |
| `supabase/config.toml:5` (source repo) | `project_id = "Leviosa"` |

The **backup-tree copy** of the same migration (`legacy-migrations/backup-tree/20250315114307_mute_snowflake.sql:25, :50, :83`) is the already-corrected version — `admin@toodooh.tn` / `Toodooh Administration`. No other occurrence of `Leviosa` exists anywhere in the SQL.

**Phase 1:** standardize on **Toodooh**. The backup-tree `mute_snowflake` is the reference for the corrected seed values; the new backend has no `config.toml` `project_id` to carry forward.

---

## 12. Methodology notes from P0a + P0b Session 1

Deferred-corrections carried forward from Step P0a (folded in here per the P0b plan):

1. **Canonical source isn't complete source.** The formal `migrations/` folder is not the complete schema record — money-adjacent schema (balance, invoicing, recharges) and the entire admin-tables cluster live in ad-hoc root-scripts. Inventory must grep across *all* artifact sets.
2. **Non-destructive read for external git state.** Read other repos with `git ls-tree -r` / `git show <commit>:<path>`, never `git checkout` — preserves the working state of repos serving other purposes.
3. **Bootstrap-reads enforcement works in fresh sessions.** The "confirm reads complete before starting" discipline produced correct halt behaviour in a context-free session.
4. **CF-18 instance — Leviosa→Toodooh rebrand** (DB-project-naming layer): a partial rename, old and new names coexisting at different layers (§11).
5. **Estimate-vs-reality breach** — the root-script triage estimate (~30–60 in-scope) came in at 73; an upward discovery (RLS-fix-script accumulation), surfaced with reasoning rather than tightening criteria to fit.
6. **Operational note — Node version.** This machine's default `node` is v24; the repo pins `>=20 <21`. Run gate commands and commits under `~/.nvm/versions/node/v20.20.2/bin`.

### CF-18 (source/target axis) — now 7 distinct instances

CF-18 — that an inherited codebase carries residue from incomplete prior work, so inventory must surface both declared-state and actual-state — has recurred enough to be the dominant carry-forward rule. Distinct worked examples to date:

1. **Step 12** — brand-color migration: canonical-old hex and hand-migrated-new hex coexisting (site level).
2. **Step 14** — monorepo restructure: root tooling vs workspace duplicates (`package.json` level).
3. **P0a** — canonical migration source vs ad-hoc root scripts (SQL-artifact level).
4. **P0a** — Leviosa→Toodooh rebrand in backup-tree vs main migrations (DB-project-naming level).
5. **P0a** — 73-vs-30–60 triage estimate (planning-vs-reality level).
6. **P0b** — filename chronology vs dependency reality (migration-tooling level).
7. **P0b** — twin validation columns `verification_status` / `status` (column-definition level).

Whether to extract CF-18 into a standalone reference document (`docs/handoff/cf-18-source-target-axis.md`) is a **P0b-closeout** consideration — not done here.

---

## 13. Working method for closing the gaps

1. **One table at a time** — find every artifact (across all 4 `legacy-migrations/` sets) touching it; build cumulative schema by reconstructed dependency order.
2. **RPC functions** — every frontend `supabase.rpc(...)` call has a backing function; extract each.
3. **Per-table RLS** — document policy generations, not a false deterministic final set (per §2.3).
4. **Seed data** — `INSERT` statements for reference tables → JSON/CSV for Phase 1 seeds.
5. **Halt-on-finding** — surface anything that doesn't fit prior expectation rather than improvising interpretation.

**Remaining:** P0b Session 2 (campaign + geo + reference tables), Session 3 (financial + RPCs + remaining gaps).

---

## Document status

**Current state:** `business_profiles`, the admin-tables cluster, `auth.users`, and reference tables are fully inventoried; campaign / geo / financial tables and most RPC bodies remain (§8). Roughly 55–60% complete.

**Use case:** working reference for Phase 1's schema design. Each Phase 1 backend module consults the relevant section when designing its Drizzle schema and Fastify routes. Gaps close as P0b Sessions 2–3 proceed.
