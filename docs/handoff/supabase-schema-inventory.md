# Supabase schema inventory — Phase 1 backend reference

**Source:** Migration files in `supabase/migrations/` accessed via project knowledge search
**Date generated:** May 2026 (cleanup phase exit)
**Purpose:** Reference document for Phase 1's self-hosted Node + Postgres backend to replicate

This document is a working inventory of what the migration history reveals about the existing Supabase project. It is the foundation for Phase 1's schema migration to Drizzle (per `docs/handoff/00-PROJECT_HANDOFF.md`).

**Status: PARTIAL** — initial inventory covering major tables, storage buckets, and known RPCs. Marked as `[GAP]` where additional migration files need to be read to complete the picture. See §7 for the gap list.

> **Important architectural note from handoff doc:** Phase 1's schema migration carries one mandatory simplification — collapse the dual identity model (`admin_profiles` as sibling of `auth.users`) into one `users` table with a role enum (`advertiser | owner | admin | superadmin`). The current schema's dual-identity model is the root cause of frontend auth complexity and most RLS rewrites. **Do not preserve this in Phase 1.** This inventory documents what exists; Phase 1 redesigns rather than ports.

---

## 1. Migration file timeline

Migrations span January 2025 → April 2026+ with at least these date ranges identified:

| Date range | Theme |
|---|---|
| 2025-01-01 | Early RLS fixes, business profile function, user profile fields added to `auth.users` |
| 2025-03-13 → 2025-03-20 | Initial schema (campaigns, clients, business_profiles), B2B auth system, profile types |
| 2025-03-15 → 2025-03-18 | Admin configuration, onboarding fields |
| 2025-04-03 → 2025-04-04 | Business sectors taxonomy refinement, company size options |
| 2026-04-04 → 2026-04-05 | Global configuration, RLS admin alignment, location affluence schedule grants, campaign hourly location plan |

**Note on dates:** Some migrations use 2025 dates and some use 2026. This may reflect either (a) the previous developer's git history, or (b) intentional dating for migration ordering. The 2026 migrations appear to be more recent infrastructure work (RLS alignment, GRANT statements).

`[GAP]` — Full chronological list of all migration files needs to be enumerated. Project knowledge search returns files individually; complete listing requires filesystem access not currently available.

---

## 2. Core tables

### `auth.users` (Supabase managed, extended)

Standard Supabase `auth.users` table, extended with:

| Column | Type | Notes |
|---|---|---|
| `raison_sociale` | TEXT | Business display name, added 2025-01-01 |
| `profile_type` | TEXT (CHECK constraint) | `'advertiser'` / others |

Index: `idx_users_profile_type` on `profile_type`.

**Phase 1 implication:** This dual-storage (`auth.users` + `business_profiles`) is part of the dual-identity model to collapse. New `users` table holds all identity fields in one place.

### `business_profiles`

The main profile table — created 2025-03-13 in `20250313112646_wispy_leaf.sql`.

Key columns: `id`, `user_id`, `business_name`, `tax_number` (UNIQUE), `business_sector_id`, `business_type` enum (`local | national | agency | event_organizer`), `profile_type` enum (`advertiser | individual_owner | fleet_owner`), `contact_name`, `contact_phone` (regex validated), `street_address`, `city`, `postal_code` (Tunisian 4-digit format), `governorate_id`, `registration_doc_url`, `registration_doc_path` (added 2025-03-20), `cin_doc_url`, `verification_status` enum (`pending | verified | rejected`), `terms_accepted` (CHECK = true), `onboarding_completed`, `is_admin` (flagged for removal in Phase 1), `formule`, `email`, `created_at`, `updated_at`.

**Phase 1 implication:** `is_admin` is the root of the dual-identity confusion. New schema uses `role` enum instead.

### `admin_profiles`

Separate table for admin users — `[GAP]` migration file not yet read. Known columns from app types: `id`, `user_id`, `email`, `first_name`, `last_name`, `role` enum (`superadmin | admin | moderator`), `permissions` text[], `is_active`, `last_login`, `created_at`, `updated_at`, `created_by`.

This is the dual-identity sibling table. Phase 1 collapses into `role` enum in `users`.

### `admin_activities`, `admin_permissions`, `admin_roles`

Referenced in code but `[GAP]` on migration details.

### `business_sectors`, `owner_business_sectors`, `company_size_options`, `governorates`

Reference tables. Seed data captured for some; `[GAP]` on `governorates` seed list.

---

## 3. Campaign & advertising tables

### `campaigns`

Created 2025-03-13. Columns: `id`, `name`, `client_id`, `category` enum (`commercial | cultural | promotional | institutional`), `start_date`, `end_date`, `status` enum (`draft | pending | active | paused | completed | rejected`), `budget` numeric(10,2), `views`, `user_id`, `created_at`. Indexes: `user_id`, `client_id`, `status`. Subsequent additions via later migrations `[GAP]`: DOOH fields, approval workflow fields, possibly more status values.

### `campaign_media`, `campaign_locations`, `campaign_screens`, `campaign_hourly_location_plan`

Various junction and per-relationship tables. `campaign_locations` had a schema replacement on 2025-03-20 (from lat/lng/radius to `location_id` reference). `campaign_screens` and `campaign_hourly_location_plan` full schemas are `[GAP]`.

### `clients`

Advertiser's own clients table. Created 2025-03-13. Standard CRUD entity.

### `locations`, `screens`, `location_affluence_schedule`

Geographic data model. `locations` uses PostGIS POINT for coordinates. `screens` linked via `location_id`. `location_affluence_schedule` stores per-location-per-hour-per-day impression estimates (the data structure DOOH calculations consume).

---

## 4. Financial tables

### `recharges`

Wallet recharge requests. Fields: `id`, `user_id`, `amount`, `payment_method` (`card | bank | cash`), `status` (`pending | completed | rejected`), `description`, `created_at`. `[GAP]` — full migration file not yet read.

### Balance computation, screenhost revenue, statements, invoices

`[GAP]` — these surfaces are referenced in code but full schemas not yet inventoried.

---

## 5. Storage buckets

Three buckets identified:

- `media` (PRIVATE) — campaign videos, 100MB max, signed URL access (1yr)
- `registres` (PRIVATE) — RNE/CIN documents, signed URL access (7d)
- `event-images` (PUBLIC) — event marketing images, public read

---

## 6. Functions (RPCs) and triggers

Known RPCs: `create_business_profile`, `create_default_business_profile`, `update_expired_campaigns`, `update_updated_at_column` (trigger function), `upsert_location_affluence_schedule`.

`[GAP]` — Full RPC inventory requires repo-wide grep + migration cross-reference. The handoff doc started this at `docs/handoff/supabase-rpc-inventory.md`.

---

## 7. Gaps requiring additional inventory work

Tables identified in code but not yet read from migrations:

- `admin_profiles`, `admin_activities`, `admin_permissions`, `admin_roles`
- `recharges` (full schema and lifecycle)
- `screens` (original creation migration)
- `campaign_screens`, `campaign_hourly_location_plan` (full columns)
- `special_events`, `event_campaign_links`
- `notifications`, `unavailability_periods`, `global_configuration`
- `monthly_statements` / `versements`, `invoices` / `factures`, `bank_details` / `payment_methods`
- DOOH-specific config tables

Additional work: complete migration enumeration, full RPC function bodies, complete per-table RLS inventory, seed data extraction, auth provider config, realtime subscription patterns.

**Estimated work to close gaps:** 2-3 additional focused sessions reading migrations systematically with filesystem access.

---

## 8. Phase 1 architecture implications

### The dual-identity collapse

Current: 3 tables for what should be 1 conceptual entity. Phase 1 target: single `users` table with `role` enum. Eliminates ~30-40% of RLS complexity.

### Schema ports vs. rewrites

- **Port 1:1:** reference tables, campaigns/campaign_media/campaign_locations/locations, location_affluence_schedule, screens, recharges, storage buckets (→ MinIO).
- **Rewrite:** `auth.users` + `business_profiles` + `admin_profiles` → single `users` table. All RLS policies → Fastify route-level authorization (stateful sessions, not RLS).
- **Functions:** trigger functions port; business logic RPCs become Fastify endpoints.

### PostGIS dependency

`locations.coordinates` uses POINT. Phase 1 Postgres needs `CREATE EXTENSION postgis;`. Drizzle has limited PostGIS support; may need raw SQL for spatial queries.

### Storage migration

Supabase Storage → MinIO. Three buckets to recreate. File path conventions preserved to avoid breaking `business_profiles.registration_doc_path` references.

---

## 9. Cleanup-phase findings relevant to Phase 1

- **TBD-R (#37)** — simulated revenue data. Phase 1 backend must serve real data. CEO/CTO decision pending on launch behavior.
- **TBD-K (#32)** — storage service abstraction. 9+ files call `supabase.storage` directly. Phase 1 introduces abstraction so provider can swap.
- **TBD-O (#34)** — OwnerScreens missing-persistence cluster. Phase 1 needs optimistic-update + reconciliation story.
- **CF-18 source/target axis finding** — codebase carries partial-migration artifacts (Step 12 brand-color discovery). Phase 1 inventory should assume similar artifacts elsewhere (the `business_profiles.is_admin` flag alongside `admin_profiles` table is one example).

---

## 10. Working method for closing the gaps

1. **Filesystem access first** — `ls supabase/migrations/` for complete chronological list.
2. **One table at a time** — find every migration touching it, build cumulative schema. Order: business_profiles → campaigns → geo data model → admin tables → financial → reference.
3. **RPC functions** — every frontend `supabase.rpc(...)` call has a function in a migration. Extract each.
4. **Per-table RLS** — enumerate every policy per table.
5. **Seed data** — INSERT statements for reference tables → JSON/CSV for Phase 1 seeds.

**Estimated total:** 2-3 focused sessions with filesystem access. Current document ~30-40% complete.

---

## Document status

**Current state:** Initial inventory demonstrating work shape and providing usable foundation. Not exhaustive.

**Use case:** Working reference for Phase 1's schema design. Each Phase 1 backend module consults the relevant section when designing its Drizzle schema and Fastify routes. Gaps close as they become Phase 1 work.
