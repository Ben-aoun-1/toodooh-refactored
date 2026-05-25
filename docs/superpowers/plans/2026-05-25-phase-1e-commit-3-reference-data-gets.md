# Phase 1e (Part A) — Commit 3: reference-data GET endpoints

**Date:** 2026-05-25 · **Phase:** 1e (backend prerequisites) · **Commit:** 3 of Part A (last feature)
**Branch:** main · **Entry HEAD:** `a63b50d` (Commit 2) · **Node:** 20.20.2 (PATH prefix)
**Status:** DRAFT — held for architect approval. The §2 inventory disposes the pre-disposed set and
surfaces **1 gap to ratify** (company_size_options: fetched but no apps/api table + field is
collect-and-ignore — CF-22).

Goal: the public, read-only GET endpoints the signup wizard + profile forms fetch to populate
dropdowns — built **only** for categories the frontend actually fetches from a backend, matching the
exact shape it consumes (CF-24: truthful to the frontend). Seeded-table SELECT → JSON, no auth.

---

## §0 — Pre-flight verification

- Tree clean at `a63b50d`; Commit 2 CI-green.
- Floor entering: **apps/api 140 / root 300** (typecheck 51 / lint 1 / apps/web build 139.80 kB).
- Latest migration `0006`; **no schema change** this commit (reads existing seeded tables). No new
  env, no new deps (confirm all untouched).
- apps/api reference tables present + seeded: `governorates` (24), `business_sectors` (29 = 25
  advertiser + 4 owner), `predefined_zones` (8). There is **no** `company_size_options` or
  `support_objectives_*` table in apps/api (only those three).

## §1 — Locked constraints (architect)

- **PUBLIC, no auth** (D1): the wizard fetches reference data before any session exists. No
  `requireAuth`. Non-sensitive public catalog.
- **Build to the FE's actual fetch** (CF-24/D3): FETCHED-from-backend → endpoint; FRONTEND-HARDCODED
  → no endpoint (the WiFi-trap rule).
- One commit (D5).

## §2 — Reference-fetch inventory (THE load-bearing step, CF-23 from apps/web source)

Sources: `SignUpForm.tsx` (wizard `useEffect` fetch block `:198-210` + the dropdown render),
`OwnerSettings.tsx`, `UserProfile.tsx`, the auth hooks (`useGovernorates`, `useSectors`,
`useOwnerBusinessSectors`, `useAppointmentObjectives`), `auth.service.ts` reference fetchers.

### §2.A — DISPOSITION TABLE

| Category | Fetched? (source) | Used by | apps/api table? | Disposition |
|---|---|---|---|---|
| **governorates** | FETCH `getGovernorates()` (`useGovernorates`) | wizard + OwnerSettings + UserProfile | ✅ seeded (24) | **ENDPOINT** `GET /api/governorates` |
| **business_sectors (advertiser)** | FETCH `getBusinessSectors()` (`useSectors`) | wizard + OwnerSettings + UserProfile | ✅ seeded (audience=advertiser, 25) | **ENDPOINT** `GET /api/business-sectors?audience=advertiser` |
| **owner sectors** | FETCH `getOwnerBusinessSectors()` (`useOwnerBusinessSectors`) | wizard + OwnerSettings | ✅ = `business_sectors WHERE audience='owner'` (4) — the §5.3 collapse | **SAME ENDPOINT** `?audience=owner` |
| **company_size_options** | FETCH `getCompanySizeOptions()` (advertiser path only, **no FE fallback** `SignUpForm:1138`) | wizard (advertiser) | ❌ **NO TABLE** | **GAP → §2.C (lean OUT)** |
| **support_objectives_*** | FETCH `getAppointmentObjectives()` (`useAppointmentObjectives`) | **OwnerNavigation support modal** (NOT signup/profile); has a **local fallback** | ❌ no table | **OUT** (not a signup/profile form; FE falls back) |
| **predefined_zones** | NOT fetched by signup/profile (`ownerZones` is a hardcoded const `SignUpForm:82`; zone is free text — Commit-4 finding) | campaign wizard (later slice) | ✅ seeded (8) but unused here | **OUT** (campaign slice) |
| ownerZones / tunisianCities / parcCountOptions / screenOptions / SCREEN_COUNT/PARC_SIZE_OPTIONS | **HARDCODED** consts | wizard + owner forms | — | **NO ENDPOINT** (frontend constants) |
| profile_type / business_type values | HARDCODED enums | wizard | — | **NO ENDPOINT** |

### §2.B — business_sectors audience design (D2)
The FE makes **two separate fetches**: `getBusinessSectors` (advertiser list) and
`getOwnerBusinessSectors` (owner list). Legacy `getBusinessSectors` was advertiser-only (the legacy
`business_sectors` held only advertiser rows; owner rows lived in the now-collapsed
`owner_business_sectors`). Post-collapse our `business_sectors` holds **both** audiences, so the
endpoint **takes `?audience=advertiser|owner`** and filters — this is how the Phase-1c audience
discriminator finally gets consumed. **At 1f:** `useSectors`→`?audience=advertiser`,
`useOwnerBusinessSectors`→`?audience=owner` (the §5.3 repoint). Design: optional `?audience` (zod
enum); filter when present, return all 29 when omitted; **always include the `audience` field** in the
response (self-describing; allows client-filter too). Invalid `audience` value → 400.

### §2.C — THE GAP: company_size_options (CF-22 — surface, don't guess/build)
The advertiser wizard fetches `getCompanySizeOptions()` with **no frontend fallback** (owners use the
hardcoded `parcCountOptions`). But (i) apps/api has **no `company_size_options` table**, and (ii)
`company_size` is a **collect-and-ignore owner-extra** (Commit 2 — not stored). Building a
table+seed+endpoint to populate a dropdown for a field we don't persist is the WiFi-trap analog.
**Lean: OUT.** Resolution at 1f: the advertiser company-size dropdown hardcodes its options (a
frontend constant, exactly like the owner `parcCountOptions`), OR the table+endpoint is built with the
future slice that actually **stores** `company_size`. **Decision needed:** OUT (hardcode/defer) — or
seed a `company_size_options` table + endpoint now? *Lean OUT.*

### §2.D — Response shapes (fields the FE consumes; drop what it doesn't)
- **governorates**: `[{ id, name }]` ordered by `name` (matches `getGovernorates` order). FE keys
  option value=`id`, label=`name`. (Drop `createdAt`.)
- **business_sectors**: `[{ id, name, audience, display_order }]` ordered by `display_order` (asc,
  nulls last — matches `getBusinessSectors`). FE keys value=`id`, label=`name`. (Drop `createdAt`.)
  Owner shape from `getOwnerBusinessSectors` is `{ id, name, display_order }` — a subset, satisfied.

### §2.E — predefined_zones confirmed OUT
No signup/profile form fetches it (zone is free text; `ownerZones` hardcoded). Campaign-slice concern.

### §2.F — Public-access confirmation
No reference category needs gating — all are public catalog data the pre-auth wizard reads. The routes
register with **no `requireAuth`** preHandler. (CF-22 watch: none of the disposed categories are
sensitive.)

## §3 — Commit factoring (single commit)

| File | Change |
|---|---|
| `apps/api/src/routes/reference.ts` | **new** — `GET /api/governorates`, `GET /api/business-sectors` (public, `?audience` filter) |
| `apps/api/src/routes/index.ts` | register `referenceRoutes` (no preHandler — public) |
| `apps/api/tests/reference.test.ts` | **new** — integration (seeded tables): shape, counts, audience filter, public-access |

No schema/migration/dep/env change.

## §4 — Per-commit verification gates

- **apps/api typecheck/lint** clean; **build** ok.
- **apps/api tests 140 → ~146** (ratchet; §11 locks). Cases:
  1. `GET /api/governorates` → 200, **24** rows, shape `{id,name}`, **no cookie** (public).
  2. `GET /api/business-sectors` (no param) → 200, **29** rows, shape `{id,name,audience,display_order}`.
  3. `?audience=advertiser` → 200, **25** rows, all `audience==='advertiser'`.
  4. `?audience=owner` → 200, **4** rows, all `audience==='owner'`.
  5. `?audience=bogus` → 400 INVALID_INPUT.
  6. public-access: both succeed with NO session cookie (the pre-auth signup requirement) — explicit.
- **Root vs `a63b50d`:** typecheck 51 / lint 1 / apps/web 160 / build 139.80 unchanged (backend-only).
- **Live (real Postgres, seeded):** counts match the seed (gov 24, sectors 29 = 25+4).

## §5 — Standing operating procedure
Node-20 prefix; full env block for tsx/test; CF-7 push; CI headSha verify; fix-forward if red.

## §6 — Hard-halt conditions
- §2.C company_size_options ruling not given → halt (gates the endpoint set).
- A disposed-as-fetched category turns out hardcoded (or vice versa) on closer read → halt.
- Any gate regresses vs `a63b50d`.
- predefined_zones found fetched by a signup/profile form → halt (re-rule).

## §7 — Risk register
| Risk | Surfacing |
|---|---|
| company_size_options gap | §2.C — surfaced for ruling; lean OUT |
| advertiser list shows owner sectors if 1f forgets `?audience` | endpoint supports the filter; the §2.B note flags the 1f repoint (useSectors→?audience=advertiser) |
| route-path mismatch with the 1f FE expectation | paths `/api/governorates`, `/api/business-sectors` match the contract §6 (owner_business_sectors→business_sectors?audience=owner) |

## §8 — Cross-references
Survey §2.2/§3 (reference-GET gap) / §8. Contract §3.1/§3.7/§5.3 (owner_business_sectors collapse) /
§6 (Phase-1e repoint items). Audit §14 (Phase-1c seeds; zone-free-text). Memory
[[model-1-abandoned-option-b]].

## §9 — Carry-forward methodology
CF-23 (fetched-vs-hardcoded verified from source — the company_size gap + the predefined_zones
exclusion are the worked catches). CF-24 (build to the FE's actual fetch shape; the audience filter is
the §5.3 discriminator consumed). CF-22 (the company_size gap surfaced, not built). New-feature test
ratchet.

## §10 — Push policy + sequencing
Plan (3.0): CF-6, push immediately. Impl (3.1): CF-7 gate-sweep, CF-9 pause, push, CI watch. No
visual-QA (backend-only). No deps/schema/env → confirm untouched.

## §11 — Exact file contents (pending §2.C ruling on company_size_options)

**`apps/api/src/routes/reference.ts`** (new):
```ts
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { businessSectors, governorates } from '../db/schema.js';

// Public reference-data reads (no requireAuth): the signup wizard fetches these before any session
// exists, and they are non-sensitive public catalog data. Seeded tables → JSON, shaped to what the
// frontend consumes (CF-24).
const audienceQuerySchema = z.object({ audience: z.enum(['advertiser', 'owner']).optional() });

export const referenceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/governorates', async (_request, reply) => {
    const rows = await db
      .select({ id: governorates.id, name: governorates.name })
      .from(governorates)
      .orderBy(asc(governorates.name));
    return reply.status(200).send(rows);
  });

  app.get('/api/business-sectors', async (request, reply) => {
    const parsed = audienceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'audience must be advertiser or owner',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const { audience } = parsed.data;
    const base = db
      .select({
        id: businessSectors.id,
        name: businessSectors.name,
        audience: businessSectors.audience,
        display_order: businessSectors.displayOrder,
      })
      .from(businessSectors);
    const rows = await (audience ? base.where(eq(businessSectors.audience, audience)) : base).orderBy(
      asc(businessSectors.displayOrder),
    );
    return reply.status(200).send(rows);
  });
};
```
*(Note: `.where(...).orderBy(...)` vs `.orderBy(...)` on the drizzle builder — finalize the exact
chaining at impl so the conditional `where` typechecks; behavior as above.)*

**`routes/index.ts`**: `import { referenceRoutes } from './reference.js';` + `await
app.register(referenceRoutes);` (no preHandler).

**`apps/api/tests/reference.test.ts`** (new): the §4 cases, real Postgres, `buildApp` +
`app.register(apiRoutes)` (no auth helpers needed — public). Exact count locked at impl.

**company_size_options:** per §2.C ruling — if OUT (lean), nothing built; if IN, add a seeded table +
migration 0007 + endpoint (re-scopes this commit).

## §12 — Fire instruction
Ratify §2.C (company_size_options OUT vs seed-now) — then I finalize §11 and implement 3.1.

---

**HALT — CF-9.** Disposition table (§2.A): **2 endpoints** (`GET /api/governorates`,
`GET /api/business-sectors?audience=`), serving 3 fetched categories (governorates + advertiser
sectors + owner sectors via the audience filter — the §5.3 discriminator consumed). **OUT:**
support_objectives (not signup/profile + FE fallback), predefined_zones (campaign slice, zone is free
text), all the hardcoded consts. **1 gap to ratify (§2.C):** `company_size_options` is fetched
(advertiser path, no FE fallback) but has **no apps/api table** and its field is collect-and-ignore —
lean **OUT** (hardcode at 1f / defer to the storing slice), or seed a table now? Public-access
confirmed (no gating). No predefined_zones fetch found in signup/profile. Await the §2.C ruling before
§11 + code.
