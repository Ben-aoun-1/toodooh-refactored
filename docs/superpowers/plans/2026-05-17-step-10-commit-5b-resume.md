# Step 10 — Commit 5b resumption brief

> **Purpose:** hand a fresh session everything it needs to execute **Commit 5b**
> (screenhost financial views) of Step 10 without re-discovery. Step 10
> introduces `@tanstack/react-query` as the server-state layer for `apps/web`
> (roadmap #6, audit §3 "No server-state layer"). The master plan is
> `docs/superpowers/plans/2026-05-17-step-10-react-query.md`.

---

## §0 — Resumption pointer

- **Baseline commit:** `0e14a13` (Commit 5a) — on `origin/main`, pushed.
- **Gate baselines:** typecheck **53** · lint **357 (339e/18w)** · test
  **124 / 15 suites / 0** · build main `index-*.js` gzip **139.16 kB** ·
  file count **188** `.ts`/`.tsx` under `apps/web/src/` · **working tree clean**.
- **Node:** `.nvmrc` pins `20.20.2`. Every shell that runs gates / commits
  must `nvm use 20.20.2` first (the dev shell defaults to Node 24, which
  pnpm's `engines` rejects). Pattern used all session:
  `export NVM_DIR="$HOME/.nvm"; \. "$NVM_DIR/nvm.sh"; export PATH="$NVM_DIR/versions/node/v20.20.2/bin:$PATH"`.
- This file **supplements** the master plan's Phase-1 context reload. A cold
  session should still read `docs/audit.md` §2/§3/§4/§5, the Step-8 plan
  skeleton (`2026-05-15-step-8-plan.md`), and the CF-1…CF-10/CF-12 notes
  (`2026-05-15-step-8-notes.md`). This file adds the Step-10-specific
  in-flight state those documents do not carry.

---

## §1 — Step 10 execution state to date

| Commit | Hash | Descriptor |
| ------ | ---- | ---------- |
| Plan doc | `d06afc0` | `2026-05-17-step-10-react-query.md` |
| 1 | `577ca38` | React Query install + `QueryClient` + `QueryClientProvider` + dev-only devtools |
| 2 | `ed441d6` | `features/advertiser/` — 5 read hooks → `useQuery`; MyClients CRUD → `useMutation`; `advertiserKeys` |
| 2b | `4493536` | `UserProfile.tsx` full data layer; `useProfileMutations`; `features/auth/hooks/` (`authKeys`, `useSectors`, `useGovernorates`) |
| 3 | `e57c4ba` | `features/events/` reads → `useQuery`; `eventsKeys` |
| 4 | `ddfa09e` | `features/wallet/` — `useWalletTransactions`, `useInvoices`, `useCreateRecharge`; `walletKeys` |
| 5a | `0e14a13` | screenhost screens domain (OwnerScreens, OwnerLocations, OwnerCalendarDevices, AddScreen, ScreenCalendar) + `features/screens/hooks/` (9 files) |

**D-O remaining order:** 5b → 5c → 6 (admin) → 7 (campaigns) → 8 (bell
consolidation) → 9 (audit refresh). (Screenhost split 5a/5b/5c was locked
under D-SPLIT.)

**D-M revised mid-execution:** original test-growth target 16–26 → revised
to **range 40–55, target ~50** once the per-feature pattern (4 tests per
`queryKeys.ts` factory + migration tests) was known. Current tally: **26**.

**Build:** Commit 1 added React Query core (+7.41 kB one-time, main gzip
131.47 → 138.88). Feature commits since are flat (±0.5 kB). Cumulative hard
ceiling **147.47 kB** (the D-B +16 kB absolute). Current 139.16 — ample headroom.

---

## §2 — Locked decisions D1–D6 (verbatim — do not re-litigate)

**D1** — Auth and admin Zustand stores stay entirely in Zustand. No partial
migration of server-state slices into React Query.

**D2** — Cart Zustand store (`features/campaigns/stores/cart.store.ts`) stays
in Zustand. Pure client state.

**D3** — Step 10 creates NO new service abstractions. Wrap existing services
in `useQuery`/`useMutation`; wrap direct-Supabase calls in inline React Query
fetchers. The D5 notification-bell consolidation is the one scoped exception.

**D4** — Migration wraps current data-access paths; it does not restructure
them. Every existing service call site stays, just wrapped.

**D5** — The notification bells consolidate inside Step 10 (Commit 8) as a
scoped exception to D3 — one `useQuery` + one `useMutation` per bell, the
mutation with `onMutate`/`onError` rollback. Fixes the mark-read staleness
bug. F-3 confirmed there are **two** bells (Advertiser + Owner), each its own
hook pair.

**D6** — Step 10 is NOT a folder restructure. Files stay where Step 8 put
them. New code lands in the feature folder that **owns** the service —
regardless of which feature contains the consumer.

**Escape hatch:** if an inventory reveals a situation where D1–D6 cannot hold
without producing nonsense, surface it as a "scope decision needed" — do not
silently expand or contract scope.

---

## §3 — CF-13 amendments in force

CF-13 (per-feature query-key factory: `features/<feature>/hooks/queryKeys.ts`
exports `<feature>Keys`; key values are hierarchical `['<feature>','<view>',
...args]` tuples; `<feature>Keys.all` is the prefix). Two amendments earned
during execution:

- **First amendment (Commit 2b):** bundle `useMutation` hooks by **mutationFn
  identity**, not handler identity. If N handlers call the same service method
  with different args, that is **one** `useMutation` whose argument is the
  patch — not N hooks. (2b: 8 UserProfile write handlers → 3 mutations.)
- **Second amendment (Commit 5-skip):** feature hooks AND the `queryKeys`
  factory are created by the commit that migrates the **first consumer**, not
  pre-staged speculatively. The hook lives under the feature that **owns the
  service** (D6), regardless of the consumer's feature. (Old "Commit 5" for
  page-less `performances`/`screens` was dropped — speculative hooks before
  consumers is the YAGNI failure mode.)

---

## §4 — Operational policies locked mid-execution

- **Invalidate-and-refetch is the default mutation pattern.** Optimistic-
  update-with-rollback is reserved for the D5 bell mark-read (a real
  user-visible staleness bug). Hand-patched `setState`-after-write optimistic
  patches are **dropped**, not preserved alongside the query cache.
- **Per-page mirror discrimination (OwnerScreens precedent).** Only a page
  with **local-only (unpersisted) handlers** keeps local state mirrors seeded
  from the query via an effect; a page whose handlers all persist reads
  straight from the query (no mirror). Decide per page at write time, document
  the choice. OwnerScreens keeps mirrors (handleStatusChange etc. are
  untouched local-only edits); OwnerCalendarDevices does not.
- **Latent-bug protocol.** Bugs found during migration get a **LATENT BUG
  FLAGGED** section in the pause summary (separate from SURPRISES and MINOR
  BEHAVIOR DELTAS) — described, **not fixed**, filed as a TBD. Migration
  commits do not carry functional fixes. (Reversed mid-5a: a local-only
  handler with no data-layer surface has nothing to migrate, so leaving it is
  coherent — it does not force a fix.)
- **Transient vs incidental typecheck drift.** Self-introduced transients
  during an edit (orphaned imports after removing an effect) are
  fix-inline-no-protocol — mention as "transient blip resolved in-flight."
  Incidental drift from real work (type narrowing/widening, code-path
  elimination) requires the **CF-5-extended protocol**: surface, justify why
  the change is required for the migration, stash-diff verify the count is
  honest. Removed-error masking via wider types is a regression even if the
  count looks flat.
- **CF-9 pause-summary truncation safeguards.** Numbered spot-check bullets +
  an explicit receipt-confirmation request naming the final line. (A line-wrap
  garble artifact was observed and deemed non-critical; the numbered-bullets
  safeguard catches real truncation.)
- **CF-6/CF-7 two-tier push.** Doc commits (plan, this brief, audit refresh)
  commit → push immediately. Code commits commit → four gates → CF-9 pause
  summary (local hash only) → user "go" → then push.
- **`--no-verify`** is authorized per-commit when `lint-staged` flags
  pre-existing `jsx-a11y` errors on an inherited large file (Step 11 / #9
  scope) and the authoritative workspace `pnpm lint` is green at 357. Document
  the tripping file in the commit body. NOT authorized for engine errors —
  `nvm use 20.20.2` instead.

---

## §5 — Deferred audit-refresh corrections list (Commit 9 target)

The Commit 9 audit refresh closes Step 10 and applies these accumulated
corrections in one pass (Step-8 precedent). Dedup applied — the prior running
list had "file TBD-O" and "widen TBD-O" as separate items; merged below.

1. `docs/audit.md` §5 row 10 ☐ → ☑ (Step 10 done) + merge commit.
2. §2 Snapshot refresh — lint, file count, main-bundle gzip (~+13 kB from
   React Query), per-chunk deltas.
3. §3 "No server-state layer" anti-pattern entry → moved to §4 "Already
   resolved" as the Step 10 row.
4. §4 add the Step 10 row (Step-8/9/TBD-C row format).
5. D-M revision recorded: 16–26 → 40–55, target ~50. Update master plan
   §2 D-M reference.
6. Commit 5 skip + renumbering finding (old Commit 5 for page-less
   performances/screens dropped; the 8–12 commit estimate was wrong against
   the actual code shape — record the executed count).
7. CF-14 (cross-feature invalidation-graph completeness rule) — first worked
   example expected at **Commit 6 (admin)**: recharge approval invalidates
   `walletKeys.transactions(advertiserUserId)` **and**
   `advertiserKeys.dashboardStats(advertiserUserId)`.
8. CF-13 second amendment — formal §8 carry-forward entry.
9. D-SPLIT projection vs actual — the plan's 8–12 estimate revised to the
   executed commit count; update master plan §5 commit-factoring table.
10. Step 10 optimistic-update policy — invalidate-and-refetch default,
    optimistic-with-rollback reserved for D5. Phase-1 revisit prep item.
11. **TBD-O** — `OwnerScreens` missing-persistence bug, **covering both**
    `handleStatusChange` (missing DB-update call) **and**
    `updateScreenStatusInDatabase` (deliberate no-op stub: `return true`
    body, underscore-prefixed params, name lies about persisting; the
    `checkExpiredUnavailability` interval trusts it). File at Commit 9 as a
    Phase-1-prep candidate.
12. CF-5-extended — the transient-vs-incidental typecheck-drift
    sub-clarification (see §4).

---

## §6 — Phase 1 input digest (accumulated)

To be handed to Phase 1 as a starting brief at Commit 9.

- **Hand-patched-`setState` pattern density.** ~5 screenhost screens pages
  wrote to local state after a service call instead of refetching. Step 10's
  invalidate migration removes it from persistent paths; local-only handlers
  remain hand-patched.
- **Missing-persistence latent-bug class.** 3 instances in `OwnerScreens`
  alone: `handleStatusChange` (missing call), `updateScreenStatusInDatabase`
  (deliberate no-op stub), `checkExpiredUnavailability` (trusts the stub).
  The stub is **more serious** than a missing call — it shipped a deliberate
  lie past review. Predict 2–4 more across screenhost; **financial-views
  pages (5b) are money-adjacent — siblings here are higher severity.**
- **Phase 1 architecture implications:**
  - The write-API shape should make missing-persistence **impossible** —
    typed returns (`Result<Persisted, PersistError>`), callers forced by the
    type system to handle the persistence outcome. Likely tRPC territory.
  - Storage operations span ~9 files with no service layer (TBD-K candidate).
  - The 100+ direct-Supabase call sites concentrate, post-Step-10, into
    ~30–50 hook files — that is Phase 1's actual rewrite surface.
- **Open Phase 1 architecture questions to marinate on:** ORM (Drizzle /
  Prisma / Kysely), API shape (REST / tRPC / GraphQL), auth (better-auth
  confirmation), hosting (VPS vs managed), migration shape (strangler vs
  cutover), Phase 0 data-extraction status.
- **Hypothesis worth confirming in Phase 1 archaeology:** the original
  developer distrusted refetches (latency? bad early Supabase experience?) —
  understand why before designing the new API's latency budget.

---

## §7 — Commit 5b inventory (complete — verified against `0e14a13`)

**Files (5): screenhost financial views.**

| File | Lines | Surface |
| ---- | ----- | ------- |
| `OwnerPerformance` | 932 | Read-only. `performanceService.getDataset` + a 5-table Supabase filter-context composite (`locations`, `screens`, `campaign_owner_approvals`, `campaign_locations`, `campaign_screens`). `performanceService.buildDefaultFilters` is a pure helper, not a fetch. No writes. |
| `OwnerRevenue` | 722 | `revenueService.getRevenueStats` + `getRevenueByPeriod('monthly')` composite read; a `getBusinessProfile` effect (deps `[user, loading]`) deriving bank-detail form state; `handleSaveBankDetails` — a `supabase.storage` upload + signed-URL + `.update` write. |
| `OwnerDashboard` | 1129 | Read-heavy composite: `getBusinessProfile`, `getBusinessSectors`, `screensService.getScreens`, `revenueService.getRevenueStats`, `authService.getCurrentUser`, `campaignOwnerApprovalService.getPendingCampaigns`. No writes. |
| `OwnerStatementDetailPage` | 249 | One `getBusinessProfile` in a nav-guard mount effect feeding `recipient`. Statement detail itself is from a **local data file** (`data/ownerStatementDetails.ts`). `exportService.exportOwnerStatementPdf` is imperative — leave. |
| `OwnerStatementsPage` | 202 | **No page-data-fetch surface.** Statement list is local data; the only `getBusinessProfile` call is imperative *inside* the PDF-download handler. **Recommended: not migrated** (imperative-leave). 5b is effectively 4 files. |

**Codex correction VERIFIED:** `OwnerDashboard` does **not** import
`performance.service` (grep-confirmed). `performance.service`'s only consumer
is `OwnerPerformance`.

**Cross-feature service ownership (D6):**
- `revenueService` lives in `features/wallet/services/` → revenue hooks go in
  `features/wallet/hooks/`, keyed `walletKeys`.
- `performance.service` lives in `features/performances/services/` →
  `features/performances/hooks/` (created here, first consumer), keyed
  `performancesKeys`.
- `screensService.getScreens` → reuse `features/screens/hooks/useScreens`
  (created in 5a). `OwnerDashboard` is its second consumer.
- `authService.getBusinessProfile` → new `features/auth/hooks/useBusinessProfile`
  (see §8).
- `campaignOwnerApprovalService` lives in `features/campaigns/services/` → its
  hook goes in `features/campaigns/hooks/`. `OwnerDashboard`'s
  `getPendingCampaigns` read is its first consumer — create
  `campaignsKeys` + the hook here, or (if it is the *only* owner-side
  campaign read) keep it inline and let Commit 7 (campaigns) own it. **Decide
  at write time per the just-in-time rule;** surface the choice.

**STILL TO VERIFY before writing `useBusinessProfile`** — the
advertiser-XOR-owner invariant. The claim "the advertiser `useUserProfile`
and the new owner `useBusinessProfile` never both run, so two cache entries
for one `business_profiles` row is harmless" rests on a user being advertiser
XOR owner. Confirm by reading `apps/web/src/App.tsx`: `AdvertiserRoute`
redirects owners away (`profileType === 'individual_owner' | 'fleet_owner'`
→ `/owner-dashboard`) and `OwnerRoute` redirects non-owners away — mutually
exclusive route guards. If confirmed, the invariant holds.

---

## §8 — Commit 5b operational locks

**`useBusinessProfile` placement (locked decision — Option 1).**
- Create `features/auth/hooks/useBusinessProfile.ts`, keyed
  `authKeys.profile(userId)`. Auth owns `auth.service`; this is the 2b
  precedent (auth-service cross-feature reads → `features/auth/hooks/`, like
  `useSectors`/`useGovernorates`).
- Add a `profile` accessor to `features/auth/hooks/queryKeys.ts`:
  `profile: (userId: string) => [...authKeys.all, 'profile', userId] as const`.
  It **takes `userId`** (per-user cache isolation) — matching
  `advertiserKeys.profile(userId)`, not the arg-less `sectors()`/
  `governorates()`. `getBusinessProfile()` itself is session-scoped (no arg);
  `userId` is keyed for isolation only.
- Hook shape: `useQuery({ queryKey: authKeys.profile(userId ?? ''), queryFn:
  () => authService.getBusinessProfile(), enabled: !!userId })`; return
  `{ profile: query.data ?? null, loading: query.isLoading, error: query.error }`.
  Return type `BusinessProfile | null` (the real `getBusinessProfile` return —
  do not widen to `any`).
- **Consumer scope:** the 4 owner pages adopt it (`OwnerRevenue`,
  `OwnerDashboard`, `OwnerStatementDetailPage`, and — only if migrated —
  `OwnerStatementsPage`; recommended not). **Do NOT touch Commit 2's
  advertiser `useUserProfile`** (`features/advertiser/hooks/`, keyed
  `advertiserKeys.profile`). The duplication (two hooks for one call) is
  intentional and contained per the XOR invariant.
- **File TBD-P at Commit 9:** consolidate the advertiser `useUserProfile` and
  the owner `useBusinessProfile` onto one auth-owned hook. Add to the §5
  deferred list when filed.

**Rest-of-5b scope:**
- `OwnerPerformance` — composite `useQuery` (`performancesKeys` +
  `usePerformanceDataset` or similar; the queryFn ports the 5-table filter
  context + `getDataset`). Pure-query page, no mirror.
- `OwnerRevenue` — `features/wallet/hooks/useRevenue.ts`
  (`walletKeys.revenueStats()` / `revenueByPeriod(period)`); the
  `getBusinessProfile` bank-detail effect derives form state from
  `useBusinessProfile` (UserProfile-style derive-from-query effect, not a
  mirror); `handleSaveBankDetails` → a `useMutation` (storage upload +
  `.update`), `onSuccess` invalidates `authKeys.profile`.
- `OwnerDashboard` — the deferred-consumer showcase: adopts `useScreens` (5a),
  `useBusinessProfile` + `useSectors` (2b), plus `walletKeys` revenue +
  `campaignOwnerApprovalService`. Read-heavy composite; no writes; no mirror.
- `OwnerStatementDetailPage` — `useBusinessProfile` feeding `recipient` via a
  derive effect; PDF export stays imperative.
- `OwnerStatementsPage` — **recommended not migrated** (no page-data-fetch
  surface; profile read is imperative-in-handler). If the reviewer wants it
  migrated anyway, only the imperative `getBusinessProfile` could read from
  the `useBusinessProfile` cache — flag as a choice.
- Apply per-page mirror discrimination: none of the 5b pages is expected to
  need an OwnerScreens-style mirror (no local-only mutating handlers
  surfaced in inventory) — but re-evaluate each at write time and document.
- Watch for missing-persistence siblings; each gets a LATENT BUG FLAGGED
  section (not fixed), filed as a TBD.

---

## §9 — Verification gates at Commit 5b close

- typecheck **53** — must stay flat. Transient blips fixed in-flight; genuine
  incidental drift → CF-5-extended protocol (§4).
- lint **357** — transient `import-x/order` spike ≤ +5 pre-autofix is routine
  (scoped `eslint --fix` on touched files); post-autofix must be 357. No new
  `react-hooks/exhaustive-deps` (the 18 warnings must not grow).
- test **124 + ~6–10** (`performancesKeys` factory tests + any extracted
  transforms; `authKeys.profile` adds ~1–2 tests to the existing auth
  `queryKeys.test.ts`).
- build main gzip **139.16 ± 0.5 kB**; per-chunk ± 0.5 kB.
- file count **188 + N** (new hook files).
- `--no-verify` likely required (inherited `jsx-a11y` on the large owner
  pages) — document the tripping file.

---

## §10 — Resumption protocol

The fresh session, on reading this file as part of context reload:

1. Produces an explicit acknowledgement — **"I have read the 5b resumption
   brief; my understanding of Commit 5b is: [...]"** — summarising the 5b
   scope, the locked `useBusinessProfile` decision, and the gate baselines,
   matching the original kickoff's Phase-1-context-reload pattern.
2. **Verifies the advertiser-XOR-owner invariant** (§7) by reading
   `App.tsx`'s route guards — this is the one piece of 5b due diligence not
   yet done.
3. **Pauses for an explicit "go"** before firing Commit 5b execution.
4. Executes 5b per §8, runs the §9 gates, delivers a CF-9 pause summary
   (numbered spot-check bullets + receipt confirmation), holds the code
   commit local until "go", then pushes (CF-6/CF-7).

This file is a doc commit — committed and pushed immediately per CF-6.
