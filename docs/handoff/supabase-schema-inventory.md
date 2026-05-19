# Supabase schema inventory — Phase 1 backend reference

**Source:** Legacy SQL artifacts under `docs/handoff/legacy-migrations/` (extracted in
Step P0a from `github.com/toodooh-source/toodooh` at `df0ef04`)
**Date generated:** May 2026 (cleanup phase exit); built out across P0b Sessions 1–4; P0b closed
**Purpose:** Reference document for Phase 1's self-hosted Node + Postgres backend to replicate

This document is a working inventory of what the migration history reveals about the existing Supabase project. It is the foundation for Phase 1's schema migration to Drizzle (per `docs/handoff/00-PROJECT_HANDOFF.md`).

**Status: COMPLETE (P0b closed) — ~98% of the legacy schema, which is 100% of what the artifacts can yield.** Every artifact-readable table, subsystem, RPC, storage bucket, and the auth config are inventoried. The only residue is four tables whose `CREATE` lives outside the migration history (`admin_permissions`, `admin_roles`, `factures`, `external_api_keys`) — Phase-1 live-DB discovery items, not artifact gaps. See §8.

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

All inventoried in P0b Session 3.

**`business_sectors`** — created `wispy_leaf` (`id uuid PK gen_random_uuid()`, `name text NOT NULL UNIQUE`). `…20250403100000_business_sectors_display_order` adds `display_order integer`. RLS: `authenticated` SELECT `true` (wispy_leaf) + `anon` SELECT `true` (`…20250403110000`, for the signup form). Seeds accreted across migrations: 10 generic sectors (`wispy_leaf`), 24 advertiser sectors (`…20250403000000_advertiser_business_sectors`), `'Agence de Publicité'` at `display_order 0` (`…20250403100000`), 4 owner sectors (`Restaurant`, `Salon de the`, `Cafe populaire`, `Salle de sport` — `…20250403130000`). The table is a flat shared list; advertiser/owner distinction is layered on by `owner_business_sectors`.

**`governorates`** — created `wispy_leaf` (`id uuid PK`, `name text NOT NULL UNIQUE`). RLS: `authenticated` + `anon` SELECT `true`. Seed: **24 Tunisian governorates** — Tunis, Ariana, Ben Arous, Manouba, Nabeul, Zaghouan, Bizerte, Béja, Jendouba, Le Kef, Siliana, Sousse, Monastir, Mahdia, Sfax, Kairouan, Kasserine, Sidi Bouzid, Gabès, Medenine, Tataouine, Gafsa, Tozeur, Kebili.

**`owner_business_sectors`** (`…20250403130000_create_owner_business_sectors`) — `id uuid PK`, `business_sector_id uuid NOT NULL UNIQUE FK business_sectors(id) ON DELETE CASCADE`, `name text NOT NULL UNIQUE`, `display_order integer NOT NULL UNIQUE CHECK (> 0)`. RLS: `authenticated` + `anon` SELECT `true`. A curated owner-facing view onto `business_sectors`.

**`company_size_options`** (`…20250403140000_create_company_size_options`) — `id uuid PK`, `value text NOT NULL UNIQUE`, `display_order integer NOT NULL UNIQUE CHECK (> 0)`. RLS: `authenticated` + `anon` SELECT `true`. Seed: 5 rows — `0 - 10`, `10 - 50`, `50 - 100`, `100 - 500`, `500 et plus`.

**`predefined_zones`** — created by the **backup-only** migration `backup-tree/20250120000002_create_predefined_zones`. `id uuid PK`, `name varchar(255) NOT NULL UNIQUE`, `description text`, `latitude numeric(10,8) NOT NULL`, `longitude numeric(11,8) NOT NULL`, `radius integer NOT NULL DEFAULT 1000`, `is_active boolean DEFAULT true`, `created_at`, `updated_at`; constraints `valid_latitude` / `valid_longitude` / `valid_radius`; partial index on `is_active`, index on `name`; trigger `trigger_update_predefined_zones_updated_at`. `…20250330000001_predefined_zones_image_hot_country_region` later adds `image_url text`, `is_hot boolean DEFAULT false`, `country varchar(100) DEFAULT 'Tunisie'`, `region varchar(150)`. Seed: 8 Tunis-area zones (Ariana, Tunis Centre, Lac, La Marsa, Sidi Bou Said, Carthage, Menzah, El Manar). RLS — see §7 Defect 7 (the admin-management policy is dead).

### 2.6 `global_configuration`

The business-parameter store and **home of the v3 pricing model**. Created by formal migration `20260404120000_create_global_configuration`: a key/value table — `key text PRIMARY KEY`, `value_text text NOT NULL`, `value_type text NOT NULL CHECK(integer|numeric|boolean|json|text)`, `description text`, `updated_at timestamptz`, `updated_by uuid FK auth.users(id) ON DELETE SET NULL`. RLS: `authenticated` SELECT `true`; admin INSERT/UPDATE via `business_profiles.is_admin` (migrations `20260404120500` / `20260404131000`).

Seeded keys (the DOOH pricing/limits config the engine reads):

| key | value | type | meaning |
|---|---|---|---|
| `video_max_duration_seconds` | 30 | integer | max creative length |
| `video_min_duration_seconds` | 1 | integer | min creative length |
| `video_default_duration_seconds` | 15 | integer | fallback when real duration is absent |
| `max_billable_spot_rate_per_hour` | 0.30 | numeric | cap on billable spots/hour (0..1) |
| `standard_campaign_cpm_tnd` | 2.5 | numeric | CPM for standard campaigns |
| `event_campaign_cpm_tnd` | 2.5 | numeric | CPM for event campaigns |
| `max_spots_per_hour` | 10 | integer | max plannable spots/hour before billable-rate cap |
| `dooh_occupation_reference_rph` | 10 | numeric | reference repetitions/hour for the 0..1 occupation ratio (`20260405140000`) |

*Observation:* the CPM lives here (2.5 TND), but `calculate_campaign_cost` (§4.4) **hard-codes** `cpm := 2.5` rather than reading `standard_campaign_cpm_tnd` — the function predates this table. Phase 1's cost logic should read config, not a literal. (`20260404120500` re-`INSERT`s `max_spots_per_hour`, already seeded by the create migration — a harmless `ON CONFLICT DO NOTHING` duplicate.)

---

## 3. Campaign tables & geographic data model

Inventoried in P0b Session 3. Enums (both created in `20250313112340_empty_hall`):
`campaign_status` = `draft | pending | active | paused | completed | rejected`;
`campaign_category` = `commercial | cultural | promotional | institutional` — plus `parc` added by `…20250320000009_add_parc_campaign_category` (`ALTER TYPE … ADD VALUE`).

### 3.1 `campaigns`

Created `20250313112340_empty_hall`.

| Column | Type | Default / constraint | Origin |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | empty_hall |
| `name` | `text` | NOT NULL | empty_hall |
| `client_id` | `uuid` | FK `clients(id)` ON DELETE CASCADE | empty_hall |
| `category` | `campaign_category` enum | NOT NULL | empty_hall |
| `start_date` | `timestamptz` | NOT NULL | empty_hall |
| `end_date` | `timestamptz` | NOT NULL, CHECK `valid_dates` (`end > start`) | empty_hall |
| `status` | `campaign_status` enum | NOT NULL DEFAULT `'draft'` | empty_hall |
| `budget` | `numeric(10,2)` | NOT NULL DEFAULT 0, CHECK `valid_budget` (`>= 0`) | empty_hall |
| `views` | `integer` | NOT NULL DEFAULT 0 | empty_hall |
| `created_at` | `timestamptz` | DEFAULT `now()` | empty_hall |
| `user_id` | `uuid` | FK `auth.users(id)` ON DELETE CASCADE | empty_hall |
| `publication_schedule` | `jsonb` | — (hourly impression/repetition data) | `…20250101000009_add_publication_schedule_to_campaigns` |
| `event_id` | `uuid` | FK `special_events(id)` ON DELETE SET NULL | `…20250320000005_campaigns_event_id_and_mes_events` |
| `location_lat` | `numeric` | CHECK `valid_location_lat` (NULL or −90..90) | root `add_location_columns_to_campaigns` |
| `location_lng` | `numeric` | CHECK `valid_location_lng` (NULL or −180..180) | root `add_location_columns_to_campaigns` |
| `location_radius` | `numeric` | CHECK `valid_location_radius` (NULL or `> 0`) | root `add_location_columns_to_campaigns` |

**Indexes:** `idx_campaigns_user_id`, `idx_campaigns_client_id`, `idx_campaigns_status` (empty_hall); `idx_campaigns_location` partial index on `(location_lat, location_lng, location_radius)` (root `add_location_columns_to_campaigns`).
**Triggers:** `trigger_check_expired_campaign` BEFORE UPDATE → `check_and_complete_expired_campaign()` auto-sets `status = 'completed'` when an `active`/`paused` campaign's `end_date` has passed (`…20250131000000`). The same migration adds the batch function `update_expired_campaigns()`.
**RLS:** 4 own-row policies (`auth.uid() = user_id`, empty_hall); 2 admin policies (`mute_snowflake`) using the recursive `is_admin` sub-query on `business_profiles` (§7 Defect 3).

**⚠️ Phase 1 choice point — campaign targeting has four parallel representations:** the `location_lat/lng/radius` columns above, the `campaign_locations` junction (§3.3), the `campaign_screens` junction (§3.4), and the `campaign_hourly_location_plan` table (§3.5). They accreted as the targeting model evolved (free radius → location → screen → hourly plan); none was retired. Phase 1 must pick one canonical targeting model. The document only describes the coexistence.

### 3.2 `campaign_media`

Created `empty_hall`: `id uuid PK`, `campaign_id uuid FK campaigns(id) ON DELETE CASCADE`, `url text NOT NULL`, `filename text NOT NULL`, `created_at timestamptz`. Index `idx_campaign_media_campaign_id`. RLS: 3 policies (view/insert/delete) gated on the owning campaign. This is the **legacy** campaign-creative table; the `videos` table + `campaigns.video_id` (§3.9) supersede it.

### 3.3 `campaign_locations` — schema replaced

**Original** (`empty_hall`): `id uuid PK`, `campaign_id uuid FK`, `latitude numeric`, `longitude numeric`, `radius numeric`, `created_at`; constraints `valid_latitude/longitude/radius`; 4 RLS policies; index `idx_campaign_locations_campaign_id`.

**Replaced** by `…20250320000017_locations_and_affluence_schedule` — which runs `DROP TABLE IF EXISTS campaign_locations CASCADE` and recreates it as a pure junction: `campaign_id uuid FK campaigns(id) ON DELETE CASCADE`, `location_id uuid FK locations(id) ON DELETE CASCADE`, `created_at`, `PRIMARY KEY (campaign_id, location_id)`. 2 indexes; 3 own-campaign RLS policies. The `CASCADE` drop destroys all original rows and the old RLS. This is a CF-18 source/target instance at the column-set level — see §12.

### 3.4 `campaign_screens`

Created by **root-script** `create_campaign_screens_table` (not a formal migration): `id uuid PK`, `campaign_id uuid FK campaigns(id) ON DELETE CASCADE`, `screen_id uuid FK screens(id) ON DELETE CASCADE`, `created_at`, `UNIQUE(campaign_id, screen_id)`. Indexes `idx_campaign_screens_campaign_id`, `idx_campaign_screens_screen_id`. RLS: 3 own-campaign policies + 1 admin (`FOR ALL` via `admin_profiles … is_active = true`). The script also defines a `campaign_screens_details` view. A later migration (`…20260405220000`) calls this table "legacy" — it predates the location-based targeting model.

### 3.5 `campaign_hourly_location_plan`

Created `…20260405153000_create_campaign_hourly_location_plan` (formal): `id uuid PK`, `campaign_id uuid FK campaigns(id) ON DELETE CASCADE`, `location_id uuid FK locations(id) ON DELETE CASCADE`, `diffusion_date date NOT NULL`, `diffusion_hour smallint NOT NULL CHECK (0..23)`, `planned_repetitions_per_hour integer NOT NULL DEFAULT 0 CHECK (>= 0)`, `planned_impressions integer NOT NULL DEFAULT 0 CHECK (>= 0)`, `created_at`, `updated_at`, `UNIQUE (campaign_id, location_id, diffusion_date, diffusion_hour)`. Indexes `idx_chlp_campaign_id`, `idx_chlp_location_date_hour`, `idx_chlp_date_hour`. Trigger `update_campaign_hourly_location_plan_updated_at`. The "final hourly plan post-cursor" — one row per campaign/location/date/hour. RLS: own-campaign SELECT/INSERT/UPDATE, then refined across 4 follow-on migrations — `…20260405204000` (owner-write + strict checks), `…211500` (allow screen-targeted campaigns), `…213000` (pure-location RLS), `…220000` (compat with legacy `campaign_screens`).

### 3.6 `campaign_categories`

Created `…20250320000007_campaign_categories`: a junction — `campaign_id uuid NOT NULL FK campaigns(id) ON DELETE CASCADE`, `category campaign_category NOT NULL`, `PRIMARY KEY (campaign_id, category)`. RLS: 3 own-campaign policies. Back-filled from `campaigns.category` on creation. **Note:** this multi-category junction coexists with the single-valued `campaigns.category` column — another partial-migration twin (a Phase 1 choice point, like the §2.2 validation columns).

### 3.7 `clients`

Advertiser's own clients table. Created `empty_hall`: `id uuid PK`, `name text NOT NULL`, `contact_email text` (CHECK `valid_email`), `contact_phone text`, `address text`, `created_at`, `user_id uuid FK auth.users(id) ON DELETE CASCADE`. Index `idx_clients_user_id`. RLS: 4 own-row policies.

### 3.8 Geographic data model

**`screens`** — created `20250101000006_create_screens_tables` (dependency-neutral; references only `auth.users`, so its true position is ambiguous). Columns: `id uuid PK`, `owner_id uuid NOT NULL FK auth.users(id) ON DELETE CASCADE`, `name varchar(255) NOT NULL`, `location varchar(500) NOT NULL`, `address text`, `coordinates POINT`, `screen_type varchar(50) DEFAULT 'led' CHECK (led|lcd|projector|other)`, `resolution_width integer`, `resolution_height integer`, `screen_size_inches decimal(5,2)`, `orientation varchar(20) DEFAULT 'landscape' CHECK (landscape|portrait|square)`, `status varchar(20) DEFAULT 'active' CHECK (active|inactive|maintenance|unavailable)`, `is_online boolean DEFAULT true`, `last_heartbeat timestamptz`, `installation_date date`, `warranty_expiry_date date`, `monthly_revenue decimal(10,2) DEFAULT 0`, `total_revenue decimal(10,2) DEFAULT 0`, `loyalty_points integer DEFAULT 0`, `created_at`, `updated_at`. `…20250320000017` adds `location_id uuid FK locations(id) ON DELETE SET NULL`. Indexes: `idx_screens_owner_id`, `idx_screens_status`, `idx_screens_location` GIST on `coordinates`, `idx_screens_location_id`. Trigger `update_screens_updated_at`. RLS: 4 owner-scoped policies (`auth.uid() = owner_id`). The `monthly_revenue` / `total_revenue` columns relate to TBD-R (simulated revenue) — see §10. *Note:* `screens.location` (free-text varchar) and `screens.location_id` (FK) are a twin — a Phase 1 choice point.

**Screen satellite tables** (all created in `20250101000006`, all RLS owner-scoped via a join to `screens`):
- `screen_unavailability_periods` — `id`, `screen_id FK`, `start_date`, `end_date`, `start_time`, `end_time`, `reason`, `status (pending|active|completed|cancelled)`, `created_by FK auth.users`, timestamps; constraints `no_overlapping_periods` UNIQUE, `valid_date_range`, `valid_time_range`. (This is the `unavailability_periods` table named in earlier gap lists.)
- `screen_configurations` — per-screen device config (`brightness_level`, `volume_level`, `auto_brightness`, `auto_volume`, `timezone`, `language`, `refresh_rate`, `power_schedule jsonb`, `maintenance_mode`); `UNIQUE(screen_id)`.
- `screen_statistics` — per-screen-per-day playback stats; `UNIQUE(screen_id, date)`.
- `screen_alerts` — `alert_type`, `severity`, `title`, `message`, `is_resolved`, `resolved_at`, `resolved_by`.
- `screen_activity_logs` — `action`, `details jsonb`, `performed_by`; INSERT policy is open (`WITH CHECK (true)`).

Functions in `20250101000006`: `check_unavailability_status()` (reconciles unavailability windows ↔ `screens.status`), `create_screen_with_config()` (inserts a screen plus default config + stats rows).

**`locations`** — created `…20250320000017`: `id uuid PK`, `owner_id uuid NOT NULL FK auth.users(id) ON DELETE CASCADE`, `name varchar(255) NOT NULL`, `address text`, `coordinates POINT`, `created_at`, `updated_at`. `…20250303120000_locations_signup_fields` (reconstructed-late — filename-dated before `locations` exists) adds `city varchar(255)`, `zone text`, `governorate_id uuid FK governorates(id) ON DELETE SET NULL`, `screen_count integer`, `room_count integer`, `postal_code varchar(32)`. Indexes: `idx_locations_owner_id`, `idx_locations_coordinates` GIST. Trigger `update_locations_updated_at`. RLS: 4 owner-scoped policies. A location groups several screens (`screens.location_id`) and is the audience unit for affluence/CPM.

**`location_affluence_schedule`** — created `…20250320000017`: `id uuid PK`, `location_id uuid NOT NULL FK locations(id) ON DELETE CASCADE`, `day_of_week smallint NOT NULL CHECK (1..7)`, `hour smallint NOT NULL CHECK (0..23)`, `estimated_impressions integer NOT NULL DEFAULT 0`, `created_at`, `updated_at`, `UNIQUE(location_id, day_of_week, hour)`. Index `idx_location_affluence_schedule_location_id`. RLS: a `FOR ALL` owner-scoped policy, then refined by `…20260404230000` (authenticated SELECT), `…20260404290000` (repair grants), `…20260405232000` (admin write policy). This is the per-location-per-hour-per-day impression table the DOOH engine consumes.

**`calculate_campaign_cost(uuid)`** — SECURITY DEFINER RPC (`…20250320000017`): computes campaign cost at CPM 2.5, preferring `campaign_locations` × `location_affluence_schedule`, falling back to `campaign_screens` × `screen_affluence_config`, then to `campaigns.budget`. **Re-defined divergently in `create_balance_system`** — see §7 Defect 8. (`screen_affluence_config` is part of the screen-affluence subsystem — §3.10.)

### 3.9 Video subsystem — `videos`

The current campaign-creative model. Created by root `simplified_video_system` (the canonical end-state of ~8 churning video scripts — `recreate_video_system_correctly`, `migrate_to_one_video_per_campaign`, `fix_video_*`, etc.).

| Column | Type | Default / constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `url` | `text` | NOT NULL |
| `filename` | `text` | NOT NULL |
| `file_size` | `bigint` | CHECK `valid_file_size` (`> 0`) |
| `duration` | `integer` | CHECK `valid_duration` (`> 0`) |
| `thumbnail_url` | `text` | — |
| `validation_status` | `varchar(20)` | DEFAULT `'pending'`, CHECK `pending \| approved \| rejected` |
| `validated_by` | `uuid` | FK `admin_profiles(id)` ON DELETE SET NULL |
| `validated_at` | `timestamptz` | — |
| `validation_notes` | `text` | — |
| `uploaded_by` | `uuid` | NOT NULL FK `auth.users(id)` ON DELETE CASCADE |
| `created_at` / `updated_at` | `timestamptz` | DEFAULT `now()` |
| `duration_seconds` | `double precision` | — (added by formal migration `…20260404220000_videos_duration_seconds`, "for the DOOH engine") |

*Note:* `duration` (`integer`, seconds) and `duration_seconds` (`double precision`) coexist — a minor twin; Phase 1 keeps one.

Indexes: `idx_videos_validation_status`, `idx_videos_uploaded_by`. RLS: own-row SELECT/INSERT/UPDATE + admin SELECT/UPDATE. Functions `get_video_validation_stats()`, `get_campaigns_using_video(uuid)`. View `admin_videos_view` (video + uploader + validator + campaign count).

**`campaigns` integration:** `simplified_video_system` adds `campaigns.video_id uuid FK videos(id) ON DELETE SET NULL` and `campaigns.content_validation_status varchar(20)` CHECK(`pending|approved|rejected`); index `idx_campaigns_video_id`. A trigger propagates a video's validation result to every campaign using it:

```sql
CREATE OR REPLACE FUNCTION update_campaigns_on_video_validation()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE campaigns
    SET content_validation_status = NEW.validation_status
    WHERE video_id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaigns_validation
    AFTER UPDATE OF validation_status ON videos
    FOR EACH ROW
    WHEN (OLD.validation_status IS DISTINCT FROM NEW.validation_status)
    EXECUTE FUNCTION update_campaigns_on_video_validation();
```

**1:N → 1:1 model migration.** The legacy `campaign_media` table (§3.2, created `empty_hall`) modelled creatives as *many media rows per campaign*. The `videos` table + `campaigns.video_id` FK replace it with *one video per campaign* — a record-cardinality change (CF-18 instance 9, §12). `campaign_media` is not dropped; both models coexist in the schema, and the `migrate_to_one_video_per_campaign` root-script name confirms a data migration between them.

### 3.10 Screen-affluence subsystem

DOOH audience measurement. **Three** affluence representations now coexist in the schema (a Phase 1 choice point — see §9):

1. `location_affluence_schedule` (§3.8) — per-location, per-hour, editable *estimate*.
2. `screen_affluence_config` — per-screen admin-tuned *parameters* + a derived estimate.
3. `screen_affluence_data` / `screen_affluence_history` — raw IoT sensor *telemetry*.

**`screen_affluence_config`** (root `create_screen_affluence_config`) — `id uuid PK`, `screen_id uuid NOT NULL UNIQUE FK screens(id) ON DELETE CASCADE`, `avg_passby_per_hour`, `avg_turnback_per_hour`, `avg_in_per_hour`, `avg_out_per_hour` (all `integer DEFAULT 0`), `avg_stay_time_ms integer DEFAULT 45000`, `peak_hour_start integer DEFAULT 12 CHECK(0..23)`, `peak_hour_end integer DEFAULT 14 CHECK(0..23)`, `peak_multiplier decimal(3,2) DEFAULT 1.5`, `estimated_impressions_per_hour integer DEFAULT 0`, `use_manual_calculation boolean DEFAULT false`, `notes text`, `updated_by uuid FK admin_profiles(id) ON DELETE SET NULL`, `updated_at`, `created_at`; constraint `valid_peak_hours`. Functions `calculate_impressions_from_config(...)`, `update_screen_affluence_config(...)`; view `screens_with_affluence_config`; trigger `trigger_update_affluence_config_updated_at`. A companion root-script `create_trigger_auto_affluence_config` adds `create_default_affluence_config()` + `trigger_create_affluence_config` — auto-inserts a config row when a screen is created. `estimated_impressions_per_hour` is the value `calculate_campaign_cost`'s screen-based path consumes (§4.4 / §7 Defect 8).

**`screen_affluence_data`** — raw per-period IoT telemetry from the screens' people-counting sensors. **Defined twice, divergently** (§7 Defect 9): `create_screen_affluence_system` (slim form) and `create_complete_screen_affluence_system` (rich ~40-column form: sensor identity `sn`/`hw_platform`/`sw_release`/`ip_address inet`/`mac_address macaddr`, counts `in_count`/`out_count`/`passby_count`/`turnback_count`/`avg_stay_time`, per-person `attributes jsonb`, REID entry/exit pairing, dedup fields). FK `screen_id → screens ON DELETE CASCADE`; RLS owner-scoped + admin.

**`screen_affluence_history`** (`create_complete_screen_affluence_system` only) — aggregated rollups: `data_start_time`/`data_end_time`, `total_entries`/`total_exits`/`total_passby`/`total_turnback`, `avg_dwell_time`, `peak_hour CHECK(0..23)`, `peak_count`. View `screen_affluence_stats`; functions `calculate_estimated_impressions_detailed(...)`, `insert_affluence_data(...)`. Formal migration `20260404292000` drops an advertiser RLS policy on `screen_affluence_config`.

### 3.11 Special events

**`special_events`** (root `create_special_events_system`) — `id uuid PK`, `name varchar(255) NOT NULL`, `description text`, `event_type varchar(50) NOT NULL CHECK(concert|sport|festival|conference|exposition|salon|autre)`, `start_date`/`end_date timestamptz NOT NULL`, `location varchar(500) NOT NULL`, `city varchar(255) NOT NULL`, `address text`, `latitude decimal(10,8)`, `longitude decimal(11,8)`, `category varchar(50) CHECK(commercial|cultural|promotional|institutional)`, `is_active boolean DEFAULT true`, `is_featured boolean DEFAULT false`, `expected_attendance integer`, `target_audience text`, `image_url text`, `banner_url text`, `pricing_multiplier decimal(5,2) DEFAULT 1.0 CHECK(> 0)`, `priority_level integer DEFAULT 1 CHECK(1..10)`, `created_by uuid FK admin_profiles(id)`, `created_at`, `updated_at`; constraints `valid_dates`, `valid_coordinates`, `valid_multiplier`.

**`event_campaigns`** — junction (the gap list called it `event_campaign_links`; the actual name is **`event_campaigns`**): `id uuid PK`, `event_id uuid NOT NULL FK special_events(id) ON DELETE CASCADE`, `campaign_id uuid NOT NULL FK campaigns(id) ON DELETE CASCADE`, `linked_at`, `linked_by uuid FK admin_profiles(id)`, `UNIQUE(event_id, campaign_id)`. Note `campaigns.event_id` (§3.1) is a *separate* direct FK — an event campaign can be linked both ways, a mild redundancy.

View `admin_events_view`; function `get_events_stats()`. Event RPCs (formal migrations `20250320000000`–`20250320000006`): `get_featured_events(int)`, `get_all_events(int,int)` + `get_all_events_count()`, `link_campaign_to_event(uuid,uuid)`, `get_my_event_campaigns_events()`, `get_my_event_campaign_links()` — `SETOF`/`TABLE` query wrappers granted to `authenticated` (the read ones also to `anon`). See §6.

---

## 4. Financial tables

Inventoried in P0b Session 4 (area A). The financial layer is **prepaid**: advertisers recharge a balance, campaigns debit against it. There is **no money in formal migrations** — all of it lives in root-scripts.

### 4.1 `recharges`

Wallet recharge requests. Created by root `create_recharges_table`.

| Column | Type | Default / constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL FK `auth.users(id)` ON DELETE CASCADE |
| `amount` | `numeric(10,2)` | NOT NULL, CHECK `> 0` |
| `payment_method` | `text` | NOT NULL DEFAULT `'card'`, CHECK `card \| bank \| cash` |
| `status` | `text` | NOT NULL DEFAULT `'pending'`, CHECK `completed \| pending \| failed \| cancelled` |
| `reference` | `text` | UNIQUE (auto `RCH-YYYY-NNNNNN`) |
| `description` | `text` | — |
| `transaction_id` | `text` | — |
| `validated_by` | `uuid` | FK `admin_profiles(id)` |
| `validated_at` | `timestamptz` | — |
| `validation_notes` | `text` | — |
| `created_at` / `updated_at` | `timestamptz` | DEFAULT `now()` |

> *Correction:* a prior version of this inventory listed the status set as `pending | completed | rejected`. The actual CHECK (`create_recharges_table.sql:11`) is **`completed | pending | failed | cancelled`**.

Indexes: `idx_recharges_user_id`, `idx_recharges_status`, `idx_recharges_created_at` (DESC). Trigger `trigger_set_recharge_reference` → `set_recharge_reference()` / `generate_recharge_reference()` auto-assigns `reference` on INSERT. RLS: own-row SELECT/INSERT + admin SELECT/UPDATE (via `admin_profiles … is_active = true`). View `recharges_stats` — per-user recharge aggregates.

### 4.2 Balance computation — no ledger

**There is no balance or wallet table.** A user's balance is a *computed function* — `get_user_balance(uuid)` from `create_balance_system`:

```sql
CREATE OR REPLACE FUNCTION get_user_balance(p_user_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  total_recharges NUMERIC;
  total_spent NUMERIC;
  balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total_recharges
  FROM recharges WHERE user_id = p_user_id AND status = 'completed';

  SELECT COALESCE(SUM(budget), 0) INTO total_spent
  FROM campaigns WHERE user_id = p_user_id AND status IN ('active', 'completed');

  balance := total_recharges - total_spent;
  RETURN balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Balance = `SUM(completed recharges) − SUM(budget of active/completed campaigns)`. There is **no transactions/ledger table and no audit trail** — every balance read recomputes from `recharges` and `campaigns`. Related: `check_sufficient_balance(user, campaign)`, `check_campaign_balance(campaign)` (returns JSON with `available_balance` / `campaign_cost` / `balance_after`), and trigger `verify_balance_before_campaign_activation` on `campaigns` (BEFORE UPDATE) — if balance is insufficient when a campaign moves to `pending`/`active`, it forces `status` back to `'draft'` and writes a `validation_notes` message. View `user_balance_info` joins the computed balance with profile data.

> **⚠️ Phase 1 choice point — financial ledger.** The computed-balance model has no transaction history, no audit trail, and recomputes on every read. Phase 1 should introduce a proper append-only `transactions` ledger from day one (money-adjacent — see CLAUDE.md rule 10). This inventory documents what exists; the decision is deferred to the Phase 1 architecture conversation.

### 4.3 `factures` (invoices)

Advertiser-side invoices. **`create_automatic_invoicing_system` only `ALTER`s `factures`** (`:122`, adds `campaign_id`) — it never `CREATE`s it. The creation source is untracked → `[GAP]`. This is the **third instance** of the "core table not formally migrated" pattern (after the `admin_*` cluster, §2.4, and `campaign_screens`, §3.4).

Observed columns (from the `INSERT` in `generate_invoice_for_campaign` + the `ALTER`): `id`, `numero` (UNIQUE, auto `INV-YYYY-NNNNNN`), `user_id`, `campaign_id uuid FK campaigns(id) ON DELETE SET NULL`, `montant numeric`, `statut text` (`en_attente | payee`), `date_emission`, `date_echeance` (emission + 30 days), `description`, `created_at`. Index `idx_factures_campaign_id`. View `factures_with_campaigns`.

Functions: `generate_invoice_for_campaign(uuid)` (idempotent — one invoice per campaign); trigger `auto_generate_invoice_on_campaign_active` on `campaigns` (AFTER INSERT/UPDATE OF status) auto-creates an invoice when a campaign goes `active`. `get_monthly_invoice_last_month(uuid)` / `get_user_invoices_with_monthly(uuid)` synthesize **dynamic, unstored** consolidated monthly invoices (`statut = 'payee'`, prepaid model — the debit already happened).

### 4.4 Cost calculation

`calculate_campaign_cost(uuid)` estimates campaign cost at a fixed **CPM of 2.5 TND**. It is **defined twice with divergent logic** — see §7 Defect 8. Both forms multiply estimated impressions by CPM, falling back to `campaigns.budget`.

### 4.5 Not present in the legacy schema

The earlier gap list named `bank_details` / RIB, `payment_methods` (table), and `monthly_statements` / `versements` (screenhost payouts). **None exist in any legacy artifact** — `payment_method` is only a `recharges` column, and monthly invoices are synthesized dynamically (§4.3), not stored. These are **Phase 1 greenfield** (or live-DB-only and undiscoverable from artifacts). The screenhost-payout side in particular appears never to have been built.

> The `create_campaign_monitoring_system` and `create_platform_stats_functions` root-scripts (admin campaign-monitoring / platform-stats views and functions) are lightly covered — admin-dashboard reporting, non-blocking for Phase 1 schema design (§8).

---

## 5. Storage buckets & platform config

### 5.1 Storage buckets

Four buckets. Three are defined by formal migrations (each `INSERT INTO storage.buckets … ON CONFLICT` + four bucket-scoped `storage.objects` RLS policies); the fourth is not artifact-defined.

| Bucket | Public | Defined by | RLS |
|---|---|---|---|
| `event-images` | **public** | `20250320000001_storage_event_images_bucket` | upload/update/delete = `authenticated`; SELECT = `public` |
| `registres` | private | `20250320000015_storage_registres_bucket` (4 simple `authenticated` policies) **and** `SOLUTION_FINALE_ADMIN_UPLOAD.sql` (richer `is_admin_user()` + `^cin_<uid>`/`^rne_<uid>` path-match policies) | two overlapping policy generations — see note |
| `zone-images` | **public** | `20250330000002_storage_zone_images_bucket` | upload/update/delete = `authenticated`; SELECT = `public` |
| `media` | private (campaign videos) | **no artifact** — live-DB-only | see below |

**`media` bucket — confirmed not artifact-defined.** No `INSERT INTO storage.buckets` for `'media'` and no `media`-scoped policy exists in any of the four legacy-migrations sets. The frontend uses a `media` bucket (campaign videos, signed URLs), so it exists in the live project — but it was created via the Supabase dashboard, not SQL. **Closed as a finding:** media-bucket config is live-DB-only, a Phase 1 storage-migration (MinIO) discovery item, not an artifact-readable gap.

**`registres` has two policy generations** — the simple `20250320000015` set (`authenticated` can do anything in the bucket) and the later `SOLUTION_FINALE_ADMIN_UPLOAD` set (admin-or-own-path via `is_admin_user()`). The numerous `fix_registres_bucket_rls` / `cleanup_and_recreate_storage_policies` root-scripts are churn over this bucket; effective end-state is non-deterministic from artifacts (same shape as the §2.3 RLS-generation finding).

### 5.2 Auth provider configuration

From `supabase/config.toml` in the source mirror (`df0ef04`; non-destructive read, mirror unmodified):

- **`[auth] site_url = "https://itstrategix.tn"`** and `additional_redirect_urls = ["https://itstrategix.tn"]` — the **previous developer's domain is the configured auth site/redirect URL**. This is the `itstrategix.tn` issue from handoff §8 (auth redirects to a domain the project owner doesn't control), confirmed here at the Supabase-config layer. Phase 1's self-hosted auth must own this.
- `jwt_expiry = 3600`; refresh-token rotation on (`reuse_interval = 10`); `enable_signup = true`; `enable_anonymous_sign_ins = false`; `minimum_password_length = 6` (weak by modern standards).
- `[auth.email]`: `enable_signup = true`, `double_confirm_changes = true`, **`enable_confirmations = false`** (email-address confirmation is **off** — signups are not email-verified), `otp_expiry = 3600`.
- `[auth.sms]`: disabled. `[auth.mfa.totp]`: enroll + verify enabled; `[auth.mfa.phone]`: disabled.
- `[auth.external.*]`: OAuth providers (Apple, …) `enabled = false` — **email/password only**.

Phase 1 (Better-auth, self-hosted): owns its own domain, should raise the password floor, decide the email-verification policy deliberately, and carries over email/password-only + optional TOTP.

---

## 6. Functions (RPCs) and triggers

Known RPCs / functions:

- `get_business_profile_by_email(text)` — SECURITY DEFINER; returns a `business_profiles` row joined on email. **Signature is stale** — see §7 Defect 2.
- `create_business_profile(...)` — SECURITY DEFINER; validates input and inserts a `business_profiles` row. Accepts `p_is_admin boolean DEFAULT false` (the privilege-escalation hole noted in handoff §8).
- `create_default_business_profile(uuid, text)` — SECURITY DEFINER; inserts a placeholder profile derived from the email.
- `is_admin_user(uuid)` — SECURITY DEFINER; dual-identity bridge (§2.4).
- `fill_business_profile_email()` — SECURITY DEFINER trigger function; back-fills `business_profiles.email` from `auth.users`.
- `update_updated_at_column()` — generic `updated_at` trigger function (defined in `wispy_leaf`, re-defined in `admin_database_queries` and `20250101000006`).
- `update_expired_campaigns()` — batch: sets `active`/`paused` campaigns to `completed` once `end_date` passes (`…20250131000000`); `check_and_complete_expired_campaign()` is its per-row trigger form.
- `calculate_campaign_cost(uuid)` — SECURITY DEFINER campaign-cost estimator at CPM 2.5 (§3.8).
- `check_unavailability_status()`, `create_screen_with_config(...)` — screen lifecycle helpers (`20250101000006`, §3.8).
- `get_my_event_campaigns_events()` — SECURITY DEFINER; returns the events a user's campaigns are linked to (`…20250320000005`).
- `get_user_balance`, `calculate_campaign_cost`, `check_sufficient_balance`, `check_campaign_balance`, `generate_invoice_for_campaign`, `get_monthly_invoice_last_month` — financial RPCs, see §4.
- `get_video_validation_stats`, `get_campaigns_using_video` — video RPCs, see §3.9.
- `calculate_impressions_from_config`, `update_screen_affluence_config`, `calculate_estimated_impressions(_detailed)`, `insert_affluence_data`, `create_default_affluence_config` — screen-affluence RPCs/triggers, see §3.10.
- `get_featured_events(int)`, `get_all_events(int,int)`, `get_all_events_count()`, `link_campaign_to_event(uuid,uuid)`, `get_my_event_campaign_links()`, `get_events_stats()` — event RPCs, see §3.11. Plain `SETOF`/`TABLE` query wrappers; `anon`+`authenticated` grants on the read ones.

**`upsert_location_affluence_schedule(api_key text, slots jsonb) RETURNS json`** — SECURITY DEFINER external-API ingestion (`20250320000022`, granted to `anon`+`authenticated`). Authenticates the caller against an **`external_api_keys`** table (`key_hash = encode(digest(api_key,'sha256'),'hex') AND active = true`), validates each slot (`location_id` exists, `day_of_week` 1–7, `hour` 0–23, `estimated_impressions ≥ 0`), then `INSERT … ON CONFLICT (location_id, day_of_week, hour) DO UPDATE` into `location_affluence_schedule`; returns `{success, affected_rows}` or a `{success:false, error, code}` JSON envelope (401/400/404/500). Its sibling `20250320000021_external_api_getlocalite_createlocalite` uses the same `external_api_keys` gate. **`external_api_keys` creation is a `[GAP]`** (referenced, never `CREATE`d in any artifact — see §8).

Triggers: `update_business_profiles_updated_at`, `trg_fill_business_profile_email`, `update_admin_profiles_updated_at`, `update_admin_roles_updated_at`, `update_admin_permissions_updated_at`, `update_screens_updated_at`, `update_unavailability_updated_at`, `update_configurations_updated_at`, `update_locations_updated_at`, `update_campaign_hourly_location_plan_updated_at`, `trigger_check_expired_campaign`, `trigger_update_predefined_zones_updated_at`, `trigger_set_recharge_reference`, `verify_balance_before_campaign_activation`, `auto_generate_invoice_on_campaign_active`, `trigger_update_campaigns_validation`, `trigger_update_affluence_config_updated_at`, `trigger_create_affluence_config`.

RPC inventory is now substantively complete. Bodies of the simple event/stats query-wrapper functions are not reproduced (their `SETOF special_events` / `RETURNS TABLE` signatures + the descriptions above are faithful); the logic-bearing functions (`get_user_balance` §4.2, `update_campaigns_on_video_validation` §3.9, `upsert_location_affluence_schedule` above) have full bodies inline.

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

### Defect 7 — Dead `predefined_zones` admin RLS policy

*What:* the admin-management RLS policy on `predefined_zones` can never match. *Where:* `backup-tree/20250120000002_create_predefined_zones.sql` — the policy `"Admins can manage predefined zones"` uses `USING (EXISTS (SELECT 1 FROM business_profiles WHERE user_id = auth.uid() AND profile_type = 'admin'))`. *Why it matters:* the `profile_type` enum is `advertiser | individual_owner | fleet_owner` — there is **no `'admin'` value**. The predicate is unsatisfiable, so no one can manage `predefined_zones` through this policy (admin status lives in `is_admin` / `admin_profiles`, not `profile_type`). The zones are effectively read-only after seeding. *Phase 1:* admin authorization is a middleware role check; the dead-predicate class cannot recur.

### Defect 8 — `calculate_campaign_cost(uuid)` defined twice, divergently

*What:* the cost-calculation RPC has two `CREATE OR REPLACE FUNCTION` definitions with different logic. *Where:* `migrations/20250320000017_locations_and_affluence_schedule.sql:91` defines it **location-based** — preferring `campaign_locations × location_affluence_schedule`, falling back to `campaign_screens × screen_affluence_config`, then `campaigns.budget`. `root-scripts/create_balance_system.sql:35` re-defines it **screen-based only** — `campaign_screens × screen_affluence_config`, falling back to `campaigns.budget` (no location branch). Both have signature `calculate_campaign_cost(uuid)`, so the second to run silently replaces the first. *Why it matters:* the campaign-cost math — and therefore the balance check that gates campaign activation (§4.2) — is **non-deterministic from the artifacts**; production behaviour depends on script run order. Money-adjacent. *Phase 1:* one canonical implementation. The underlying location-based-vs-screen-based costing model is itself a Phase 1 design choice point (§9).

### Defect 9 — Two divergent `screen_affluence_data` definitions

*What:* `screen_affluence_data` has two incompatible `CREATE TABLE IF NOT EXISTS` definitions. *Where:* `root-scripts/create_screen_affluence_system.sql` (slim form) and `root-scripts/create_complete_screen_affluence_system.sql` (rich ~40-column IoT form). *Why it matters:* whichever script ran first wins; the other no-ops — the live `screen_affluence_data` shape is non-deterministic from the artifacts (same class as Defect 4's divergent `admin_profiles`). Neither is a formal migration. *Phase 1:* one canonical telemetry table; pick the rich form if IoT sensor ingest is retained.

---

## 8. Gaps requiring additional inventory work

Closed by P0b Session 1: `business_profiles` (full), `admin_profiles` / `admin_activities` (full), `auth.users` extension. Closed by **Session 3**: the campaign tables cluster (`campaigns`, `campaign_media`, `campaign_locations`, `campaign_screens`, `campaign_hourly_location_plan`, `campaign_categories`, `clients`), the geographic data model (`screens` + 5 satellite tables, `locations`, `location_affluence_schedule`), and reference tables (`business_sectors`, `governorates`, `owner_business_sectors`, `company_size_options`, `predefined_zones`) including seeds.

Closed by **Session 4 (areas A+B — Commit 1a)**: `recharges`, the balance-computation architecture, `factures`/invoicing, the `videos` subsystem. Confirmed **not present** in any artifact (moved to §4.5, no longer gaps): `bank_details`/RIB, `payment_methods` table, `monthly_statements`/`versements`.

Closed by **Session 4 (areas C–I — Commit 1b)**: the screen-affluence subsystem (§3.10), special events (§3.11), `global_configuration` (§2.6), storage bucket policies (§5.1), auth provider configuration (§5.2), RPC bodies (§6).

Findings — confirmed **not present** in any artifact (closed as findings, not open gaps):

- **`notifications`** — no `notifications` / `notification_*` table exists in any of the four legacy-migrations sets. Only `business_profiles`' `notify_*` preference columns (§2.2). The frontend notification UI is therefore either client-only or backed by a live-DB table created outside the migration history. Phase 1 builds notifications greenfield.
- **`media` storage bucket** — created via the Supabase dashboard, no SQL artifact (§5.1).
- `bank_details`/RIB, `payment_methods`, `monthly_statements`/`versements` (§4.5).

Residual `[GAP]` — **creation migration unknown** (table referenced/`ALTER`ed but never `CREATE`d in any artifact; live-DB-only):

- `admin_permissions`, `admin_roles` (§2.4)
- `factures` (§4.3)
- `external_api_keys` (§6 — gates the external-API RPCs)

These three cannot be closed from artifacts — Phase 1 confirms them against the live database (or simply redesigns them, as with the admin collapse). `create_campaign_monitoring_system` / `create_platform_stats_functions` (admin dashboards/stats) remain lightly covered — low-priority, non-blocking for Phase 1 schema design.

**The inventory is ~98% complete.** What remains is genuinely Phase-1 live-DB discovery work, not artifact reading.

---

## 9. Phase 1 architecture implications

### The dual-identity collapse

Current: `auth.users` + `business_profiles` + `admin_profiles` for what should be one conceptual entity. Phase 1 target: a single `users` table with a `role` enum. Eliminates ~30–40% of RLS complexity and removes the entire admin-tables-only-in-root-scripts fragility (§2.4).

### Schema ports vs. rewrites

- **Port 1:1:** reference tables, campaigns / campaign_media / campaign_locations / locations, location_affluence_schedule, screens, recharges, storage buckets (→ MinIO).
- **Rewrite:** `auth.users` + `business_profiles` + `admin_profiles` → single `users` table. All RLS policies → Fastify route-level authorization (stateful sessions, not RLS).
- **Functions:** trigger functions port; business-logic RPCs become Fastify endpoints.
- **Pick one validation column** — resolve the `verification_status` / `status` duplication (§2.2).
- **Pick one campaign-targeting model** — resolve the four parallel representations (`location_lat/lng/radius`, `campaign_locations`, `campaign_screens`, `campaign_hourly_location_plan`; §3.1), and the `campaigns.category` / `campaign_categories` single-vs-multi duplication (§3.6).
- **PostGIS POINT in two tables** — `screens.coordinates` and `locations.coordinates` both use `POINT` with GIST indexes; see below.
- **Financial ledger** — the legacy schema has no transactions/ledger table; balance is recomputed on every read (§4.2). Phase 1 should build an append-only `transactions` ledger with an audit trail from day one. Money-adjacent — see CLAUDE.md rule 10.
- **Cost calculation model** — `calculate_campaign_cost` exists in a location-based and a screen-based form (§7 Defect 8). Phase 1 picks one costing model; this determines the canonical campaign-targeting representation too.
- **Affluence representation** — three coexist (§3.10): editable per-location estimates (`location_affluence_schedule`), per-screen admin parameters (`screen_affluence_config`), and raw IoT telemetry (`screen_affluence_data`). Phase 1 decides which is the source of truth for impression estimation and whether IoT ingest is retained.
- **Auth ownership & policy** — Phase 1's self-hosted auth must drop `itstrategix.tn` (§5.2), and should deliberately set the password floor and the email-verification policy (`enable_confirmations` was `false`).

### PostGIS dependency

`locations.coordinates` and `screens.coordinates` both use `POINT`, each with a GIST index (`idx_locations_coordinates`, `idx_screens_location`). Phase 1 Postgres needs `CREATE EXTENSION postgis;`. Drizzle has limited PostGIS support; may need raw SQL for spatial queries. The legacy `campaign_locations` (pre-replacement) and `campaigns.location_lat/lng` used plain `numeric` lat/lng instead — Phase 1 should standardize on one spatial representation.

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

## 12. Methodology — see the dedicated documents

The methodology surfaced during P0a + P0b is consolidated outside this inventory, so this document stays focused on schema:

- **`docs/handoff/cf-18-source-target-axis.md`** — the source/target axis rule: an inherited codebase carries residue from incomplete prior work, so inventory must surface both declared-state and actual-state. Nine distinct worked instances accumulated across the cleanup phase and P0a/P0b — seven of them (instances 3–9) from this prerequisite track: the ad-hoc-root-script schema, the Leviosa→Toodooh rebrand, the triage estimate, the unreliable filename chronology, the twin validation columns, the `campaign_locations` column-set replacement, and the `campaign_media`→`videos` cardinality change. The per-table sections of this document are themselves a CF-18-disciplined inventory.
- **`docs/handoff/methodology-and-prompt-format.md` Part 4** — the operational notes from P0a + P0b (grep-everything, negative-claim verification, close-absent-as-finding, migrations-win-over-assumed-names, non-destructive external reads, bidirectional honest reporting, security-finding surfacing, the Node-version operational note, split-large-scopes).

The "chronology is unreliable" caveat that governs this document's ordering is stated in §1; CF-18 instance 6 is its general form.

---

## 13. Working method for closing the gaps

1. **One table at a time** — find every artifact (across all 4 `legacy-migrations/` sets) touching it; build cumulative schema by reconstructed dependency order.
2. **RPC functions** — every frontend `supabase.rpc(...)` call has a backing function; extract each.
3. **Per-table RLS** — document policy generations, not a false deterministic final set (per §2.3).
4. **Seed data** — `INSERT` statements for reference tables → JSON/CSV for Phase 1 seeds.
5. **Halt-on-finding** — surface anything that doesn't fit prior expectation rather than improvising interpretation.

**Remaining:** P0b Commit 2 (closeout — methodology notes, CF-18 standalone-doc decision, `audit.md` update). Schema-inventory reading is complete.

---

## Document status

**Current state: P0b closed.** Every artifact-readable schema element is inventoried — core identity tables, campaign cluster, geographic + screen-affluence model, financial layer, video subsystem, special events, `global_configuration`, reference tables, storage buckets, auth config, and RPC bodies. Residue is four live-DB-only tables (§8), not artifact gaps — they are confirmed against the live database (or redesigned) when Phase 1 begins. P0b commits: `fba93b9`, `e171272`, `bd58b55`, `84517d5`, plus this closeout.

**Use case:** working reference for Phase 1's schema design. Each Phase 1 backend module consults the relevant section when designing its Drizzle schema and Fastify routes.
