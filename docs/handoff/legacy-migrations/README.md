# Legacy Supabase SQL artifacts

Historical SQL extracted from the previous developer's source repository, kept as
**Phase 1 schema reference**. These files are **not runnable migrations** against any
active database — Phase 1's backend rebuilds the schema in Drizzle + Postgres from
scratch. They exist so the Drizzle schema can be designed to match what the live
Supabase project currently is.

## Provenance

- **Source:** `github.com/toodooh-source/toodooh` at commit
  `df0ef04b5bad5852e5a6801399c60741d957d8be` ("Initial commit").
- **Extraction method:** non-destructive read via `git ls-tree` and
  `git show <commit>:<path>`. No `git checkout` was performed; the source mirror at
  `~/Desktop/toodooh-web/` was left with its HEAD and working tree unchanged.
- **Extracted:** Step P0a, Phase 1 backend migration.

The source repo carried SQL in several disconnected places — a formal migration
folder, a `scripts/` folder, an in-repo backup snapshot, and ~167 loose ad-hoc
scripts at the repo root. This directory consolidates the schema-bearing subset of
all of them. The relationships and gaps between the sets are documented below.

## The sets

### `migrations/` — 74 files

Formal Supabase CLI migration history, from `supabase/migrations/`. Chronological,
timestamp-numbered (`20250101000000` → `20260405232000`). This is the closest thing
to a canonical schema-evolution record. **It is not complete on its own** — money
-adjacent schema (balance, invoicing, recharges) lives only in `root-scripts/`, and
four migrations exist only in `backup-tree/` (see below).

### `backup-tree/` — 22 files

Migrations from an **in-repo backup snapshot** dated 11 January 2026, originally at
`toodoohsauv11012026/supabase/migrations/` ("sauv" = *sauvegarde*, French for
backup). This is an alternative-state reference, not part of the live migration
history. Relationship to the main 74:

- **4 files exist ONLY in `backup-tree/`** — schema preserved nowhere else in the
  formal record:
  - `20250120000000_add_owner_fields.sql`
  - `20250120000001_verify_rls_owner_fields.sql`
  - `20250120000002_create_predefined_zones.sql`
  - `20250120000003_fix_predefined_zones_rls.sql`
- **17 files are byte-identical** to their `migrations/` namesakes.
- **1 file differs** — `20250315114307_mute_snowflake.sql` (a seed migration that
  creates an admin user). The difference is a 3-line rebrand: the `migrations/`
  copy uses `admin@leviosa.tn` / "Leviosa Administration"; the `backup-tree/` copy
  uses `admin@toodooh.tn` / "Toodooh Administration". The project's `config.toml`
  still carries `project_id = "Leviosa"`, so the main copy is the older
  Leviosa-branded version and the backup carries the post-rename Toodooh version.

P0b should treat the 4 backup-only migrations as real schema and reconcile the
`mute_snowflake` rebrand explicitly.

### `scripts/` — 5 files

Backfill / seed scripts from `supabase/scripts/`. Not part of formal migration
history; data-population scripts for reference tables and repair operations.

### `root-scripts/` — 73 files

The previous developer's ad-hoc deployment scripts, extracted from the **167 loose
`.sql` files at the source repo root**. Only the **73 schema-bearing** ones were
kept; the other 94 were data-only operations or read-only diagnostics (see triage
below). This set includes money-adjacent schema definitions that do **not** appear
in the formal `migrations/` folder — `create_balance_system.sql`,
`create_automatic_invoicing_system.sql`, `create_recharges_table.sql`,
`create_campaign_monitoring_system.sql`, `create_special_events_system.sql`, and
others — plus a large body of RLS-policy churn (`fix_*_rls*.sql`).

**Triage criteria** (filename pattern + content inspection of each file):

- **IN SCOPE (73):** any file containing DDL — `CREATE TABLE/VIEW/TYPE/FUNCTION/`
  `POLICY/TRIGGER/INDEX`, `ALTER TABLE/TYPE`, `DROP TABLE/POLICY/...`,
  `ENABLE ROW LEVEL SECURITY`, or `GRANT`. Subsystem-creation scripts
  (`create_*`, `*_system.sql`, `SETUP_*`, `EXECUTE_MOI.sql`) and column/constraint
  additions (`add_*`, `ADD_*`) land here when their content defines schema.
- **OUT OF SCOPE (94):** read-only diagnostics (`check_*`, `diagnose_*`,
  `verify_*`), data-only operations (`INSERT`/`UPDATE` against existing schema —
  test data, seed rows, status fixes), and manual-instruction stubs. A `fix_*` or
  `add_*` script with no DDL in its body is data-only and was excluded.
- **Tie-breaker:** when uncertain, IN SCOPE — easier to skip a script during P0b
  than to miss a schema gap.

## What is NOT included, and why

- `toodoohsauv11012026/src_sauv 26092025 sans admin.zip` — a zipped frontend
  source backup; no schema content expected.
- `mobile-app/CONFIGURATION_SUPABASE*.md` — mobile-app Supabase config docs, no
  SQL. Relevant later for Player API design, not for schema inventory.
- 94 of the 167 root scripts — read-only diagnostic queries and data-only
  operations (counts in the triage section above).
- `debug-*.js` / `test-*.js` / `analyze-*.js` investigation scripts — point-in-time
  JS, not schema-bearing. If any are later found to carry useful embedded DDL, an
  `investigation/` subfolder will be added as a separate decision.

## Purpose & cross-references

Phase 1 reference material only. The new backend (Drizzle + Postgres) will not run
these files; they document the current Supabase schema so the Drizzle schema can be
designed to match.

- `docs/audit.md` §9 — Phase-1 prerequisites (Supabase documentation work)
- `docs/handoff/00-PROJECT_HANDOFF.md` §4 — Phase 1 target architecture
- `docs/handoff/supabase-schema-inventory.md` — the schema inventory document being
  built from these files in Step P0b
