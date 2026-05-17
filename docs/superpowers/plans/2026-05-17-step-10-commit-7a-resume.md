# Step 10 — Commit 7a resumption brief

> **Purpose:** hand a fresh session everything it needs to execute **Commit 7a**
> (campaign creation flow) of Step 10 without re-discovery. Step 10 introduces
> `@tanstack/react-query` as the server-state layer for `apps/web` (roadmap #6,
> audit §3 "No server-state layer"). Master plan:
> `docs/superpowers/plans/2026-05-17-step-10-react-query.md`. This brief is the
> sibling of `2026-05-17-step-10-commit-5b-resume.md` (same shape, which worked).

---

## §0 — Resumption pointer

- **Baseline commit:** `6aad21c` (Commit 6c) — on `origin/main`, pushed.
- **Gate baselines:** typecheck **51** · lint **353 (339e/14w)** · test **140 /
  18 suites / 0** · build main `index-*.js` gzip **139.40 kB** · file count
  **212** `.ts`/`.tsx` under `apps/web/src/` · **working tree clean**.
- **NewCampaign chunk:** baseline gzip **26.04 kB**. 7a touches `NewCampaign`
  directly — a chunk move > ±0.5 kB from 26.04 is a one-time chunk-baseline
  shift (Commit-1 main-bundle precedent): **surface, do not auto-halt**.
- **Node:** `.nvmrc` pins `20.20.2`. Every gate/commit shell must
  `export NVM_DIR="$HOME/.nvm"; \. "$NVM_DIR/nvm.sh"; export PATH="$NVM_DIR/versions/node/v20.20.2/bin:$PATH"`
  first (dev shell defaults to Node 24, which pnpm `engines` rejects).
- Cold session also reads `docs/audit.md` §2–§5, the Step-8 plan skeleton
  (`2026-05-15-step-8-plan.md`), the CF-1…CF-12 notes
  (`2026-05-15-step-8-notes.md`), and the Step-10 master plan. This brief adds
  the Step-10-specific in-flight state those documents do not carry.

---

## §1 — Step 10 execution state to date

| Commit | Hash | Descriptor |
| ------ | ---- | ---------- |
| Plan doc | `d06afc0` | `2026-05-17-step-10-react-query.md` |
| 1 | `577ca38` | React Query install + `QueryClient` + provider + dev devtools |
| 2 | `ed441d6` | `features/advertiser/` reads → `useQuery`; MyClients CRUD; `advertiserKeys` |
| 2b | `4493536` | `UserProfile`; `useProfileMutations`; `features/auth/hooks/` (`authKeys`, `useSectors`, `useGovernorates`) |
| 3 | `e57c4ba` | `features/events/` reads; `eventsKeys` |
| 4 | `ddfa09e` | `features/wallet/`; `walletKeys` |
| 5a | `0e14a13` | screenhost screens domain; `features/screens/hooks/` |
| 5b | `ea68b62` | screenhost financial views; `useBusinessProfile`, `performancesKeys`, `useRevenue` |
| 5c1 | `b28a645` | OwnerSettings + OwnerNavigation; `useOwnerProfileMutations`, `useOwnerBusinessSectors`, `useAppointmentObjectives` |
| 5c2 | `bad14ca` | MyAccount + OwnerCampaigns; `features/screenhost/hooks/` (`screenhostKeys`, `useOwnerCampaignsOverview`) |
| 6a | `46f51eb` | admin money/approval; `features/admin/hooks/` (`adminKeys`); **CF-14** |
| 6b | `b423af8` | admin users/admins |
| 6c | `6aad21c` | admin catalog/entities; `features/screens/hooks/usePredefinedZones` |

**10 code commits landed.** Screenhost and admin features are migration-complete.
**Remaining: 7a → 7b → 8 (bells) → 9 (audit refresh).**

**D-O note:** the original 8–12 commit estimate is decisively wrong (admin alone
3-way split, campaigns 2-way). Commit 9 audit refresh records the executed count.

---

## §2 — Locked decisions D1–D6 (verbatim — do not re-litigate)

**D1** — Auth and admin Zustand stores stay entirely in Zustand. No partial
migration of server-state slices into React Query.

**D2** — Cart Zustand store (`features/campaigns/stores/cart.store.ts`) stays in
Zustand. Pure client state. **Directly relevant to 7a** — CartPage and the
NewCampaign wizard's cart interactions stay Zustand; only *server* reads/writes
migrate.

**D3** — Step 10 creates NO new service abstractions. Wrap existing services in
`useQuery`/`useMutation`; wrap direct-Supabase calls in inline React Query
fetchers. The D5 notification-bell consolidation is the one scoped exception.

**D4** — Migration wraps current data-access paths; it does not restructure
them. Every existing service call site stays, just wrapped.

**D5** — The two notification bells consolidate inside Step 10 (Commit 8) as a
scoped exception to D3 — one `useQuery` + one `useMutation` per bell, the
mutation with `onMutate`/`onError` rollback. Fixes the mark-read staleness bug.

**D6** — Step 10 is NOT a folder restructure. New code lands in the feature
folder that **owns the service** — regardless of which feature contains the
consumer.

**Escape hatch:** if an inventory reveals D1–D6 cannot hold without producing
nonsense, surface as a "scope decision needed" — do not silently expand/contract.

---

## §3 — CF-13 amendments in force

CF-13: per-feature query-key factory — `features/<feature>/hooks/queryKeys.ts`
exports `<feature>Keys`; hierarchical readonly tuples `['<feature>','<view>',
...args]`; `<feature>Keys.all` is the prefix.

- **First amendment:** bundle `useMutation` hooks by **mutationFn identity**,
  not handler identity. N handlers calling the same service method with
  different args = **one** `useMutation` whose argument is the patch.
- **Second amendment:** feature hooks AND the `queryKeys` factory are created by
  the commit that migrates the **first consumer**. The hook lives under the
  feature that **owns the service** (D6). **7a applies this twice:** it creates
  `campaignsKeys` + `features/campaigns/hooks/` (first campaigns consumer), and
  it adds an active-zones read hook to `features/screens/hooks/usePredefinedZones.ts`
  (the factory accessor `screensKeys.predefinedZones()` was already defined by
  6c — this is the first cross-commit factory→consumer handoff).

---

## §4 — Operational policies in force

- **Invalidate-and-refetch is the default mutation pattern.** Optimistic-update-
  with-rollback is reserved for the D5 bells (Commit 8). Hand-patched
  `setState`-after-write optimistic patches are **dropped**, not preserved.
- **Per-page mirror discrimination.** Only a page with **local-only
  (unpersisted) mutating handlers** keeps a local-state mirror seeded from the
  query via an effect (OwnerScreens / OwnerCampaigns precedent). A page whose
  handlers all persist reads straight from the query. Decide per page, document.
- **Latent-bug protocol.** Bugs found get a **LATENT BUG FLAGGED** section in the
  pause summary — described, **not fixed**, filed as a TBD. **The missing-
  persistence cluster is CLOSED:** decisively OwnerScreens-localized — 3
  instances (`handleStatusChange`, `updateScreenStatusInDatabase` stub,
  `checkExpiredUnavailability` trusting the stub). 5c1 + 6a + 6b + 6c (all
  write-bearing) returned 0 siblings. Not codebase culture. Expect 0 in 7a/7b.
- **CF-14 — cross-feature invalidation graph, with (a)/(b) session-scope
  discrimination.** Every `useMutation` enumerates every query key whose
  **user-visible displayed data changes** (not every key that could be stale).
  Classify each: **(a) within-session** — both keys live in one QueryClient,
  invalidation delivers behaviour; **(b) cross-session cross-role** — different
  users/sessions, the mutating session's `invalidateQueries` is a no-op against
  uncached keys, kept for intent + hybrid-session defence; actual freshness
  rides the consumer's `staleTime`. **7a is CF-14-heavy** — a campaign
  create/draft reaches admin monitoring, owner approvals, the advertiser
  dashboard, MyCampaigns. Enumerate granularly in the pause summary.
- **CF-16 — React Query consumer-side reference-identity discipline.** (a) hooks
  return raw query data (not `data ?? []`) when consumers depend on reference
  stability; (b) user-driven resets call the seeder directly with cached data,
  not `invalidate` (structural sharing may return the same reference); (c)
  mirror/derive effects guard `if (data)`. **NewCampaign is wizard-heavy** —
  derive-from-query / step-state / cart-state patterns; apply CF-16.
- **CF-5-extended — typecheck drift.** Self-introduced transients (orphaned
  imports after removing an effect) are fix-inline-no-protocol. Incidental drift
  from real work requires: surface, justify, **stash-diff verify** the count is
  honest (`git stash` → typecheck → compare per-file). Removed-error masking via
  wider types is a regression even if the count looks flat.
- **CF-9 pause summary.** Numbered spot-check bullets + explicit receipt-
  confirmation request naming the final line.
- **CF-6/CF-7 two-tier push.** Doc commits (this brief, audit refresh) commit →
  push immediately. Code commits commit → four gates → CF-9 pause (local hash
  only) → user "go" → push.
- **`--no-verify`** authorized per-commit when `lint-staged` flags pre-existing
  `jsx-a11y` errors on inherited large files and workspace `pnpm lint` is green.
  Document the tripping file. NOT for engine errors — `nvm use 20.20.2` instead.

---

## §5 — Deferred audit-refresh corrections list (Commit 9 target)

**The list stands at 19 items.** Commit 9 applies them all in one pass. Stated
explicitly so off-by-one bookkeeping does not recur.

1. `audit.md` §5 row 10 ☐ → ☑ + merge commit.
2. §2 Snapshot refresh — lint/file-count/main-bundle gzip/per-chunk deltas.
3. §3 "No server-state layer" → §4 "Already resolved" as the Step 10 row.
4. §4 add the Step 10 row.
5. D-M revision recorded (16–26 → 40–55 → executed count).
6. Commit-5 skip + renumbering finding.
7. CF-14 first worked example (6a `approveRecharge`).
8. CF-13 second amendment — formal §8 carry-forward.
9. D-SPLIT projection vs actual — master plan §5 commit-factoring revised to the
   executed count (admin 3-way, campaigns 2-way; 8–12 estimate wrong).
10. Step 10 optimistic-update policy — invalidate-and-refetch default.
11. **TBD-O** — `OwnerScreens` missing-persistence bug, **bounded scope**: the 3
    known instances only (`handleStatusChange`, `updateScreenStatusInDatabase`
    stub, `checkExpiredUnavailability`). Cluster CLOSED — NOT a screenhost-wide
    or codebase-wide audit. Phase-1-prep candidate.
12. CF-5-extended — transient-vs-incidental typecheck-drift sub-clarification.
13. **TBD-P** — consolidate advertiser `useUserProfile` + owner
    `useBusinessProfile` onto one auth-owned hook (Phase 1).
14. **TBD-Q** — `OwnerDashboard._alerts` dead state (set, never rendered).
15. **TBD-R** — simulated revenue data in `revenueService.getRevenueByPeriod`
    (`Math.random()`) / `getRevenueStats` (hardcoded `growthRate` 12.5).
    **Elevated severity** — production data-integrity issue; architect-level
    surface to CEO/CTO at Commit 9, dedicated issue, not buried.
16. **CF-16** — React Query consumer-side reference-identity discipline (three
    worked examples: 5a / 5c1 / 5c2). Promote formally at Commit 9 §8.
17. **CF-14 cross-session scope refinement** — add (a)/(b) classification to the
    invalidation-graph discipline. Worked example: 6a `approveRecharge`
    (1×(a), 2×(b)).
18. **D1 cross-session firewall property** — D1's keep-auth-in-Zustand rule
    incidentally removes a class of (b)-class cross-session invalidations from
    Step 10's scope (user-visible auth state flows through the auth store, not
    query invalidation). Commit 9 §8 sub-note.
19. **Step 10 incidental warning cleanup** — `react-hooks/exhaustive-deps`
    warnings 18 → 14 (−4) across the chain via deletion of non-compliant
    `useEffect` data-fetchers. Positive side effect of the migration pattern;
    Commit 9 §8.

---

## §6 — Phase 1 input digest (accumulated)

- **Missing-persistence cluster — CLOSED, bounded.** 3 instances, all
  OwnerScreens. Phase 1's optimistic-write audit scope: fix those 3 under the new
  backend's API shape. NOT a screenhost-wide / admin-wide / codebase-wide audit.
- **Cross-session freshness gap.** CF-14 (b)-class invalidations are no-ops
  cross-session; admin→advertiser data changes propagate only via the
  consumer's `staleTime` (30s, D-Q). Phase 1 must decide a real cross-session
  channel: push (websockets/SSE), realtime subscriptions, aggressive staleTime
  tuning, or polling for sensitive paths (wallet balance). **CEO/CTO-relevant —
  escalate with TBD-R at Commit 9.**
- **D1 cross-session firewall.** Auth-store-resident state propagates via
  auth-store mechanisms, not query invalidation. Phase 1's realtime layer needs
  to consider two channels: React Query refetch for query-cache data, auth-store
  mechanisms for identity/session data.
- **Simulated revenue (TBD-R).** Screenhost financial dashboard shows
  `Math.random()`-based figures. Production data-integrity issue.
- **Hand-patched-`setState` density.** ~5+ pages wrote local state after a
  service call instead of refetching; Step 10 removed it from persistent paths.
- **Migration seam established.** Screenhost (~6 hook files) and admin
  (`features/admin/hooks/` — 6 files) route their entire server-state surface
  through hook files. Post-Step-10 the ~100+ direct-Supabase call sites
  concentrate into ~30–50 hook files — Phase 1's actual rewrite surface.
- **Open Phase 1 questions:** ORM (Drizzle/Prisma/Kysely), API shape
  (REST/tRPC/GraphQL), auth (better-auth), hosting, migration shape
  (strangler vs cutover), Phase 0 data-extraction status. The write-API should
  make missing-persistence impossible — typed `Result<Persisted, PersistError>`
  returns. Worth confirming: why the original developer distrusted refetches.

---

## §7 — Commit 7a inventory (complete — verified against `6aad21c`)

**D-SPLIT locked 2-way.** 7a = creation flow; 7b = list/detail/approvals.

**7a files:** `NewCampaign` (1623) + `new-campaign/Step5` (351) + `CartPage`
(527) ≈ 2 500 lines. The other step components (`Step1NameType` 147, `Step2`
282, `Step3` 236, `Step4` 506, `Step6` 453, `PostCartStep` 187) are **pure
presentational** — zero `Service.`/`supabase` surface — not migration targets.

**NewCampaign data surface (server reads — migration targets):**
- `predefinedZonesService.getAll` — active zones. **→ the 6c zone-key
  prerequisite.** Use `screensKeys.predefinedZones()`; see §8.
- `screensService.getUnavailabilityPeriods`
- `campaignScreensService.getLocationsByIds` / `getScreenIdsByLocationIds`
- `authService.getOwnerBusinessSectors` (reuse `useOwnerBusinessSectors`, 5c1)
- `balanceService.checkCampaignBalance`
- `supabase.auth.getUser` (1 — imperative, likely leave inline)
- **15 `useEffect`** — *mostly wizard-state syncs* (D2-adjacent client state per
  master plan §10.7). Only the genuine server fetches above migrate. The wizard
  already has a hook layer (`features/campaigns/hooks/new-campaign/` —
  `useCampaignWizard`, `wizard-*`). Do NOT migrate wizard client-state effects.

**NewCampaign writes:** `campaignService.saveCampaignDraft` + grep `writes=3`
(verify each at write-time per the OwnerCampaigns `URLSearchParams.delete`
false-positive precedent).

**Step5 (351):** `videoUploadService` — `createVideoEntry`,
`updateVideoDurationSeconds`, `uploadVideo`. The wizard's video-upload step →
`useMutation`(s). `video-upload.service` is `features/campaigns/services/`-owned.

**CartPage (527):** `eventsService.getFeaturedEvents` (**reuse
`useFeaturedEvents`** — Commit 3 / `advertiserKeys` — verify which feature owns
it at write-time), `campaignService.injectCampaignPublicationSchedule`,
`balanceService.checkCampaignBalance`; `writes=2`. The D2 cart Zustand store
stays — only server reads/writes migrate.

**Distinct-shape estimate (7a):** ~4–6 query hooks + ~4–7 mutationFns. The wizard
math / Step5 video-duration logic may yield pure-transform extractions
(testable per D-T option A).

**Not in 7a:** `MyCampaigns`, `CampaignDetails`, `OwnerCampaignApprovals` (7b);
the deferred-consumer rewires of `OwnerDashboard` / `OwnerCampaigns` (7b).

---

## §8 — Commit 7a operational locks

- **`campaignsKeys` factory** — created here: `features/campaigns/hooks/
  queryKeys.ts` exports `campaignsKeys` (CF-13). `features/campaigns/hooks/`
  becomes the campaigns hook home. (Note: `features/campaigns/hooks/new-campaign/`
  already exists — wizard client-state hooks; the new `queryKeys.ts` +
  React Query hooks sit alongside it.)

- **Zone-key prerequisite — DEFAULT to a single hook.** `screensService` (per
  the user) exposes `getAllZones()` (active-only — NewCampaign's read) and
  `getAllForAdmin()` (all zones incl. inactive — GeographicZonesManagement's
  read). **Recommended:** one `usePredefinedZones()` hook keyed
  `screensKeys.predefinedZones()`, queryFn calling the broader admin-shape read;
  NewCampaign filters to active at render. One cache entry serves both
  consumers; aligns with D4; render-time active-filtering is cheap. The hook
  lives in `features/screens/hooks/usePredefinedZones.ts` (6c already created
  this file with `useAdminZones`/`useZoneMutations` — add the consolidated
  read or adjust). **If at write-time the two consumers genuinely need
  different read shapes** (admin returns extra fields NewCampaign lacks type
  access to; or server-side active filtering is required) — surface; two hooks
  becomes the right call. Default to one.

- **CF-14 (a)/(b) per mutation.** 7a is invalidation-heavy. `saveCampaignDraft`
  / campaign-create: (a) the advertiser's own MyCampaigns list +
  `advertiserKeys.dashboardStats` (campaign count feeds the dashboard); (b)
  admin `adminKeys.monitoringCampaigns`, owner `screenhostKeys.campaignsOverview`
  + owner approvals — cross-session. Step5 video mutations: likely (a) intra +
  (b) admin `adminKeys.videos` (the admin VideoManagement list) — cross-session.
  Enumerate granularly in the pause summary; classify each key (a)/(b).

- **D2 boundary.** The cart Zustand store is NOT migrated. Verify campaign
  `useQuery` refetches do not implicitly depend on cart state (§9 R-6 of the
  master plan) — campaign queries key off `userId`, not cart contents.

- **Per-page mirror discrimination.** NewCampaign — evaluate at write-time;
  the wizard `formData`/cart are client state seeded from queries via derive
  effects (not mirrors). CartPage — likely pure-query.

- **CF-16.** NewCampaign wizard has derive-from-query / step-state patterns —
  apply reference-identity discipline; hooks feeding derive effects return raw
  data.

---

## §9 — Verification gates at Commit 7a close

- typecheck **51** — must stay flat. Transients fixed in-flight; genuine
  incidental drift → CF-5-extended (stash-diff verify).
- lint **353** — transient `import-x/order` spike ≤ +5 pre-autofix is routine;
  post-autofix must be 353 (or lower if incidental `exhaustive-deps` cleanup
  surfaces — surface, propose new baseline). No new `exhaustive-deps`.
- test **140 + ~4–8** (`campaignsKeys` factory tests + any wizard/Step5
  pure-transform extractions).
- build main `index-*.js` gzip **139.40 ± 0.5 kB**; per-chunk ± 0.5 kB.
- **NewCampaign chunk** — baseline **26.04 kB**. 7a touches NewCampaign
  directly; a move > ±0.5 kB is a one-time chunk-baseline shift — **surface, do
  not auto-halt** (Commit-1 main-bundle precedent).
- file count **212 + N** (new `campaignsKeys` factory + test + ~4–6 hook files).
- `--no-verify` likely required (inherited `jsx-a11y` on NewCampaign /
  CartPage) — document the tripping file.

---

## §10 — Resumption protocol

The fresh session, on reading this file as part of context reload:

1. **Phase 1 — context reload.** Read this brief + `docs/audit.md` §2–§5 + the
   Step-8 plan/notes + the Step-10 master plan. Produce a "current state"
   summary: latest commit `6aad21c`, clean tree, gate baselines verified
   (51/353/140/139.40 kB/212), D1–D6 + CF amendments in force, the 19-item
   deferred list count, the 7a inventory restated. Produce an explicit
   acknowledgement — **"I have read the 7a resumption brief; my understanding
   of Commit 7a is: [...]"**. Pause for "go".
2. **Phase 2 — no separate verification step.** Unlike 5b (which needed the
   advertiser-XOR-owner invariant verified), 7a's only pre-execution decision
   is the zone-key hook shape (§8) — and it has a locked default (single hook).
   The session integrates that default unless the 7a inventory surfaces a
   concrete reason against it (see §8), in which case it surfaces and pauses.
3. **Phase 3 — execute 7a** per §7 inventory + §8 operational locks: re-grep to
   verify the writes (false-positive discipline), create `campaignsKeys` +
   `features/campaigns/hooks/`, integrate the zone-key hook, migrate NewCampaign
   server reads + `saveCampaignDraft`, Step5 video mutations, CartPage. Run the
   §9 gates. Deliver a CF-9 pause summary (numbered spot-check bullets + receipt
   confirmation). Hold the code commit local until "go", then push (CF-6/CF-7).
4. **After 7a lands:** 7b (MyCampaigns + CampaignDetails + OwnerCampaignApprovals
   + the deferred-consumer rewires) can fire in the same session or a third —
   decide at the 7a pause.

This file is a doc commit — committed and pushed immediately per CF-6.
