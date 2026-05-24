# Phase 1c Commit 4 — section-scoped profile-edit endpoints (PATCH /api/profile/{contact,address,notifications}) + schema-touch 0005

The remaining three section-edit endpoints, mechanically identical to Commit 3's `PATCH
/api/profile/business`: session-guarded (reuse `requireAuth`), partial-PATCH, per-section zod,
frontend wire field names accepted directly (CF-24), update the **authenticated user's own** row,
unknowns stripped (zod `.strip` default). Schema-touch (migration 0005): ADD two columns —
`fonction` (text) and `zone` (text). The load-bearing plan-write item — `zone`'s nature — is
**RESOLVED to free text** from frontend source (§2.1).

Second commit designed against the frontend contract (`frontend-backend-contract.md` §3.9). Wire
names match the frontend exactly, so Phase-1e is a near-pure repoint with no field-naming adapter.

---

## §0 — Pre-flight verification

**Working tree.** Branch `main`, clean. HEAD `a821789` (Commit 3 — session-guard + profile/business).
CI-green. Floor: apps/api **69** / root **229**; root typecheck 51 / lint 1 / build 139.80; apps/api
typecheck 0 / lint 0 / build ok.

**CF-18 sweep (verified).** No `fonction` and no `zone` column/reference anywhere in `apps/api/src`
(`grep` clean). No `0005` migration. `routes/profile.ts` exists (Commit 3) and is registered in
`routes/index.ts` — the three new endpoints **extend** it (§2.6), so no `index.ts` change. Reference
tables `governorates` (24 seed) + `predefined_zones` (8 seed) present from Commit 1.

**Node 20 PATH prefix** on every gate + git command; `NODE_OPTIONS=--max-old-space-size=4096` on
commit. apps/api suite is **serialized** (vitest `fileParallelism:false`, Commit 3) — the new
profile suites inherit it; do NOT re-enable parallelism.

---

## §1 — Locked constraints (architect)

1. **Three endpoints, Commit-3 shape.** Each: `{ preHandler: requireAuth }`, partial zod (all
   optional, ≥1 required, empty body → 400), updates `request.user.id`'s own row (never a body/path
   userId), maps snake_case wire → drizzle camelCase, returns the touched columns.
2. **`PATCH /api/profile/contact`** — `contact_name`, `contact_phone`, `fonction` (ADD column).
3. **`PATCH /api/profile/address`** — `street_address`, `city`, `postal_code`, `governorate_id`
   (FK→`governorates`, exists from Commit 1), `zone` (ADD column, **text** per §2.1).
4. **`PATCH /api/profile/notifications`** — the three `notify_*` booleans (columns shipped Commit 3;
   **no schema change** for notifications).
5. **Schema-touch (0005):** ADD `fonction` (text), ADD `zone` (text). Nothing else. Clean ADD COLUMN
   only — no rename this commit (Commit 3's rename hazard does not recur).
6. **B policy / CF-24** — accept the frontend's exact wire field names (columns match). Class-(b)
   security holds: no privilege fields (`role`/`status` NOT in any schema; admin-controlled, Phase 1f).
7. **Deferred owner-extras stay `.strip()`'d, NO columns added:** `number_of_screens`,
   `number_of_rooms`, `company_size`, `formule`, `bank_*`, fleet establishments. (Finding §2.5: the
   three Commit-4 sub-forms send **only** their section's fields — nothing extra to strip in practice;
   `.strip()` is defensive.)

**Out of scope:** document upload `/api/profile/documents` (Commit 5); owner-extras COLUMNS;
sign-in/session creation (Phase 1d); the `signup.ts` `tax_number` required→optional reversal
(Phase-1e signup-grows — the *schema* is already nullable, only the signup-route zod enforces
required); frontend (Phase 1e); `audit.md` refresh (Commit 6).

---

## §2 — Inventory & CF-23 verification (verified against installed `apps/web` source)

### §2.1 — THE LOAD-BEARING ONE: `zone` is FREE TEXT, not an FK ✅

`apps/web/src/features/screenhost/pages/OwnerSettings.tsx:1128-1145` — the address sub-form's `zone`
field is a plain text input, verbatim:

```tsx
<label ... htmlFor="zone">Zone / secteur</label>   {/* NOT required-marked */}
<input
  type="text"
  value={adresseForm.zone}
  onChange={(e) => setAdresseForm((p) => ({ ...p, zone: e.target.value }))}
  className={inputClass}
  placeholder="Zone géographique ou secteur"
  id="zone"
/>
```

Bound to `p.zone ?? ''` on load (`:222`) and sent as `zone: adresseForm.zone?.trim() || null`
(`handleSaveAdresse`, `:325`). It is **not** a `<select>` over `predefined_zones` — that reference
table is consumed only by the **campaign** wizard's zone-targeting
(`features/screens/hooks/usePredefinedZones.ts`, `predefined-zones.service.ts`), never by the owner
address sub-form. **Resolution: `zone` is a free-text column (`text`), no FK, no pre-check, no
`predefined_zones` reference.** The hard-halt condition ("zone's nature can't be determined") does
not fire.

### §2.2 — Wire field names per sub-form (CF-23, from the handlers + service types)

The three handlers route through `authService.updateProfile` / `updateBusinessProfile`
(`auth.service.ts:820`, `:734`); the patch keys are the wire field names.

| Endpoint | Sub-form (handler) | Wire fields sent (verbatim) |
| --- | --- | --- |
| `/api/profile/contact` | responsable (`handleSaveResponsable`, `:243`) | `contact_name` (composed `last_name`+`first_name`, `:250`), `contact_phone`, `fonction` (`\|\| null`, `:257`) |
| `/api/profile/address` | adresse (`handleSaveAdresse`, `:308`) | `street_address`, `city`, `postal_code`, `governorate_id` (`\|\| null`), `zone` (`?.trim() \|\| null`) |
| `/api/profile/notifications` | notifications (`handleSaveNotifications`, `:334`) | `notify_news_updates`, `notify_reminders_events`, `notify_promotions_offers` (all boolean) |

Every column already maps to a drizzle camelCase property (schema.ts): `contactName`, `contactPhone`,
`streetAddress`, `city`, `postalCode`, `governorateId`, `notifyNewsUpdates`, `notifyRemindersEvents`,
`notifyPromotionsOffers`. The two new columns are `fonction` + `zone`.

### §2.3 — `fonction` column (§2-item 4): text, no FE maxlength

The `fonction` input (`OwnerSettings.tsx:710-720`) has **no `maxLength`**. `handleSaveResponsable`
does **not** validate `fonction` (only `last_name` + `contact_phone` are required, `:245`) — it is
sent as `responsableForm.fonction || null`, i.e. **nullable** (user can clear it). Column:
`fonction: text('fonction')` (nullable). zod: `z.string().max(100).nullable().optional()` — the
`max(100)` is a backend-added defensive bound (class-a; FE imposes none), `.nullable()` because the
field is clearable. **Micro-decision M5.**

### §2.4 — `zone` column: text, no FE maxlength

Per §2.1: `zone: text('zone')` (nullable). zod: `z.string().max(100).nullable().optional()` (same
defensive-cap + clearable reasoning as `fonction`). **Micro-decision M6.**

### §2.5 — Strip-lists: the three sub-forms are CLEAN (finding)

Unlike `/business` (whose entreprise handler sends `number_of_screens`/`number_of_rooms`/
`company_size` that Commit 3 strips), the **responsable**, **adresse**, and **notifications**
handlers each send **only** their section's fields (verified §2.2). So in practice there are **no
deferred extras to strip** for these three endpoints. zod `.strip()` (default) is retained as
defense (e.g. a future broadened `updateProfile` payload, or a stray `role`/`status`). **No
`.passthrough`, no explicit `.strip()` call needed — zod object default strips unknowns.**

### §2.6 — Route-file recommendation: ONE file (extend `profile.ts`)

Recommend the three endpoints land in the existing `routes/profile.ts` alongside `/business`. They
are the same concept (authenticated section-scoped profile edits), share every import + pattern, and
the file lands ~280-300 lines — under the 400-line CLAUDE.md ceiling. Splitting into four files
fragments a cohesive module for no gain. `routes/index.ts` already registers `profileRoutes` — no
change there. **Micro-decision M8.**

### §2.7 — `contact_phone` validation (micro-decision M2 — surface)

`/business` reused the signup `validateTaxNumber`; the analog here is `validatePhone`
(`validation/phone.ts`, E.164 `^\+[1-9]\d{1,14}$` — legacy `valid_phone` CHECK parity). **But** the
owner-settings phone input sends the **raw** value (no `normalizePhone` in `handleSaveResponsable`,
unlike signup `:279`); the placeholder shows spaces (`"+216 52 44 1144"`). A spaced value fails
strict E.164.

*Recommend:* reuse `validatePhone` (integrity parity with signup + the legacy DB CHECK; phone format
is a class-(b)/integrity concern). Flag for Phase 1e: the owner-settings form must adopt
`normalizePhone` before the repoint (it already exists in the FE), else clean inputs only.

### §2.8 — `postal_code` validation (micro-decision M3 — surface)

The `postal_code` column carries a DB CHECK `^\d{4}$` (schema.ts:98, from Commit 1). The owner form
input allows `maxLength={10}` with no pattern (`OwnerSettings.tsx:1115-1125`) — a >4-digit value
would violate the CHECK and surface as a **500** via the error-handler. *Recommend:* zod
`z.string().regex(/^\d{4}$/)` so a bad postal code is a clean **400 INVALID_INPUT** (mirrors the
Commit-3 Q3 "pre-check → 4xx, never let the DB constraint 500" philosophy). Integrity wins (Tunisia
postal codes are 4 digits; matches signup `pattern="\d{4}"`).

### §2.9 — `governorate_id`: non-nullable uuid + FK pre-check (micro-decision M4)

`governorate_id` is a **required** field in the adresse form (`handleSaveAdresse` returns early on
`!adresseForm.governorate_id`, `:314`), so the handler's `|| null` is **dead in the valid flow** —
null is never actually sent. Treat it like `/business`'s `business_sector_id`: `z.uuid().optional()`
(non-nullable; absent in a partial PATCH is fine, but when present must be a valid uuid). **FK
pre-check** against `governorates` → clean 400 if unknown (the Commit-3 Q3 pattern, `profile.ts:52`).
`ON DELETE SET NULL` already governs the FK (schema.ts:72) — no migration change.

### §2.10 — `contact_name` (maps to better-auth's logical `name`)

`contact_name` → `contactName` column, which is better-auth's mapped `name` field
(`user.fields.name='contactName'`, Commit 3 §2.1). Updating the column directly via `db.update` is
safe — better-auth reads `name` from the column on each `getSession` (no cache); `/business` already
updates sibling columns directly. zod: `z.string().min(1).max(100).optional()` (matches signup
`name(1-100)`). Column stays `.notNull()` — a partial PATCH either supplies a non-empty value or
omits it.

### §2.11 — migration 0005: clean ADD COLUMN (item 5)

Two additive columns; `drizzle-kit generate` emits two unambiguous `ADD COLUMN` statements (no rename
detection, so no interactive prompt — the Commit-3 hazard does not recur). Generated file renamed to
the descriptive tag, journal `tag` + `0005_snapshot.json` updated (Commit-1/3 convention). **Hard-halt
if generate emits anything but two `ADD COLUMN`s** (no DROP, no rename, no side-effect on the
`name`→`contact_name` column or the CHECKs).

### §2.12 — CF-22 watch

- M2 (contact_phone strict E.164 vs raw FE input) and M3 (postal_code 4-digit zod vs FE maxLength 10)
  are the two genuine FE-divergence micro-decisions; both lean integrity/class-(b), surfaced for
  ratification rather than silently chosen.
- No new env vars → no CF-21 cascade (env.ts untouched). No new deps → lockfile untouched.
- CF-23 note (watch-item, non-blocking): the FE uses **one** service method (`updateProfile`) for
  **both** the responsable (`/contact`) AND notifications (`/notifications`) sections (plus
  `logo_url`, `registration_doc`). The backend splits these into section endpoints; the Phase-1e
  repoint must route `updateProfile` calls to the correct endpoint by which fields are present.

---

## §3 — Commit factoring

| Commit | Scope |
| --- | --- |
| **4.0** | Plan (this file). Halt; surface M1–M9; ratify; commit + push (CF-6). |
| **4.1** | `profile.ts` (+3 endpoints) + `schema.ts` (fonction, zone) + `0005` migration + tests (`profile.test.ts` +3 describe blocks, `db.test.ts` +column checks). Halt; CF-9 (incl. live: 0005 applies, three endpoints' auth/partial/strip/FK-miss behaviors); ratify; push (CF-7). |

4.1 judgment seams: the M2/M3/M4 validation calls (phone/postal/governorate-FK). The rest is
mechanical replication of the `/business` handler.

---

## §4 — Per-commit verification gates

### Gate 2 — apps/api per-package
```
pnpm --filter @toodooh/api typecheck   # 0
pnpm --filter @toodooh/api lint        # 0
pnpm --filter @toodooh/api test        # ~85-88 (needs Postgres)
pnpm --filter @toodooh/api build       # ok
```

### Gate 3 — root no-regression vs `a821789`
| Gate | Floor | Expected |
| --- | --- | --- |
| typecheck | 51 | **51** |
| lint | 1 | **1** |
| test | 229 | **~245-248** (+~16-19) |
| build (apps/web gzip) | 139.80 | **139.80 ±0.5** |

### Gate 4 — live (real Postgres, fresh volume)
- 0005 applies; **all 6 migrations clean** on a fresh volume; `fonction` + `zone` present (both
  `text`, nullable); no DROP/rename side-effect (the `contact_name` column + CHECKs intact).
- `/api/profile/contact`: authed PATCH updates `contact_name`/`contact_phone`/`fonction`; partial
  touches only supplied; `fonction:null` clears; bad phone → 400; unauth → 401; empty → 400.
- `/api/profile/address`: authed PATCH updates the five fields; partial; `zone:null` clears; bad
  `postal_code` → 400; unknown `governorate_id` → 400 (FK pre-check); valid `governorate_id` stored;
  unauth → 401; empty → 400.
- `/api/profile/notifications`: authed PATCH toggles the three booleans; partial; unauth → 401;
  empty → 400.
- Deferred extras / `role`/`status` in any body → ignored (stripped), not stored.

### Gate 5 — CI green (Postgres service; no new service — MinIO unaffected).

---

## §5 — Standing operating procedure
CF-6 for 4.0; CF-7 for 4.1. Node-20 prefix; heap bump. CF-18 re-sweep before first Write.
**No new deps expected** — verify `pnpm-lock.yaml` untouched at 4.1; if untouched, not in the commit.

---

## §6 — Hard-halt conditions
1. `zone`'s nature unresolvable — **RESOLVED §2.1** (free text; no halt).
2. 0005 emits anything but two clean `ADD COLUMN`s (DROP/rename/side-effect) — STOP, hand-correct.
3. Frontend wire field names unrecoverable — **RESOLVED §2.2** (no halt).
4. Any gate regresses vs `a821789`.

---

## §7 — Risk register
| Risk | Likelihood | Surface | Mitigation |
| --- | --- | --- | --- |
| drizzle-kit emits drop/rename instead of ADD COLUMN | Low | 4.1 generate / 0005 review | inspect SQL before commit; hand-author the two ADD COLUMNs if needed (snapshot is end-state-correct) |
| FE raw phone (spaces) fails strict E.164 | Medium | Gate 4 / M2 | reuse `validatePhone`; flag FE `normalizePhone`-at-repoint for Phase 1e |
| postal_code >4 digits → DB CHECK 500 | Medium | Gate 4 / M3 | zod `^\d{4}$` → clean 400 |
| governorate_id FK miss → 500 | Low | Gate 4 | pre-check → 400 (Commit-3 Q3 pattern) |
| profile.ts grows unwieldy | Low | typecheck/review | ~290 lines, under 400; one cohesive module (§2.6) |

---

## §8 — Cross-references
- `routes/profile.ts` (Commit 3 — the `/business` template + `requireAuth` + FK-pre-check pattern),
  `middleware/require-auth.ts`, `validation/phone.ts` (`validatePhone`), `db/schema.ts`
  (`users` + `governorates`), `tests/profile.test.ts` + `tests/db.test.ts` (test templates).
- `frontend-backend-contract.md` §3.9 (the 7 owner sub-forms), §7.1 (Option B), §7.4 (CF-24).
- `apps/web/.../OwnerSettings.tsx` (sub-form handlers), `.../useOwnerProfileMutations.ts`,
  `.../auth.service.ts` (`updateProfile`/`updateBusinessProfile` patch types).
- `supabase-schema-inventory.md` §2.2 (notify_* defaults, phone/postal CHECK precedent). Prior `a821789`.

---

## §9 — Carry-forward methodology
- **CF-9** — 4.1 pause: full file contents + Gate-4 live behaviors (0005 applies; three endpoints'
  auth/partial/strip/FK-miss/format-400) + count reconciliation (predicted vs actual).
- **CF-10** floor re-confirmed (§0). **CF-18** swept (§0, §2.11) — clean.
- **CF-22** — M2/M3 FE-divergence micro-decisions + the one-service-two-sections CF-23 watch surfaced.
- **CF-23** — `zone` type, wire field names, strip-lists, fonction/zone maxlength all verified against
  installed `apps/web` source at plan-write; the live PATCH round-trips are the execution-time layer.
- **CF-24** — second endpoint set built to the contract: wire names match the frontend (no Phase-1e
  adapter for these sections). The contract drove the accept-lists and the `zone`=text resolution.

---

## §10 — Push policy + sequencing
**4.0** — `git add` plan; `docs(phase-1c): plan Commit 4 — profile contact/address/notifications`;
push; `gh run watch` (CF-6). Node 20.
**4.1** — `git add apps/api`; `feat(api): PATCH /api/profile/{contact,address,notifications} +
fonction/zone columns (0005)`; push; `gh run watch` (CF-7). Node 20. No `Co-Authored-By`.
**Verify `pnpm-lock.yaml` untouched** (no new deps); if untouched it's not in the commit.

---

## §11 — Exact file contents (Commit 4.1)

### `apps/api/src/routes/profile.ts` (extend — full file)
```ts
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { businessSectors, governorates, users } from '../db/schema.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validatePhone } from '../validation/phone.js';
import { validateTaxNumber } from '../validation/tax-number.js';

// Section-scoped partial update of the authenticated user's business fields. All fields
// optional; at least one required (empty PATCH → 400). Deferred owner-extras
// (number_of_screens/number_of_rooms/company_size) are stripped by zod (.strip default) —
// the frontend sends them; we ignore, not error. role/status are NOT in this schema
// (admin-controlled, Phase 1f).
const businessPatchSchema = z
  .object({
    business_name: z.string().min(1).max(200).optional(),
    // nullable: an owner can clear a matricule they don't have (audit §7.2); the
    // refine validates only non-null values (.nullable() short-circuits on null).
    tax_number: z
      .string()
      .refine(validateTaxNumber, 'Invalid tax number format')
      .nullable()
      .optional(),
    business_sector_id: z.uuid().optional(),
    business_type: z.enum(['local', 'national', 'agency', 'event_organizer']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Responsable sub-form (frontend-backend-contract §3.9). contact_name maps to better-auth's
// logical `name` (column contact_name); fonction is nullable (the FE sends `|| null`, no
// maxlength) — capped defensively. contact_phone reuses the signup E.164 validator (§2.7).
const contactPatchSchema = z
  .object({
    contact_name: z.string().min(1).max(100).optional(),
    contact_phone: z
      .string()
      .refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)')
      .optional(),
    fonction: z.string().max(100).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Adresse sub-form. postal_code mirrors the DB CHECK (^\d{4}$) for a clean 400 (§2.8);
// governorate_id is FK-pre-checked (§2.9); zone is free text, nullable (§2.1, §2.4).
const addressPatchSchema = z
  .object({
    street_address: z.string().min(1).max(300).optional(),
    city: z.string().min(1).max(100).optional(),
    postal_code: z.string().regex(/^\d{4}$/, 'Postal code must be 4 digits').optional(),
    governorate_id: z.uuid().optional(),
    zone: z.string().max(100).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

// Notifications sub-form — the three notify_* booleans (columns shipped Commit 3).
const notificationsPatchSchema = z
  .object({
    notify_news_updates: z.boolean().optional(),
    notify_reminders_events: z.boolean().optional(),
    notify_promotions_offers: z.boolean().optional(),
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
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;

    // Q3: pre-check the FK so a bad business_sector_id is a clean 400, not a DB FK
    // error surfacing as a 500 (mirrors signup's tax_number pre-check).
    if (data.business_sector_id !== undefined) {
      const [sector] = await db
        .select({ id: businessSectors.id })
        .from(businessSectors)
        .where(eq(businessSectors.id, data.business_sector_id))
        .limit(1);
      if (!sector) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'business_sector_id', reason: 'unknown business sector' }],
        });
      }
    }

    // Map snake_case wire → drizzle camelCase columns (only supplied keys).
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.business_name !== undefined) patch.businessName = data.business_name;
    if (data.tax_number !== undefined) patch.taxNumber = data.tax_number;
    if (data.business_sector_id !== undefined) patch.businessSectorId = data.business_sector_id;
    if (data.business_type !== undefined) patch.businessType = data.business_type;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      businessName: updated?.businessName ?? null,
      taxNumber: updated?.taxNumber ?? null,
      businessSectorId: updated?.businessSectorId ?? null,
      businessType: updated?.businessType ?? null,
    });
  });

  app.patch('/api/profile/contact', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = contactPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.contact_name !== undefined) patch.contactName = data.contact_name;
    if (data.contact_phone !== undefined) patch.contactPhone = data.contact_phone;
    if (data.fonction !== undefined) patch.fonction = data.fonction;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      contactName: updated?.contactName ?? null,
      contactPhone: updated?.contactPhone ?? null,
      fonction: updated?.fonction ?? null,
    });
  });

  app.patch('/api/profile/address', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = addressPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;

    // FK pre-check → clean 400 (Commit-3 Q3 pattern); governorate_id is required-when-present.
    if (data.governorate_id !== undefined) {
      const [gov] = await db
        .select({ id: governorates.id })
        .from(governorates)
        .where(eq(governorates.id, data.governorate_id))
        .limit(1);
      if (!gov) {
        return reply.status(400).send({
          error: 'INVALID_INPUT',
          message: 'Validation failed',
          fields: [{ field: 'governorate_id', reason: 'unknown governorate' }],
        });
      }
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.street_address !== undefined) patch.streetAddress = data.street_address;
    if (data.city !== undefined) patch.city = data.city;
    if (data.postal_code !== undefined) patch.postalCode = data.postal_code;
    if (data.governorate_id !== undefined) patch.governorateId = data.governorate_id;
    if (data.zone !== undefined) patch.zone = data.zone;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      streetAddress: updated?.streetAddress ?? null,
      city: updated?.city ?? null,
      postalCode: updated?.postalCode ?? null,
      governorateId: updated?.governorateId ?? null,
      zone: updated?.zone ?? null,
    });
  });

  app.patch('/api/profile/notifications', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = notificationsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }

    const userId = request.user?.id;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'UNAUTHENTICATED', message: 'Authentication required.' });
    }

    const data = parsed.data;
    const patch: Partial<typeof users.$inferInsert> = {};
    if (data.notify_news_updates !== undefined) patch.notifyNewsUpdates = data.notify_news_updates;
    if (data.notify_reminders_events !== undefined)
      patch.notifyRemindersEvents = data.notify_reminders_events;
    if (data.notify_promotions_offers !== undefined)
      patch.notifyPromotionsOffers = data.notify_promotions_offers;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return reply.status(200).send({
      notifyNewsUpdates: updated?.notifyNewsUpdates ?? null,
      notifyRemindersEvents: updated?.notifyRemindersEvents ?? null,
      notifyPromotionsOffers: updated?.notifyPromotionsOffers ?? null,
    });
  });
};
```
> **NOTE (4.1):** the four handlers share a verbatim 400/401 prologue. At 4.1 I will either keep it
> inline (as above, matching the Commit-3 style exactly) **or** extract a tiny local
> `parseOrReply(schema, request, reply)` helper if lint/readability favors it — a mechanical
> deviation surfaced in the CF-9, not a scope change. Final typing locked at 4.1.

### `apps/api/src/db/schema.ts` — diffs
- **fonction** (contact attribute) — add after `contactPhone` (`:55`):
  ```ts
  fonction: text('fonction'), // responsable role/title (owner contact sub-form); nullable
  ```
- **zone** (address attribute) — add after `governorateId` (`:74`):
  ```ts
  // free-text zone/secteur (owner address sub-form) — NOT a predefined_zones FK (CF-23 §2.1)
  zone: text('zone'),
  ```
  (Column position is cosmetic; drizzle generate emits ADD COLUMN regardless.)

### `apps/api/drizzle/0005_profile_fonction_zone_columns.sql` (drizzle-kit generate; verify clean)
```sql
ALTER TABLE "users" ADD COLUMN "fonction" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "zone" text;
```
Plus `meta/_journal.json` entry (idx 5, tag `0005_profile_fonction_zone_columns`) +
`meta/0005_snapshot.json` (both written by generate; the file is renamed from drizzle's random tag).

### Tests
- `apps/api/tests/profile.test.ts` (extend): three new `describe` blocks mirroring `/business`:
  - **`PATCH /api/profile/contact`**: authed→updates `contact_name`/`contact_phone`/`fonction`;
    partial (only supplied changes); `fonction:null` clears; bad phone (`"12 34"`) → 400; unauth →
    401; empty → 400. (~6)
  - **`PATCH /api/profile/address`**: authed→updates the five fields; partial; `zone:null` clears;
    bad `postal_code` (`"12345"`) → 400; unknown `governorate_id` → 400 (FK); valid `governorate_id`
    (seeded, via `db.select(...).from(governorates).limit(1)`) → stored; unauth → 401; empty → 400.
    (~8)
  - **`PATCH /api/profile/notifications`**: authed→toggles the three booleans; partial; unauth →
    401; empty → 400. (~5)
  - Reuse the existing `mockSession` + `resetAuthTables` helpers; the suite stays serialized.
- `apps/api/tests/db.test.ts` (modify): extend the schema-column test to assert `users.fonction` and
  `users.zone` are defined. (~+0-1; folded into an existing `it`)

**Test delta: apps/api 69 → ~85-88 (+~16-19).** Exact split + final count locked at 4.1 and
reconciled in the CF-9 (predicted-vs-actual).

---

## §12 — Fire instruction

This is **Commit 4.0** (plan). Architect: ratify M1–M9; on approval, commit + push docs-only.
**Halt** until then.

**Micro-decisions to ratify:**
- **M1 — `zone` = free text** (`text` column, no FK, no `predefined_zones` reference). Verbatim
  source: `OwnerSettings.tsx:1135` plain `<input type="text">`, sent `zone?.trim() || null`. **THE
  load-bearing resolution.** *Recommend: text column.*
- **M2 — `contact_phone`** reuses `validatePhone` (E.164), integrity parity with signup + legacy
  CHECK; FE sends raw/un-normalized → Phase-1e must `normalizePhone` at repoint. *Recommend:
  validatePhone.*
- **M3 — `postal_code`** zod `^\d{4}$` → clean 400 (mirrors the DB CHECK; FE input allows maxLength
  10 — integrity wins). *Recommend: regex in zod.*
- **M4 — `governorate_id`** `z.uuid().optional()` (non-nullable; required-when-present) + FK
  pre-check → 400 (Commit-3 Q3). *Recommend.*
- **M5 — `fonction`** `text` column (nullable); zod `z.string().max(100).nullable().optional()`
  (FE has no maxlength; cap is defensive). *Recommend.*
- **M6 — `zone`** zod `z.string().max(100).nullable().optional()` (clearable; defensive cap).
  *Recommend.*
- **M7 — `contact_name`** `z.string().min(1).max(100).optional()` (matches signup `name`); direct
  drizzle update of better-auth's mapped column is safe. *Recommend.*
- **M8 — one route file** (extend `profile.ts`; ~290 lines, under 400). *Recommend.*
- **M9 — migration 0005** = two clean `ADD COLUMN`s (`fonction`, `zone`), tag
  `0005_profile_fonction_zone_columns`. Hard-halt if generate emits anything else. *Recommend.*

Plus acknowledge: strip-lists are empty in practice (the three sub-forms are clean, §2.5; `.strip()`
defensive); no new env vars / no new deps (lockfile untouched); count lift apps/api 69→~85-88 / root
229→~245-248; the CF-23 one-service-two-sections watch-item (§2.12). CF-22/23/24 in §9.
