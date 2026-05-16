# TBD-J — dead-code audit + deletion pass — discovery

_Discovery for follow-up issue #31 (dead-code audit pass), opened during Step 8._
_Date: 2026-05-16. Baseline commit: `b1f61a6` (post-AdminRoute security fix)._

This is the discovery commit. It sweeps every production `.ts`/`.tsx` under
`apps/web/src/` for zero-consumer files, classifies them, and produces the deletion
plan. **No files deleted in this commit** — deletion is the paired Commit 2, held
local until review.

## Baseline gates

| Gate | Value |
| ---- | ----- |
| `pnpm typecheck` | 58 errors |
| `pnpm lint` | 364 problems (346 errors, 18 warnings) |
| `pnpm test` | 8 suites, 98 tests, 0 failures |
| `pnpm build` | main gzip 131.46 kB |

## Sweep method

149 candidate files (all `.ts`/`.tsx` under `apps/web/src/` excluding `*.test.*`,
`lib/dooh/legacy/*`, `App.tsx`, `main.tsx`, `vite-env.d.ts`, `scripts/*`, `assets/*`).
For each, an anchored grep (CF-1) for `(from|import\()\s*['"][^'"]*/<basename>['"]`
across all `.ts`/`.tsx` — covering **both** static `from` and dynamic `import()`
forms — excluding self-references. A file with zero external import-path references
is dead. Transitive-dead checked by inspecting what the dead files themselves import.

---

## Section 1 — Confirmed dead files (production code)

| Path | Lines | Exports | Naming-shape | Confidence | Notes |
| ---- | ----- | ------- | ------------ | ---------- | ----- |
| `components/Modal.tsx` | 76 | `Modal` (default) | cross-cutting | high | **New find.** Generic modal component at `src/components/` root. Zero importers — superseded; the app uses `ModalContext`/inline modals + the admin-specific `AffluenceModal`. Was one of the 4 predicted "truly shared survivors" in the Step 8 plan §6 — that prediction was wrong (see §4). |
| `features/admin/components/AdminNavigation.tsx` | 233 | `AdminNavigation` (default) | admin | high | TBD-G. Dead admin nav component, superseded by inline nav in `AdminLayout`. |
| `features/advertiser/services/clients.service.ts` | 62 | `clientsService`, `Client`, `CreateClientDTO` | advertiser | high | TBD-F. Dead service; `MyClients.tsx` calls Supabase directly instead. See §3. |
| `features/screenhost/components/DetailedRevenue.tsx` | 307 | `DetailedRevenue` (default) | screenhost | high | TBD-I. Dead revenue-detail component. (The `handleViewDetailedRevenue` handler in `OwnerDashboard.tsx` is a coincidental substring match, NOT an import.) |
| `features/screenhost/components/RevenueCharts.tsx` | 315 | `RevenueCharts` (default), `RevenueChartsProps` | screenhost | high | **New find.** Dead owner-revenue charts component. Zero importers — `OwnerRevenue` renders its charts by some other path. |
| `features/screenhost/components/UnavailabilityCalendar.tsx` | 239 | `UnavailabilityCalendar` (default) | screenhost | high | TBD-H. Dead component. |
| `features/screens/services/locations.service.ts` | 153 | `locationsService`, `Location`/affluence types re-exported | screens | high | TBD-E. Dead service; `OwnerLocations.tsx` uses `screensService` + direct Supabase instead. See §3. |

**Total: 7 confirmed dead production files, 1385 lines.**

All 7 are confidence **high** — the anchored grep covered both static and dynamic
import forms; none has any consumer. No category (b) "unbuilt scaffolding" — per the
Codex prep, all are category (a): old code superseded by a live replacement.

---

## Section 2 — Confirmed dead test files

**None.**

The 8 test suites (`lib/errors.test.ts`, `lib/dooh/hourly-plan.test.ts`,
`lib/dooh/legacy/dooh-calculation.service.test.ts`, `lib/dooh/v3-model.test.ts`,
`lib/logger.test.ts`, `features/campaigns/hooks/new-campaign/useCampaignWizard.test.ts`,
`lib/dooh/legacy/dooh-hourly-grid.test.ts`, `services/global-configuration.service.test.ts`)
all test live code. None of the 7 dead files has a test. No test deletes.

---

## Section 3 — Service-vs-page-bypass pairings

Two of the dead services match the TBD-E/F pattern: a dead service paired with a live
page that calls Supabase directly in its place.

| Dead service | Live page that bypasses it | Disposition |
| ------------ | -------------------------- | ----------- |
| `features/screens/services/locations.service.ts` | `features/screenhost/pages/OwnerLocations.tsx` | Delete the service only. `OwnerLocations` is live (uses `screensService` + direct Supabase) — stays. |
| `features/advertiser/services/clients.service.ts` | `features/advertiser/pages/MyClients.tsx` | Delete the service only. `MyClients` is live (calls Supabase directly) — stays. |

The pages staying with direct-Supabase calls is a known shape. It is a **Phase 1
concern**: when the new backend's typed client lands, those pages should route
through it; the dead services were the wrong shape against Supabase and are not worth
resurrecting. TBD-J deletes the dead services; it does not touch the pages.

**Downstream effect:** deleting `locations.service.ts` drops `features/screens/types/location.ts`
from 2 consumers to 1 (`campaign-screens.service.ts` remains). `types/location.ts`
stays alive — not a deletion.

---

## Section 4 — Surfaced but not a deletion

Three items surfaced during the sweep that are not dead-code findings:

1. **Kickoff claim "`MyCart.tsx` is a cart legacy branch" — file does not exist.**
   `MyCart.tsx` (261 lines) was already deleted in **audit Step 2a** (see audit §3
   "Duplicate pages"). `find . -name 'MyCart*'` returns nothing. The kickoff's
   "newly identified" framing is stale — it was identified and removed two steps ago.

2. **Kickoff claim "`cart.store.ts` is the orphaned legacy cart branch" — it is alive.**
   `features/campaigns/stores/cart.store.ts` has **5 consumers**:
   `AdvertiserLayout.tsx`, `useCampaignWizard.ts`, `CartSidebar.tsx`, `CartPage.tsx`,
   `NewCampaign.tsx`. It is the live cart store. Step 8 Commit 9 moved it into
   `features/campaigns/stores/` precisely because it is the live implementation.
   **`cart.store.ts` is NOT dead — it must NOT be deleted.** The kickoff's
   "two-implementation duplication, cart.store is the orphan" reading does not hold
   against the migration branch: there is one live cart (`cart.store` + `CartPage`),
   and the legacy `MyCart.tsx` it was duplicating is already gone (item 1).

3. **`Modal.tsx` was mis-predicted as a survivor.** Step 8 plan §6 predicted
   `components/` would retain 4 truly-shared files including `Modal.tsx`. The sweep
   shows `Modal.tsx` has zero consumers — it is dead, not shared. Post-deletion,
   `src/components/` retains **3** files: `AnimatedLogo.tsx`, `ContentErrorBoundary.tsx`,
   `PageLoadingFallback.tsx`. Minor correction; no action beyond noting it.

No transitive-dead found: the 7 dead files import only live shared modules
(`lib/logger`, `lib/supabase`, `admin.store`, `types/location`) — none is the sole
consumer of another candidate file.

---

## Section 5 — Deletion plan

**7 files, 1385 lines, one atomic deletion commit.**

Deletion list (order is immaterial for an atomic commit; listed for diff review):

1. `apps/web/src/components/Modal.tsx`
2. `apps/web/src/features/admin/components/AdminNavigation.tsx`
3. `apps/web/src/features/advertiser/services/clients.service.ts`
4. `apps/web/src/features/screenhost/components/DetailedRevenue.tsx`
5. `apps/web/src/features/screenhost/components/RevenueCharts.tsx`
6. `apps/web/src/features/screenhost/components/UnavailabilityCalendar.tsx`
7. `apps/web/src/features/screens/services/locations.service.ts`

**Not deleted** (kickoff list, corrected): `MyCart.tsx` (already gone, Step 2a),
`cart.store.ts` (alive, 5 consumers).

**Predicted gate behavior post-deletion:**
- `typecheck` — unchanged at 58 (dead files contribute no errors; nothing imports them).
- `lint` — may drop a few problems; the 7 files carried their own lint surface
  (jsx-a11y on the 4 components especially). Direction: down. Exact delta reported
  in the deletion commit's pause summary.
- `test` — unchanged at 98/8/0 (no live test covers dead code).
- `build` — main bundle + chunks decrease. The 7 files total 1385 lines; tree-shaking
  already excludes zero-consumer files from the bundle, so the **build delta may be
  near-zero** (Vite/Rollup never bundled them). If the build does NOT shrink, that is
  expected, not a regression — surface it explicitly rather than treating it as a miss.
- File count: 164 → 157 `.ts`/`.tsx`.

**Issue closure:** the deletion commit closes #31 (TBD-J) and resolves the 5
sub-issues #26–#30 (TBD-E…I). The deletion commit body should reference all six.

---

## End-state of discovery commit

- This doc committed + pushed (doc commit per CF-6).
- Workspace untouched; gates flat at 58 / 364 / 98 / 131.46 kB.
- Decision pause for user review. On "go": the atomic deletion commit (Commit 2)
  removes the 7 files, runs the four gates, reports a CF-9 pause summary, holds
  local until a second "go" before push.
