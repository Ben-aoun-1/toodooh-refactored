# Phase 1c Commit 1 — onboarding columns + reference tables (governorates, business_sectors, predefined_zones) with seeds

First commit of Phase 1c (onboarding flow). Phase 1b (`48eefc8`) closed the auth
foundation. This commit is **schema-only**: 9 onboarding columns added to `users`, three
reference tables created + seeded. The onboarding endpoint (Commit 3), MinIO storage
(Commit 2), and document upload (Commit 4) come later. Schema-first, like Phase 1b
Commit 1.

**CF-23 applied to our OWN legacy SQL (not a library) surfaced one finding that needs an
architecture ruling before code:**

- **F1 (→ Q1) — `business_sectors` is a partial-migration mess.** The legacy table
  accreted across 5 migrations into a non-clean state: **10 generic sectors** (`wispy_leaf`,
  no `display_order` — superseded/dead), **'Agence de Publicité'** + **24 descriptive
  advertiser sectors** (`display_order` 0–24, the live advertiser list), **4 owner sectors**
  (Restaurant/Salon de the/Cafe populaire/Salle de sport — no accents in source), plus a **separate
  `owner_business_sectors` table** (a curated owner view, not in the architect's 3-table
  scope). Seeding it verbatim would carry dead data forward and leave no advertiser/owner
  discriminator. **Recommend (Q1): one `business_sectors` table with an `audience`
  discriminator** (`'advertiser'` | `'owner'`) + `display_order`; seed the **live** set
  only (Agence + 24 advertiser as `audience='advertiser'`; 4 owner as `audience='owner'`);
  **drop the 10 dead generic sectors**; skip the separate `owner_business_sectors` table
  (the discriminator replaces it).

Plus F2–F6 (name_ar absent, postal_code CHECK, predefined_zones shape, drizzle-kit seed
handling, business_type values). All micro-decisions in §2/§12. **No code until ratified.**

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `48eefc8` (Phase 1b audit refresh), pushed +
CI-green (run `26261483823`).

**Baseline floor (CF-10).** typecheck **51** / lint **1** / test **200** (160 web + 40
api) / build apps/web **139.80 kB**.

**CF-18 sweep — clean.** No onboarding columns on `users` (schema has only the Commit-1b
columns). No `governorates`/`business_sectors`/`predefined_zones` tables in `schema.ts`.
No `0003` migration. No new deps (this commit adds none).

**Node 20 PATH prefix** on every gate + git command. Heap bump on commit.

---

## §1 — Locked constraints

**No version changes** (no new deps — schema/seed only; verify lockfile untouched per the
Phase-1b dependency→lockfile learning).

**In scope (Commit 1.1), reflecting recommended F1–F6 resolutions:**

| File | Action |
| --- | --- |
| `apps/api/src/db/schema.ts` | modify — 9 onboarding columns on `users` + `governorates`/`business_sectors`/`predefined_zones` tables + types + FKs + indexes + postal_code CHECK |
| `apps/api/drizzle/0003_onboarding_columns_reference_tables.sql` (+ meta) | new — drizzle-kit DDL + **hand-appended seed INSERTs** (F5) |
| `apps/api/tests/db.test.ts` | modify — +6 (columns, 3 tables exist, seed counts, FK resolves) |

**Out of scope (per architect SCOPE-OUT):** MinIO/storage (Commit 2), `POST /api/onboarding`
(Commit 3), document upload (Commit 4), `business_type` as a pg enum (text + app-layer per
Decision 4), tax_number strict format (Phase 1g), frontend (Phase 1e), campaign/screen/
financial tables, RLS. **Also out (F1 ruling):** the separate `owner_business_sectors`
table + the 10 dead generic sectors.

---

## §2 — Inventory phase & CF-23 findings (verified against legacy SQL, not the summary)

Source: `docs/handoff/legacy-migrations/` migration files (read directly), cross-checked
with `supabase-schema-inventory.md` §2.2/§2.5.

### F1 (→ Q1) — `business_sectors` partial-migration mess (the architecture ruling)
Final legacy state (from `wispy_leaf` + `20250403000000` + `…100000` + `…120000` +
`…130000`):
- **10 generic** (`wispy_leaf`, `display_order` NULL): Commerce, Services, Industrie,
  Technologies, Tourisme, Agriculture, Construction, Transport, Éducation, Santé —
  **superseded by the descriptive list; dead.**
- **'Agence de Publicité'** (`display_order` 0).
- **24 descriptive advertiser** (`display_order` 1–24), names **verbatim from source**
  (`…0000`, cross-confirmed by `…120000`) with internal commas + accents per ratified
  Finding A (quoted to disambiguate the in-name commas):
  `'Agriculture et agroalimentaire'`(1), `'Automobile et mobilité'`(2),
  `'Banque, assurance et finance'`(3), `'Bâtiment, construction et immobilier'`(4),
  `'Beauté, bien-être et cosmétique'`(5), `'Commerce, retail et distribution'`(6),
  `'Communication, marketing, média et publicité'`(7),
  `'Conseil et services aux entreprises'`(8), `'Culture, divertissement et création'`(9),
  `'Éducation et formation'`(10), `'Énergie, environnement et développement durable'`(11),
  `'Hôtellerie, restauration et cafés'`(12), `'Industrie et fabrication'`(13),
  `'Informatique, technologie et télécommunications'`(14),
  `'Logistique, transport et livraison'`(15), `'Mode, textile et accessoires'`(16),
  `'Maison, décoration et ameublement'`(17), `'Santé, médical et pharmacie'`(18),
  `'Secteur public, institutions et collectivités'`(19),
  `'Services juridiques, comptables et administratifs'`(20), `'Sport, fitness et loisirs'`(21),
  `'Tourisme, voyage et événementiel'`(22),
  `'Associations, ONG et organisations internationales'`(23), `'Autre'`(24).
- **4 owner** (`…130000`, source-verbatim per ratified Finding B Option 1 — **no accents**,
  matching the live DB + inventory §2.5): `'Restaurant'`, `'Salon de the'`,
  `'Cafe populaire'`, `'Salle de sport'`.

**Recommend (Q1):** single `business_sectors` table with `audience text` (`'advertiser'` |
`'owner'`) + `display_order integer`; seed **Agence + 24 advertiser** (`audience='advertiser'`,
display_order 0–24) and **4 owner** (`audience='owner'`, display_order 1–4); **drop the 10
dead generic**; **skip `owner_business_sectors`** (the discriminator subsumes it). This
gives Commit 3 a clean role→audience filter and removes the partial-migration residue
(Phase-1 principle: don't reproduce legacy defects).

### F2 (→ Q2) — no `name_ar` in legacy
`wispy_leaf` seeds `INSERT INTO governorates (name)` and `business_sectors (name)` — both
**`name` only, no Arabic column**. Decision 2's "if legacy had it" → **it didn't.**
**Recommend (Q2): no `name_ar`.** (If bilingual display is wanted, that's a deliberate
Phase-1e addition, not a legacy port.)

### F3 (→ Q3) — postal_code CHECK
§2.2: `postal_code text NOT NULL CHECK valid_postal_code (^\d{4}$)`. Stable format (4-digit
Tunisian). **Recommend (Q3): apply as a DB CHECK** via Drizzle `check()`. The column is
**nullable** here (onboarding fills it; signup doesn't) — a CHECK on a nullable column
passes on NULL, so it only constrains supplied values. (Architect lean confirmed.)

### F4 (→ Q4) — predefined_zones shape + seed (exact, recovered)
Created `backup-tree/20250120000002`: `id uuid PK`, `name varchar(255) NOT NULL UNIQUE`,
`description text`, `latitude numeric(10,8) NOT NULL`, `longitude numeric(11,8) NOT NULL`,
`radius integer NOT NULL DEFAULT 1000`, `is_active boolean DEFAULT true`, timestamps;
`…20250330000001` adds `image_url text`, `is_hot boolean DEFAULT false`, `country
varchar(100) DEFAULT 'Tunisie'`, `region varchar(150)`. **Seed (8, verbatim):**
| name | description | lat | long | radius |
|---|---|---|---|---|
| Ariana | Zone d'Ariana et ses environs | 36.8625 | 10.1956 | 5000 |
| Tunis Centre | Centre-ville de Tunis | 36.8065 | 10.1815 | 3000 |
| Lac | Zone du Lac de Tunis | 36.8381 | 10.2417 | 4000 |
| La Marsa | Zone de La Marsa | 36.8782 | 10.3247 | 4000 |
| Sidi Bou Said | Zone de Sidi Bou Said | 36.8687 | 10.3417 | 2000 |
| Carthage | Zone de Carthage | 36.8529 | 10.3233 | 3000 |
| Menzah | Zone de Menzah | 36.8500 | 10.2000 | 3000 |
| El Manar | Zone d'El Manar | 36.8300 | 10.2200 | 3000 |

**Recommend (Q4): seed the full final shape** (incl. `is_active`, `is_hot`, `country`,
`region`, `image_url`) for fidelity — one clean table now beats an ALTER later. Note:
predefined_zones is **campaign-targeting** reference data (used in later slices), grouped
here as a reference table per the architect's scope; seeding now is harmless.

### F5 (→ Q5) — drizzle-kit emits no seed INSERTs
Same class as Phase-1a Commit 3's `CREATE EXTENSION postgis` finding: `drizzle-kit generate`
produces DDL only. **Recommend (Q5): hand-append the seed INSERTs** to the generated `0003`
SQL (governorates 24, business_sectors per Q1, predefined_zones 8), each `ON CONFLICT (name)
DO NOTHING` for idempotency.

### F6 (confirm) — business_type enum values (for Commit 3)
Legacy `wispy_leaf` `CREATE TYPE business_type AS ENUM ('local','national','agency',
'event_organizer')` — **not** the role values. The column is **text** this commit
(Decision 4); these four values feed Commit 3's zod enum. Surfaced for the record.

### Indexes / uniqueness (verified)
governorates `name UNIQUE`; business_sectors `name UNIQUE`; predefined_zones `name UNIQUE`.
On `users`: index `business_sector_id`, `governorate_id`, `onboarding_completed` (filter
pending-onboarding). FKs: `users.business_sector_id → business_sectors.id`,
`users.governorate_id → governorates.id` (both nullable; `ON DELETE` — recommend `SET NULL`
since a deleted reference row shouldn't cascade-delete users).

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **1.0** | Plan (this file). Halt; surface Q1–Q5; ratify; commit + push (CF-6). |
| **1.1** | schema.ts + 0003 migration (DDL + seeds) + db.test.ts. Halt; CF-9 (incl. migration/seed verify on real Postgres); ratify; push (CF-7). |

1.1 has one judgment seam (the Q1 business_sectors model); the rest is mechanical DDL +
verbatim seed data.

---

## §4 — Per-commit verification gates

### Gate 2 — per-package (apps/api floor: test 40 → 46)
```bash
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # 46 (needs Postgres for db.test.ts seed-count checks)
pnpm --filter @toodooh/api build       # success
```

### Gate 3 — root no-regression vs `48eefc8`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 200 | **206** (+6) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — migration + seed verification (real Postgres)
```bash
docker compose -f infra/docker-compose.yml up -d postgres   # fresh volume
pnpm --filter @toodooh/api migrate
# psql: 4 migrations (0000 postgis, 0001 users, 0002 accounts/sessions/verifications,
#   0003 onboarding+reference); users has the 9 new columns; governorates=24 rows,
#   predefined_zones=8 rows, business_sectors=29 rows (25 advertiser + 4 owner, Q1);
#   FKs resolve; postal_code CHECK present; onboarding_completed default false
```

### Gate 5 — CI Postgres service runs migrations through 0003; seed counts asserted.

---

## §5 — Standing operating procedure
CF-6 for 1.0; CF-7 for 1.1 (gate sweep → migration/seed verify → CF-9 → ratify → push →
CI). Node-20 prefix; heap bump. CF-18 re-sweep before first Write. CF-23 applied to legacy
SQL at plan-time (§2); seed values are verbatim from source. Dependency→lockfile checklist:
no new deps expected — verify lockfile untouched at 1.1.

---

## §6 — Hard-halt conditions
1. Q1 unratified — it shapes the `business_sectors` schema + seed; no code until ruled.
2. drizzle-kit emits unexpected SQL (DROP/side effects) for the ALTER or CREATE TABLEs.
3. Seed values can't be applied verbatim (encoding/accents corrupt: Béja, Gabès, thé,
   Café, événementiel, etc.) — halt; Phase-1e depends on exact strings.
4. Migration 0003 conflicts with the 0000–0002 chain.
5. Any gate regresses vs `48eefc8`.

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| seeding dead generic sectors | **Resolved by Q1** | Gate 4 count | drop the 10; audience discriminator |
| accent/encoding corruption in seeds | Medium | Gate 4 `psql` | UTF-8 verbatim from source; verify a sample row |
| drizzle-kit won't emit seeds | **Resolved by Q5** | 0003 review | hand-append INSERTs (Phase-1a precedent) |
| postal_code CHECK rejects valid signup (NULL) | Low | Gate 4 | CHECK passes on NULL; only constrains supplied values |
| FK ON DELETE cascade deletes users | Low | schema review | `ON DELETE SET NULL` on both FKs |
| predefined_zones over-built | Low | — | full final shape is the legacy end-state; harmless |

---

## §8 — Cross-references
- `supabase-schema-inventory.md` §2.2 (business_profiles columns + postal_code CHECK), §2.5
  (reference tables + seeds), §7 Defect 7 (dead predefined_zones admin RLS).
- Legacy SQL: `20250313112646_wispy_leaf` (governorates/business_sectors/business_type enum
  + 10 generic + 24 governorates), `20250403000000_advertiser_business_sectors` (24),
  `20250403100000_business_sectors_display_order` (Agence + display_order 0–24),
  `20250403130000_create_owner_business_sectors` (4 owner), `backup-tree/20250120000002_create_predefined_zones` (8 zones + coords).
- `docs/audit.md` §13 (Phase 1b). Prior: `48eefc8`.

---

## §9 — Carry-forward methodology
- **CF-9** — 1.1 pause: full schema.ts additions + 0003 verbatim (DDL + seeds) + Gate-4
  migration/seed-count verification.
- **CF-10** — floor re-confirmed (§0). **CF-18** — swept (§0).
- **CF-22** — F1 (business_sectors model) is a legacy-shape-vs-clean-design conflict surfaced
  for ratification; F2 (name_ar) corrects Decision 2.
- **CF-23 (fifth worked instance)** — the discipline applied to **our own legacy artifacts**:
  the inventory summary gave counts ("10 generic", "24 advertiser") but the **source SQL** gave
  the exact names, display_order, zone coordinates, and enum values. Summary necessary, source
  authoritative. The fresh session's source-verification caught **two** drifts in the prior
  session's verbatim listing before append-only commit: **Finding A** — 16 of 24 advertiser
  names were transcribed without their internal commas (lossy summary; ratified → adopt source
  comma'd/accented forms); **Finding B** — owner sectors `'Salon de the'`/`'Cafe populaire'`
  were silently "beautified" to accented forms (additive drift; ratified Option 1 → port
  legacy verbatim, no accents). Both fold into the Phase 1c audit refresh.
- **CF-22 (second use)** — Finding B was a genuine architect-authored fork surfaced for
  ratification rather than resolved by executor discretion; ratified verbatim-over-corrected.
- **dependency→lockfile** (Phase-1b learning) — N/A this commit (no deps); lockfile verified
  untouched at 1.1.

---

## §10 — Push policy + sequencing
**1.0** — `git add` plan; `docs(phase-1c): plan Commit 1 — onboarding columns + reference
tables`; push; `gh run watch` (CF-6). Node 20.
**1.1** — `git add apps/api`; commit (body: 9 columns + 3 tables + seeds + the ratified F1
audience model); push; `gh run watch` (CF-7). Node 20. No `Co-Authored-By`. **No lockfile
change expected** (no deps) — verify.

---

## §11 — Exact file contents (Commit 1.1)

> Reflects recommended F1–F6 resolutions (Q1 audience-discriminator single table, Q2 no
> name_ar, Q3 postal CHECK, Q4 full zone shape, Q5 hand-appended seeds). Adjusts to rulings.

### `apps/api/src/db/schema.ts` — users additions (append in the `users` column list)
```ts
    // ── onboarding (Phase 1c) — nullable; populated by POST /api/onboarding ──
    businessSectorId: uuid('business_sector_id').references(() => businessSectors.id, {
      onDelete: 'set null',
    }),
    businessType: text('business_type'), // text + zod enum at Commit 3 (local/national/agency/event_organizer)
    streetAddress: text('street_address'),
    city: text('city'),
    postalCode: text('postal_code'),
    governorateId: uuid('governorate_id').references(() => governorates.id, {
      onDelete: 'set null',
    }),
    registrationDocUrl: text('registration_doc_url'), // RNE — Commit 4 upload
    cinDocUrl: text('cin_doc_url'), // CIN — Commit 4 upload
    onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
```
users table third-arg gains: `check('users_postal_code_valid', sql\`postal_code ~ '^\\d{4}$'\`)`,
`index('users_business_sector_id_idx').on(table.businessSectorId)`,
`index('users_governorate_id_idx').on(table.governorateId)`,
`index('users_onboarding_completed_idx').on(table.onboardingCompleted)`.
(Imports gain `check` from `drizzle-orm/pg-core` and `sql` from `drizzle-orm`. The two
reference tables are declared **above** `users` so the `.references()` callbacks resolve —
or kept as callbacks, which defer resolution; declaration order verified at 1.1.)

### `apps/api/src/db/schema.ts` — reference tables (new)
```ts
export const governorates = pgTable('governorates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessSectors = pgTable('business_sectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  audience: text('audience').notNull(), // 'advertiser' | 'owner' (Q1) — zod-validated where written
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const predefinedZones = pgTable('predefined_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: numeric('longitude', { precision: 11, scale: 8 }).notNull(),
  radius: integer('radius').notNull().default(1000),
  isActive: boolean('is_active').notNull().default(true),
  isHot: boolean('is_hot').notNull().default(false),
  imageUrl: text('image_url'),
  country: text('country').notNull().default('Tunisie'),
  region: text('region'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Governorate = typeof governorates.$inferSelect;
export type NewGovernorate = typeof governorates.$inferInsert;
export type BusinessSector = typeof businessSectors.$inferSelect;
export type NewBusinessSector = typeof businessSectors.$inferInsert;
export type PredefinedZone = typeof predefinedZones.$inferSelect;
export type NewPredefinedZone = typeof predefinedZones.$inferInsert;
```
(Imports gain `integer`, `numeric` from `drizzle-orm/pg-core`.)

### `apps/api/drizzle/0003_onboarding_columns_reference_tables.sql`
drizzle-kit generates the `ALTER TABLE users ADD COLUMN …` (×9) + `CREATE TABLE governorates
/business_sectors/predefined_zones` + indexes + FKs + the CHECK. **Hand-appended seeds**
(verbatim, `ON CONFLICT (name) DO NOTHING`):
- `governorates` — 24 names (Tunis … Kebili, exact accents).
- `business_sectors` — 'Agence de Publicité' (advertiser, 0) + 24 advertiser (1–24) + 4
  owner ('Restaurant'/'Salon de the'/'Cafe populaire'/'Salle de sport' — no accents,
  source-verbatim per Finding B Option 1; audience 'owner', 1–4). **29 rows.**
- `predefined_zones` — the 8 rows from the §2 F4 table (name/description/lat/long/radius;
  is_active/is_hot/country/region default).

### `apps/api/tests/db.test.ts` (+6 → 46 apps/api total)
```ts
// 1. users exposes the 9 onboarding columns (businessSectorId, businessType, streetAddress,
//    city, postalCode, governorateId, registrationDocUrl, cinDocUrl, onboardingCompleted)
// 2. governorates / business_sectors / predefined_zones tables export with key columns
// 3. (Postgres) governorates seed = 24 rows
// 4. (Postgres) predefined_zones seed = 8 rows
// 5. (Postgres) business_sectors seed = 29 rows; audience IN ('advertiser','owner')
// 6. (Postgres) FK resolves: insert a user with a real governorate_id + business_sector_id
```
(Schema-shape tests are DB-free; the seed-count + FK tests need Postgres — same env-aware
pattern as the signup suite. Exact split locked at 1.1.)

---

## §12 — Fire instruction
This is **Commit 1.0** (plan). Architect: ratify the micro-decisions; on approval, commit +
push docs-only. **Halt** until then.

- **Q1 (architecture) — `business_sectors` single table + `audience` discriminator;** seed
  the live set (Agence + 24 advertiser + 4 owner), **drop the 10 dead generic**, **skip
  `owner_business_sectors`**. *Recommend yes (removes partial-migration residue; gives
  Commit 3 a clean role→audience filter).*
- **Q2 — no `name_ar`** (legacy had none). *Recommend.*
- **Q3 — postal_code as a DB CHECK** `^\d{4}$` (nullable; constrains only supplied values).
  *Recommend.*
- **Q4 — predefined_zones full final shape** (description/is_active/is_hot/country/region/
  image_url) + the 8-row seed. *Recommend.*
- **Q5 — hand-append seed INSERTs** to the drizzle-kit migration (`ON CONFLICT DO NOTHING`).
  *Recommend (Phase-1a precedent).*
- **Q6 (confirm) — `business_type` stays text;** legacy enum values `local`/`national`/
  `agency`/`event_organizer` feed Commit 3's zod. *Acknowledge.*

Plus acknowledge: FKs `ON DELETE SET NULL`; count lift apps/api 40 → 46 / root 200 → 206;
no new deps (lockfile untouched). CF-22 (F1, F2) + CF-23 (legacy-SQL verification) in §9.
