# Phase 1f — Commit F1: reference-reads repoint

**Status:** DRAFT (F1.0) — held for architect review (not committed, not executed).
**Design authority:** `phase-1f-keystone-design.md` (§5 sequence, D8); the keystone `apiClient`.
**Region:** `apps/web`. **HEAD at draft:** `0c9826a` (K, CI-green).
**Backend:** GET `/api/governorates` + GET `/api/business-sectors?audience=` shipped in Phase-1e
Part-A Commit 3 (`30c28cf`, public, no auth).

The first per-flow repoint — the thin-adapter premise's first real test. Swap the three reference
reads off the deleted Supabase backend onto the public GET endpoints via the keystone `apiClient`,
internals-only.

---

## §0 — Pre-flight verification (run at execution start, CF-10)

- `git status` clean; HEAD `0c9826a`.
- Floor (the post-K floor): **apps/web typecheck 49 · lint 1 · test 183 (24 files) · build 139.41 kB
  gzip**. `apps/api` 146 (untouched). Re-run all four; record actuals.
- Node 20 PATH ([[node-20-required-for-commits]]).
- Confirm the endpoints exist + their shapes (`apps/api/src/routes/reference.ts`): `/api/governorates`
  → `[{id,name}]`; `/api/business-sectors?audience=advertiser|owner` → `[{id,name,audience,display_order}]`.

---

## §1 — Locked constraints (architect)

1. Three reads repoint to the existing endpoints; **no new backend**. advertiser→`?audience=advertiser`,
   owner→`?audience=owner` (the §5.3 collapse — one endpoint, two audiences).
2. **Internals-only**: preserve the public surface; consumers don't change. Surface any forced
   consumer change.
3. `apiClient` is the data source; these are **public GETs** (no session — the wizard fetches
   pre-auth).
4. **Error contract = match today's**: the methods THROW on failure today (`throw new
   Error(mapAuthError(...))`); the repoint throws `new Error(apiErrorMessage(...))` (the keystone
   pattern). React Query surfaces it as `query.error`, exactly as now.

---

## §2 — Inventory (THE load-bearing step, CF-23 from source)

### §2.A — The layering finding (CF-22 — surface + recommend)

The three hooks (`useGovernorates`, `useSectors`, `useOwnerBusinessSectors`) are **thin React Query
wrappers** whose `queryFn` calls an `authService` method — the **Supabase call lives in the
`authService` method, not the hook**. And **`SignUpForm.tsx:200–203` calls those same three methods
directly** (a `Promise.all` prefetch). So the faithful repoint lands at the **`authService` method
layer**, NOT literally "inside the hooks":

- **Recommended (L-method):** repoint the three method **bodies** (`getGovernorates`,
  `getBusinessSectors`, `getOwnerBusinessSectors`) → `apiClient`. The hooks are **untouched** (their
  `queryFn: authService.getX` still works), the method **signatures** are unchanged, and SignUpForm's
  direct calls repoint **transparently** (no SignUpForm edit). One small diff, every caller
  consistent, both the hook surface and the method signatures preserved — exactly the §1.2 intent via
  the correct layer.
- Rejected (L-hook): move the fetch into the hooks → orphans the three `authService` methods, which
  **`SignUpForm:200–203` still calls** → SignUpForm breaks (or needs a parallel edit). Two code
  paths, more churn.

**This is the one decision to ratify.** It honors "repoint the three reference reads, surface
preserved" (architect lock) at the layer the source dictates. Recommendation: **L-method.**

### §2.B — Per-method repoint table

| Method (`auth.service.ts`) | Current (Supabase) | Repoint (`apiClient`) | Return type | Shape match |
|---|---|---|---|---|
| `getGovernorates` (`:930`) | `supabase.from('governorates').select('*').order('name')` | `apiClient.get<Governorate[]>('/governorates')` | `Governorate[]` = `{id,name}` | endpoint returns `{id,name}` — **exact** |
| `getBusinessSectors` (`:857`) | `supabase.from('business_sectors').select('*').order('display_order')` | `apiClient.get<BusinessSector[]>('/business-sectors?audience=advertiser')` | `BusinessSector[]` = `{id,name,display_order?}` | endpoint returns `{id,name,audience,display_order}` — **superset** (extra `audience` ignored) |
| `getOwnerBusinessSectors` (`:866`) | `supabase.from('owner_business_sectors').select('business_sector_id,name,display_order')` + **map** `{business_sector_id→id}` | `apiClient.get<BusinessSector[]>('/business-sectors?audience=owner')` | `BusinessSector[]` | endpoint already returns `{id,name,…}` — **the map is deleted** |

### §2.C — Shape-match is TYPE-GUARANTEED (no dropped field possible)

The three methods are typed `Promise<Governorate[]>` / `Promise<BusinessSector[]>`. Consumers receive
those types via `useX().data` (or SignUpForm's typed state), so TypeScript **already** constrains
every consumer to `{id,name}` (governorates) / `{id,name,display_order?}` (sectors) — reading any
other field is a compile error, and typecheck is green (the 49 are react-leaflet/AdminActivity/
export.service, none about sectors/govs). The endpoints provide exactly these (supersets). **No
dropped-field risk** — verified by the type system + the endpoint source, not assumption. (Spot-check
confirmed: the only `.icon` reads in consumers are `step.icon`/`sub.icon` UI objects, unrelated.)

### §2.D — Consumers (UNTOUCHED in F1)

- `useGovernorates`: OwnerSettings, UserProfile, MyAccount.
- `useSectors`: OwnerSettings, MyAccount, OwnerDashboard, UserProfile.
- `useOwnerBusinessSectors`: OwnerSettings, NewCampaign.
- `SignUpForm.tsx:200–203`: direct `Promise.all` of all three (+`getCompanySizeOptions`).

None are edited (L-method). They render dropdowns from `{id,name}`; F1 makes those dropdowns fetch
real data. (These pages otherwise stay on Supabase for their non-reference data — later slices.)

### §2.E — What F1 does NOT touch (scope guard)

- **`getCompanySizeOptions`** (SignUpForm:202, `:881`) — **stays** (D8: hardcoded constant later, in
  F2). So SignUpForm's prefetch `Promise.all` still awaits F2 (its 4th call dies on Supabase); F1
  only repoints SignUpForm's three reference calls transparently — **SignUpForm is not "fixed" by
  F1**, it's fully repointed in F2.
- **`getSupportObjectives*` / `getAppointmentObjectives`** — stay on Supabase (D8, out of scope).
- **`performance.service.ts:449`** — the §5.3 **second** `owner_business_sectors` site (a direct
  Supabase read in a later-slice service). **OUT** of F1 (repoints with the performance slice).
  Recorded so the §5.3 collapse isn't assumed fully consumed at F1.
- `supabase.ts` stays; the other Supabase-using `authService` methods stay; `mapAuthError` stays
  (still used by the §2.E methods).

---

## §3 — Commit factoring

**Single commit (F1.1).** Three method-body rewrites + one new test file. Mechanical (deterministic
swap), one logical change.

---

## §4 — Per-commit verification gates

- `pnpm typecheck` — green; floor **≤ 49** (likely flat — the methods were already typed; no `any`
  leaves; no number pre-committed).
- `pnpm lint` — green; **1** (database.types floor).
- `pnpm test` — green; **183 + N** (the new reference test; deliberate ratchet).
- `pnpm build` — green; **≤ 139.41 kB** gzip main (may dip — three Supabase query builders leave the
  bundle).

---

## §5 — Standing operating procedure

Node-20 PATH on every gate + commit. Conventional Commits, no `Co-Authored-By` (rule 9). CF-7
gate-sweep before push. Husky lint-staged runs on staged files.

---

## §6 — Hard-halt conditions

- A consumer reads a field the new shape drops — **NOT possible per §2.C** (type-guaranteed); if
  somehow surfaced at execution, halt.
- The L-method layering (§2.A) is rejected by the architect → re-plan at the hook layer.
- Any gate regresses (typecheck > 49, test < 183, build > 139.41, lint > 1) → revert, surface.

---

## §7 — Risk register

- **Query-string in the path:** `apiClient.get('/business-sectors?audience=advertiser')` →
  `fetch('/api/business-sectors?audience=advertiser')`. Standard; the proxy forwards the query. Test
  asserts the exact path+query.
- **Extra `audience` field at runtime:** the endpoint returns `audience`; `BusinessSector` omits it.
  Harmless (excess property, not type-checked on a fetch cast); consumers don't read it.
- **`getOwnerBusinessSectors` map removal:** the old method renamed `business_sector_id→id`; the
  endpoint already returns `id`, so the map is deleted — the test asserts the returned shape is
  `{id,name,…}` directly.
- **Test import pulls in `supabase.ts`** (authService imports it for the deferred methods) → the
  missing `database.types` would fail at runtime. Mitigation: `vi.mock('@/lib/supabase', () => ({
  supabase: {} }))` in the test (the established pattern — `global-configuration.service.test.ts`).

---

## §8 — Cross-references

- Design: `phase-1f-keystone-design.md` §5 (sequence), D8 (orphan reads). Audit §16 (the Part-A
  reference endpoints). Contract §2 row 12 / §3.1 / §5.3 (the audience collapse).
- Backend: `apps/api/src/routes/reference.ts`. Client: `apps/web/src/lib/api-client.ts`.
- Audit row at F8: `audit.md` §17.

---

## §9 — Carry-forward methodology

- **CF-22** — §2.A: the architect said "repoint the hooks"; source shows the Supabase call lives in
  the `authService` methods the hooks wrap (+ SignUpForm calls them directly), so the faithful repoint
  is method-layer. Surfaced + recommended, not rescoped unilaterally.
- **CF-24** — truthful-to-frontend: shapes verified type-guaranteed against the endpoint source.
- **CF-23** — the thin-wrapper structure + the SignUpForm direct-call + the perf.service second site
  were read from source, not assumed.
- **Thin-adapter premise** — F1 is its first test: if a 3-method body swap with zero consumer edits
  holds, F2–F6 inherit the pattern. Note the outcome in the F1.1 CF-9.

---

## §10 — Push policy + sequencing

F1.0 plan → push immediately (CF-6, doc). F1.1 code → CF-7 gate-sweep → CF-9 pause → push on approval
→ CI headSha verify. No deps/backend/env changes. No visual-QA pause needed (no rendered change —
the dropdowns render the same `{id,name}`, now from the API).

---

## §11 — Exact rewrites (F1.1)

### §11.1 — `auth.service.ts` (three method bodies; signatures unchanged)

```ts
async getBusinessSectors(): Promise<BusinessSector[]> {
  try {
    return await apiClient.get<BusinessSector[]>('/business-sectors?audience=advertiser');
  } catch (error) {
    throw new Error(apiErrorMessage(error));
  }
},

async getOwnerBusinessSectors(): Promise<BusinessSector[]> {
  try {
    return await apiClient.get<BusinessSector[]>('/business-sectors?audience=owner');
  } catch (error) {
    throw new Error(apiErrorMessage(error));
  }
},

async getGovernorates(): Promise<Governorate[]> {
  try {
    return await apiClient.get<Governorate[]>('/governorates');
  } catch (error) {
    throw new Error(apiErrorMessage(error));
  }
},
```

`apiClient` + `apiErrorMessage` are already imported (keystone). `supabase`/`mapAuthError` stay
(other methods). No hook edits, no consumer edits, no SignUpForm edit.

### §11.2 — `features/auth/services/auth.service.reference.test.ts` (NEW, node-level, D10)

Mocks `apiClient.get` (ApiError kept real via `importActual`) + stubs `@/lib/supabase` (so importing
`authService` doesn't load the missing `database.types`). Asserts each method calls the right
path+param and returns the array, and that a failure throws a French message.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient } from '@/lib/api-client';

import { authService } from './auth.service';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/api-client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api-client')>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});

describe('authService reference reads (F1 repoint)', () => {
  beforeEach(() => vi.mocked(apiClient.get).mockReset());

  it('getGovernorates → GET /governorates', async () => {
    const rows = [{ id: 'g1', name: 'Tunis' }];
    vi.mocked(apiClient.get).mockResolvedValue(rows);
    await expect(authService.getGovernorates()).resolves.toEqual(rows);
    expect(apiClient.get).toHaveBeenCalledWith('/governorates');
  });

  it('getBusinessSectors → GET /business-sectors?audience=advertiser', async () => {
    const rows = [{ id: 's1', name: 'Retail', audience: 'advertiser', display_order: 1 }];
    vi.mocked(apiClient.get).mockResolvedValue(rows);
    await expect(authService.getBusinessSectors()).resolves.toEqual(rows);
    expect(apiClient.get).toHaveBeenCalledWith('/business-sectors?audience=advertiser');
  });

  it('getOwnerBusinessSectors → GET /business-sectors?audience=owner', async () => {
    const rows = [{ id: 's9', name: 'Café', audience: 'owner', display_order: 2 }];
    vi.mocked(apiClient.get).mockResolvedValue(rows);
    await expect(authService.getOwnerBusinessSectors()).resolves.toEqual(rows);
    expect(apiClient.get).toHaveBeenCalledWith('/business-sectors?audience=owner');
  });

  it('throws a French message on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      new ApiError({ status: 0, code: 'NETWORK', message: '' }),
    );
    await expect(authService.getGovernorates()).rejects.toThrow(/connexion/i);
  });
});
```

(The generic-mock `mockResolvedValue` typing may need a small `as` at execution; finalize then.)

### §11.3 — Optional manual smoke (NOT a gate)

Start `apps/api` (:4000, full env block) + `apps/web` (Vite proxy); open a page with a sector/
governorate dropdown (e.g. OwnerSettings) → confirm real reference data renders. The running-both
round-trip proper is deferred to phase close (D10); this is a quick confidence check if convenient.

---

## §12 — Fire instruction

After §2.A (L-method) ratification: execute §11, gate-sweep (§4), CF-9 pause, push on approval. Then
F2 (signup) is drafted.
