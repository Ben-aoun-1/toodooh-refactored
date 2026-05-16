# Step 10 — Introduce React Query for server state — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan commit-by-commit.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `@tanstack/react-query` as the server-state layer for `apps/web`, wrapping
the existing hand-rolled `useEffect`+`setState` data-fetching and mutation sites in `useQuery` /
`useMutation`, so server data lives in React Query and Zustand is left holding only client state.

**Architecture:** A single `QueryClient` is created once and provided at the root. Each feature
folder grows a `hooks/` directory of `useQuery` / `useMutation` hooks that wrap the *current*
data-access path — existing service methods where a service exists, inline React Query fetchers
where the page calls Supabase directly. The service layer's shape is **not** restructured
(Phase 1 owns that). Mutations declare their invalidation graph explicitly. The two notification
bells consolidate onto React Query as a scoped exception, fixing their mark-read staleness bug.

**Tech Stack:** React 18.3.1 · Vite · TypeScript strict · `@tanstack/react-query` v5 ·
`@tanstack/react-query-devtools` v5 (dev-only) · Zustand (unchanged) · Supabase JS client
(unchanged) · vitest.

This plan owns audit roadmap **Step 10 · issue #6** and resolves the §3 anti-pattern entry
**"No server-state layer."** It is written against `main` at **`89686b2`** (TBD-C closure).

---

## Section 0 — Pre-flight verifications (one-time, before Commit 1)

Run every check here before Commit 1. Any drift → **hard-halt** and surface to the user.

### 0.1 Branch state

- [ ] `git rev-parse HEAD` → `89686b2cef2c466fb2597c1540ad60081f8b61d0`.
- [ ] `git status --short` → empty (clean tree).
- [ ] Working on `main` (Step 10 has no isolation requirement; if the user wants a worktree,
      create it via `superpowers:using-git-worktrees` first).

### 0.2 Node / pnpm version

- [ ] `.nvmrc` pins **`20.20.2`**. **The shell that wrote this plan was on Node `v24.15.0`.**
      Before Commit 1, the executing engineer MUST `nvm use` (or equivalent) to land on
      Node 20.20.2 — installing `@tanstack/react-query` under Node 24 then running gates
      under Node 20 (or vice versa) is a lockfile-integrity risk. Confirm `node -v` → `v20.20.2`.
- [ ] pnpm 9.x via corepack (`corepack pnpm -v`). If absent, re-run
      `corepack enable pnpm --install-directory ~/.local/bin`.

### 0.3 Gate baselines re-verified (must match audit §2 / TBD-C closure)

Run the four gates from a clean tree. They MUST read:

| Gate | Baseline | Command |
| ---- | -------- | ------- |
| `pnpm typecheck` | **55 errors** | `corepack pnpm typecheck` |
| `pnpm lint` | **357 problems (339 errors, 18 warnings)** | `corepack pnpm lint` |
| `pnpm test` | **8 suites, 98 tests, 0 failures** | `corepack pnpm test` |
| `pnpm build` (main `index-*.js` gzip) | **131.47 kB** | `corepack pnpm --filter @toodooh/web build` |
| `pnpm build` (NewCampaign chunk gzip) | **26.04 kB** | — same build — |
| File count (`.ts`/`.tsx` under `apps/web/src/`, incl. tests) | **157** | `find apps/web/src \( -name '*.ts' -o -name '*.tsx' \) \| wc -l` |

If anything drifts, **hard-halt** before Commit 1.

### 0.4 React Query absence re-confirmed (CF-8 grep)

- [ ] `grep -rln 'useQuery\|useMutation\|@tanstack/react-query\|QueryClient' apps/web/src` →
      **zero hits.** (Verified at plan time: zero.) If any hit exists, Step 10 has already
      been partially started — halt and reconcile.
- [ ] `grep 'tanstack\|react-query' apps/web/package.json package.json` → **not installed.**
      (Verified at plan time: not installed.)

### 0.5 Test-infrastructure shape pinned (decision D-T below depends on this)

- [ ] `apps/web/vite.config.ts` `test` block reads: `environment: 'node'`,
      `include: ['src/**/*.test.ts']`, `globals: true`. **It does not include `.test.tsx` and
      does not run a DOM environment.** All 8 existing suites are pure-function `.test.ts`.
- [ ] `@testing-library/react`, `jsdom`, `happy-dom` are **not** in `apps/web/package.json`.

This means **React hooks cannot be rendered in the current test setup**. The test strategy
(§2.3) is built around this constraint; Decision **D-T** locks how `useQuery` hooks get covered.

### 0.6 Audit-doc reading

- [ ] Read audit §2 (Snapshot), §3 ("No server-state layer", "Flat folder structure"),
      §5 row 10.
- [ ] Read the Step-8 notes file `docs/superpowers/plans/2026-05-15-step-8-notes.md` for the
      CF carry-forwards (§8 below restates the ones that apply).

---

## Section 1 — Locked decisions (D1–D6) — constraints, not open questions

These six decisions are **settled**. Do not re-litigate them during execution. They are
restated verbatim from the Step-10 kickoff.

**D1 — Auth and admin Zustand stores stay entirely in Zustand.** No partial migration of
server-state slices into React Query. Reason: they are session coordinators with side effects
(Supabase auth listener, `localStorage` writes via `persist`, profile classification,
validation gates). Splitting state across Zustand + React Query creates a coordination problem
with no clean resync. Phase 1 (better-auth migration) handles eventual cleanup.

**D2 — Cart Zustand store (`features/campaigns/stores/cart.store.ts`) stays in Zustand.**
Pure client state. 5 consumers verified by TBD-J. Not a Step 10 target.

**D3 — Step 10 creates NO new service abstractions.** Storage service, campaign-relationships
service — all become follow-up issues. Step 10 wraps existing services in `useQuery` /
`useMutation`; wraps direct-Supabase calls in inline React Query fetchers. Service layer shape
stays as-is; Phase 1 replaces it.

**D4 — Migration wraps current data-access paths; it does not restructure them.** Every
existing service call site stays, just wrapped. The 50 Supabase-importing files do not
collapse to a typed client in Step 10.

**D5 — The notification bell consolidates inside Step 10 as a scoped exception to D3.** Build
either a notifications service OR an inline React Query synthesis function. The bell becomes
one `useQuery` (multi-table-join feed) + one `useMutation` (mark-read with `onError` rollback).
This fixes the existing mark-read staleness bug (currently optimistic update without rollback).
The mark-read fix is the explicit deliverable that justifies the exception. **See CF-10
finding F-5 below — there are TWO bells, not one; D5 covers both.**

**D6 — Step 10 is NOT a folder restructure.** Files stay where Step 8 put them. New code lands
in the feature folder that owns it, under `features/<domain>/hooks/`.

**Escape hatch:** if, at inventory time, the migration branch reveals a situation where D1–D6
cannot hold without producing nonsense, surface it as a **"scope decision needed"** — do not
silently expand or contract scope.

---

## Section 2 — Standing operating procedure (per-commit cadence)

### 2.1 Four-gate cadence (non-negotiable)

Between every commit, in order:

```
typecheck → lint (with scoped autofix) → test → build
```

- **typecheck** must stay **55**. Step 10 adds only new, fully-typed hook files plus a
  `QueryClient` setup; it touches no Cat-A untyped-root cascade. Any movement off 55 →
  hard-halt and investigate.
- **lint** baseline is **357**. Step 10 introduces new `.ts` hook files (no JSX → no
  `jsx-a11y` surface) and adds `@tanstack/react-query` imports to modified pages. New code
  MUST be lint-clean. Modified pages may show a transient `import-x/order` spike from the new
  import lines landing un-sorted; resolve with `pnpm exec eslint --fix` scoped to touched
  files (CF-2 procedure). **Drift tolerance: end-state lint must remain ≤ 357.** A transient
  pre-autofix spike of ≤ +5 (`import-x/order` only) is routine; a spike that survives autofix,
  or any non-order rule regressing, is the real signal → hard-halt. (Proposed tolerance —
  decision **D-L** confirms.)
- **test** must **grow**. Each feature commit adds pure-function tests for its query-key
  factory and any extracted fetcher functions. Target total growth **M** (decision **D-M**;
  proposed M ≈ 20, range 16–26). test must never drop below 98; failures are a hard-halt.
- **build**: `@tanstack/react-query` runtime is ~12–13 kB gzipped and lands in the main
  `index-*.js` chunk (it is imported by `App.tsx`). `@tanstack/react-query-devtools` is
  **dev-only** (`import.meta.env.DEV`-gated lazy import) and must contribute **0 kB** to the
  production bundle. **Proposed tolerances (decision D-B):** main-bundle gzip one-time step of
  **+10 to +16 kB** at Commit 1 (settling at ≈ 141–147 kB), then flat ±0.5 kB per feature
  commit; per-feature chunk gzip ±0.5 kB (hook code is small). A main-bundle jump on a
  feature commit, or any prod-bundle devtools bytes, → hard-halt.

### 2.2 `--no-verify` authorization

Workspace `pnpm lint` is the authoritative gate. `lint-staged` on long-lived inherited files
(e.g. `OwnerSettings.tsx`, `UserManagement.tsx`, `SignUpForm.tsx`) may surface pre-existing
errors unrelated to the commit's scope and block an otherwise-green scoped commit. When that
happens: `--no-verify` is authorized **per-commit**, and the commit body must state which file
tripped the hook and that the workspace gate is green. Do not use `--no-verify` to paper over a
regression in a file Step 10 actually modified.

### 2.3 Test strategy under the node-environment constraint (see §0.5)

The current vitest setup runs `environment: 'node'` and globs `src/**/*.test.ts` only. React
hooks cannot be rendered without a DOM environment + `@testing-library/react`. Decision **D-T**
locks the approach; this plan is written for the **recommended** option:

**Recommended (D-T option A — no test-infra change):** Step 10 tests the *pure, node-runnable*
layer of each feature's query code as `.test.ts`:

- **query-key factories** — each feature gets a `queryKeys` object (a pure function/const
  module); tests assert key shape and stability (`queryKeys.campaigns.list(userId)` →
  `['campaigns', 'list', userId]`).
- **extracted fetcher functions** — where a `useQuery` wraps non-trivial post-fetch transform
  logic (e.g. `useDashboardStats`'s year-bucketing math), the transform is extracted into a
  pure function and unit-tested with fixture input. The Supabase call itself is not tested
  (no integration env) — only the transform.

This adds **zero** dependencies and **zero** config change, stays inside the existing
`.test.ts` glob, and matches the Step-7 precedent (21 pure-function tests on the wizard's
serialize/perform layer — never hook-rendering tests).

**Alternative (D-T option B — test-infra change):** add `@testing-library/react` + `jsdom` +
`@testing-library/jest-dom`, switch the relevant glob to `.test.tsx`, and write
`renderHook`-based tests that mount each `useQuery` against a test `QueryClient`. Heavier;
introduces a DOM environment and 3 devDependencies. **Not recommended for Step 10** — it is a
tooling expansion beyond the issue's scope and is better handled as its own roadmap item.

If D-T resolves to option B, Commit 1's commit factoring grows a test-infra sub-step and M
rises; the rest of the plan is unaffected.

### 2.4 Inventory-phase scope rule (CF-8 / CF-10)

Every commit re-greps its own file list and importer counts against the migration branch
**at execution time**, not from this plan's §4 figures. §4 was greppped at plan time against
`89686b2`; if the branch has moved, §4 is a lower bound, not gospel. Surface any discrepancy
in the commit's pause summary as a CF-10 finding.

### 2.5 QueryClient default config is locked once, at Commit 1

The `QueryClient` defaults (`staleTime`, `gcTime`, `refetchOnWindowFocus`, `retry`) are
**user-visible behavior** and must be decided before Commit 1 (decision **D-Q**). Once set in
Commit 1, no feature commit changes them; a hook that genuinely needs different behavior sets
it per-`useQuery`, with a comment naming why.

### 2.6 Figma consultation rule (CF — toodooh-specific)

Step 10 is a data-layer migration and should be behavior-preserving — loading spinners and
empty states that exist today stay as they are. If a `useQuery` migration surfaces a *new*
UI state that did not exist before (e.g. a page that rendered instantly now has a genuine
`isLoading` gap, §9 risk R-1), consult `~/Downloads/toodooh_figma/` for the intended loading
treatment before inventing one. Confirm the consultation in the commit's inventory notes.

### 2.7 Pause-after-commit protocol (CF-9)

Every commit ends with a CF-9 pause summary delivered as a single copy-paste-fidelity text
block: full hash + subject, push-state line, four-gate table, inventory deltas vs this plan
(CF-10 findings), spot-check sample, surprises, next-commit forecast. No "see file X."

---

## Section 3 — Hard-halt criteria

Stop immediately, do not commit, surface to the user, if any of these occur:

1. **typecheck moves off 55** — Step 10 must not touch the Cat-A baseline.
2. **lint spike survives autofix**, or any non-`import-x/order` rule regresses.
3. **test count drops, or any suite fails.**
4. **main-bundle gzip jumps on a feature commit** (the one-time React Query cost is Commit 1
   only), or **any devtools bytes appear in the production bundle.**
5. **A `useQuery` migration changes observable behavior** beyond loading states — a different
   data shape, a dropped error toast, a changed empty-state. Step 10 is behavior-preserving
   except for the explicit D5 mark-read fix.
6. **Query-key collision** — two unrelated queries share a key and read each other's cache.
   Detectable as a wrong-data render in spot-check.
7. **A mutation's invalidation graph is incomplete** — a write succeeds but a dependent view
   shows stale data because the mutation did not invalidate it. (This is the bug class Step 10
   is supposed to *fix*; shipping a new instance of it is a halt.)
8. **Optimistic-update rollback fails** — the D5 mark-read `onError` path does not restore the
   pre-mutation cache. Halt and fix the rollback before committing.
9. **`QueryClient` config drift** — a feature commit changes the Commit-1 defaults.
10. **D1/D2 violation** — a server-state slice gets pulled out of the auth/admin store, or the
    cart store gets wrapped in React Query.
11. **A new service abstraction appears** outside the D5 bell exception (D3 violation).
12. **File-count delta exceeds the plan's per-commit forecast by > ±2** without an explained
    cause (CF-4 tolerance).

---

## Section 4 — Inventory phase (re-derived from grep at `89686b2`)

All figures below were greppped against `main` at `89686b2` at plan time. They supersede the
Codex production-code estimates from the prior session (CF-10). **Codex-divergence findings
are flagged `F-n` and collected in §4.7.**

### 4.1 React Query is absent (confirmed)

`useQuery` / `useMutation` / `QueryClient` / `@tanstack/react-query` — **0 references** across
`apps/web/src/`. Not in `package.json`. Step 10 starts from zero. ✓

### 4.2 Supabase-import surface — 50 files (not "~25")

`grep -rl 'lib/supabase'` (excl. tests) → **50 files**. Broken down:

| Bucket | Count | Notes |
| ------ | ----- | ----- |
| Service files (`features/*/services/*.service.ts` + root `services/`) | ~21 | Legit data layer — Supabase belongs here. Wrapped via service-method `useQuery`, not rewritten. |
| Page / component / hook files | ~26 | The actual migration concern — these call `supabase.*` directly, bypassing services. |
| Root / cross-cutting (`services/balance.service.ts`, `services/global-configuration.service.ts`) | 2 | Cross-cutting services retained by Step 8 Clarification A. |
| `scripts/checkTableStructure.ts` | 1 | Excluded — script, not app code. |

**F-1 (CF-10):** Codex estimated "~25 files, ~100+ direct call sites." The page/component/hook
bucket (~26) matches Codex's ~25; Codex's count was the *non-service* direct-Supabase surface.
The full Supabase-touching file count is **50** once service files are included. Both numbers
are correct for their scope — this plan uses **26 page/component/hook files** as the migration
target population and treats the ~21 services as wrap-don't-rewrite.

Page/component/hook files importing `lib/supabase` directly, by feature:

| Feature | Files |
| ------- | ----- |
| `advertiser` | `components/AdvertiserNotificationsBell.tsx`, `hooks/useDashboardStats.ts`, `hooks/useLastCampaigns.ts`, `pages/MyClients.tsx`, `pages/UserProfile.tsx` |
| `auth` | `stores/auth.store.ts` *(D1 — stays Zustand, not migrated)* |
| `campaigns` | `hooks/new-campaign/useCampaignWizard.ts`, `pages/CampaignDetails.tsx`, `pages/CartPage.tsx`, `pages/MyCampaigns.tsx`, `pages/NewCampaign.tsx` |
| `events` | `pages/Events.tsx` |
| `admin` | `components/AffluenceModal.tsx`, `pages/CampaignMonitoring.tsx`, `pages/EventManagement.tsx`, `pages/RechargeManagement.tsx`, `pages/UserManagement.tsx` |
| `screenhost` | `components/OwnerNotificationsBell.tsx`, `pages/MyAccount.tsx`, `pages/OwnerCampaigns.tsx`, `pages/OwnerPerformance.tsx`, `pages/OwnerRevenue.tsx`, `pages/OwnerScreens.tsx`, `pages/OwnerSettings.tsx` |

### 4.3 Service-consumer surface — 41 component/page files import a `*.service`

`grep -rl "services/.*\.service'"` (feature `.tsx`, excl. tests) → **41 files**. These are the
clean wrap targets: the page calls `someService.method()`, and the migration replaces the
`useEffect`+`setState` with `useQuery({ queryФn: () => someService.method() })`. The full list
is in §4.8; per-feature counts:

| Feature | Service-consuming component files |
| ------- | --------------------------------- |
| `admin` | 12 |
| `screenhost` | 18 |
| `campaigns` | 5 |
| `wallet` | 2 |
| `events` | 1 |
| `advertiser` | 1 (`UserProfile`) |
| `auth` | 3 *(form components — mutations only, no read-query migration)* |

### 4.4 `useEffect` surface — 153 occurrences in `features/**/*.tsx`

Not all are data fetches; many are subscriptions, focus/scroll handlers, derived-state syncs.
The data-fetching subset is the migration target. Heaviest data-fetch concentrations
(`useEffect` count per file): `OwnerScreens` 8, `OwnerDashboard` 6, `OwnerCampaigns` 6,
`OwnerRevenue` 5, `OwnerLocations` 5, `UserProfile` 5, `UserManagement` 5, `Events` 4,
`MyCampaigns` 4, `CampaignMonitoring` 4, `VideoManagement` 4. `NewCampaign.tsx` has 18 but
most are wizard-state syncs, not server fetches (D2-adjacent — see §9 R-6).

The **5 existing advertiser custom hooks** already encapsulate the fetch in the
`useEffect`+`useState`+`loading`/`error` shape — they are the cleanest migration targets and
convert to `useQuery` almost mechanically:

| Hook | Lines | Fetches |
| ---- | ----- | ------- |
| `useDashboardStats.ts` | 162 | `campaigns` table + `balanceService` — has non-trivial year-bucketing transform (extract → pure fn → test) |
| `useLastCampaigns.ts` | 153 | recent campaigns |
| `useFeaturedEvents.ts` | 46 | featured events |
| `useUserProfile.ts` | 61 | business profile |
| `useAdvertiserGlobalConfig.ts` | 65 | global config |

### 4.5 Mutation surface

Direct Supabase write calls in `features/**/*.{ts,tsx}` (excl. tests):

| Op | Count |
| -- | ----- |
| `.insert(` | 24 |
| `.update(` | 59 |
| `.delete(` | 24 |
| `.upsert(` | 12 |
| **Total write call sites** | **119** |

Post-write behavior signals: `window.location.reload()` → **0** ✓ (confirmed — Step 9 cleared
the last ones; the §3 reload anti-pattern is resolved). `toast.success` → 96 occurrences;
`navigate(` → 132 occurrences. Mutation sites today follow the pattern *write → toast → manual
re-fetch (or nothing)*; the re-fetch is the staleness-bug surface React Query's
`invalidateQueries` replaces. Each feature commit's inventory enumerates that feature's
mutations and the **invalidation graph** (which mutation invalidates which query keys) —
see §5 per-commit.

### 4.6 Polling intervals — 4 `setInterval`, but only 2 are server-state polling

`grep -rn 'setInterval' features` → **4 sites:**

| Site | Interval | Kind |
| ---- | -------- | ---- |
| `advertiser/components/AdvertiserNotificationsBell.tsx:225` | window.setInterval | **Server-state polling** — bell feed auto-refresh |
| `screenhost/components/OwnerNotificationsBell.tsx:302` | window.setInterval | **Server-state polling** — bell feed auto-refresh |
| `screenhost/components/ScreenCalendar.tsx:69` | `setInterval(checkExpiredUnavailability, 60000)` | Client-side expiry check — no server fetch |
| `screenhost/pages/OwnerScreens.tsx:394` | `setInterval(checkExpiredUnavailability, 60000)` | Client-side expiry check — no server fetch |

**F-2 (CF-10):** Codex's "4 polling intervals" is literally correct, but only **2** are
server-state refetch loops (the two bells). The other 2 are `checkExpiredUnavailability`
local-time checks against already-loaded data — **not** React Query concerns; they stay as
plain `setInterval`. Step 10 converts only the 2 bell polls, into `useQuery`'s
`refetchInterval`.

### 4.7 Notification bell — there are TWO bells

| Bell | Lines | Tables joined | Consumed by | mark-read |
| ---- | ----- | ------------- | ----------- | --------- |
| `advertiser/components/AdvertiserNotificationsBell.tsx` | 397 | 5 — `business_profiles`, `campaigns`, `user_notification_reads`, `user_notifications`, `videos` | `advertiser/components/PageHeader.tsx` (1 consumer) | optimistic `setReadIds` + `upsert` to `user_notification_reads`, **no rollback** on error (`log.error` only) |
| `screenhost/components/OwnerNotificationsBell.tsx` | 486 | 7–8 — `business_profiles`, `user_notification_reads`, `locations`, `screens`, `campaign_owner_approvals`, `campaign_locations`, `campaign_screens`, `campaigns` | 7 owner pages directly (`OwnerDashboard`, `OwnerRevenue`, `OwnerCampaigns`, `OwnerPerformance`, `OwnerStatementsPage`, `OwnerCalendarDevices`) | same pattern — optimistic `setReadIds` + `upsert`, **no rollback** |

**F-3 (CF-10):** Codex prep and D5 both say "the notification bell" (singular). There are
**two** bells with two different feeds. D5's premise — *optimistic mark-read with no rollback*
— is **confirmed for both**: `markRead` and `markAllRead` in each bell do
`setReadIds(prev => new Set(prev).add(id))` then `upsert`, and on error only `log.error` — the
read state is never restored. This is not a D5 nonsense-condition (D5 still applies cleanly),
but D5's one-bell framing under-scopes the work: the consolidation is **two** `useQuery` +
**two** `useMutation` (one pair per bell), or one shared parameterized hook pair. **Decision
D-5 needed** (§Decisions): does D5's "one commit's worth of scope" cover both bells, and is
the implementation two hook-pairs or one parameterized `useNotifications(scope)` pair?

### 4.8 Supabase Storage surface — 9 files (not "12")

`grep -rl 'supabase.storage\|\.storage\.from'` (features, excl. tests) → **9 files:**
3 services (`auth.service.ts`, `campaigns/services/video-upload.service.ts`,
`screens/services/predefined-zones.service.ts`) + 6 pages (`admin/EventManagement`,
`admin/UserManagement`, `advertiser/UserProfile`, `screenhost/MyAccount`,
`screenhost/OwnerRevenue`, `screenhost/OwnerSettings`).

**F-4 (CF-10):** Codex estimated "12 files." Actual is **9**. Per D3, no storage service is
built in Step 10 — storage operations are file uploads (mutations), wrapped as `useMutation`
where they sit on a migrated page, and the absence of a storage service layer becomes
**follow-up TBD-K** (§6).

### 4.9 Cart duplication (D2 context)

TBD-J already confirmed: `features/campaigns/stores/cart.store.ts` is the live cart store
(5 consumers), `MyCart.tsx` was deleted in audit Step 2a. D2 holds — cart stays Zustand.
No further inventory needed; flagged only so a feature commit does not "discover" it again.

### 4.10 App provider tree

`apps/web/src/main.tsx` renders `<StrictMode><App /></StrictMode>`. `App.tsx` returns
`<><Router>…</Router><Toaster/></>`. Commit 1 wraps the tree in `<QueryClientProvider>` —
the cleanest insertion point is inside `App.tsx`'s fragment, wrapping `<Router>` and
`<Toaster>`, so the provider is co-located with the routes it serves. DevTools mounts as a
dev-only sibling.

---

## Section 5 — Commit factoring

**Estimated total: 10 commits** (range 8–12; the screenhost and admin commits may each split
into two if their inventory comes back larger than forecast — decision deferred to those
commits' inventory phase per §2.4). Ordering heuristic: **simplest-and-most-isolated first**
(validate the pattern, the QueryClient config, and the test approach on low-risk surface),
**largest-surface last**, **bells second-to-last** (D5 exception — needs the pattern settled),
**audit refresh last**.

Per-feature commit shape (every Commit 2..N-1):
1. Inventory phase — re-grep this feature's data-fetch + mutation sites (CF-8/CF-10).
2. Add `features/<domain>/hooks/queryKeys.ts` (or extend if present) — the feature's query-key
   factory.
3. Add `useQuery` hooks wrapping the feature's reads.
4. Add `useMutation` hooks wrapping the feature's writes, each declaring its `invalidateQueries`
   graph.
5. Rewire the feature's pages/components to consume the new hooks; delete the replaced
   `useEffect`+`setState` blocks.
6. Add pure-function tests (query-key factory + extracted fetchers/transforms).
7. Four gates → CF-9 pause summary.

### Commit 1 — Install + QueryClient setup + Provider wiring + smoke test

**Files:**
- Modify: `apps/web/package.json` — add `@tanstack/react-query` (dependency),
  `@tanstack/react-query-devtools` (**devDependency**).
- Modify: root `pnpm-lock.yaml` (install side effect).
- Create: `apps/web/src/lib/query-client.ts` — exports the configured `QueryClient` factory.
- Modify: `apps/web/src/App.tsx` — wrap the tree in `<QueryClientProvider client={…}>`;
  dev-only lazy-mount `<ReactQueryDevtools />` behind `import.meta.env.DEV`.
- Create: `apps/web/src/lib/query-client.test.ts` — smoke test asserting the `QueryClient`
  factory produces a client with the locked defaults (D-Q).

**Work:**
- [ ] Install both packages (under Node 20.20.2 — §0.2).
- [ ] `lib/query-client.ts`: `createQueryClient()` returning `new QueryClient({ defaultOptions:
      { queries: { staleTime, gcTime, refetchOnWindowFocus, retry } } })` — values per D-Q.
- [ ] `App.tsx`: import `QueryClientProvider`, create the client once at module scope (or via
      `useState(() => createQueryClient())` to survive Fast Refresh), wrap `<Router>`+`<Toaster>`.
- [ ] DevTools: `const ReactQueryDevtools = import.meta.env.DEV ? lazy(() => import(
      '@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools }))) : null;`
      — mounted inside a `<Suspense>` only when `DEV`. Verify the prod build (§2.1) shows no
      devtools bytes.
- [ ] Smoke test (`query-client.test.ts`, `.test.ts`, node env): construct the client, assert
      `client.getDefaultOptions().queries.staleTime` etc. match D-Q. (Per D-T option A — a pure
      construction test, no hook rendering. If D-T resolves to option B, this commit also adds
      the test-infra deps and a `renderHook` smoke test instead.)

**Gates:** typecheck 55 · lint ≤ 357 · test 99 (+1 smoke) · build main gzip **+10..+16 kB**
(one-time React Query cost; the new baseline is recorded and becomes the per-feature flat
reference) · file count 157 → 159 (+`query-client.ts`, +`query-client.test.ts`).

### Commit 2 — `features/advertiser/` (validate the pattern on the cleanest surface)

**Why first:** the 5 existing advertiser hooks already encapsulate fetches in the
`useEffect`/`useState`/`loading`/`error` shape; converting them to `useQuery` keeps the
consumer interface nearly identical and is the lowest-risk place to validate the QueryClient
config, the query-key convention, and the D-T test approach.

**Hooks landed (`useQuery`):** `useDashboardStats`, `useLastCampaigns`, `useFeaturedEvents`,
`useUserProfile`, `useAdvertiserGlobalConfig` — each rewritten internally to `useQuery`,
keeping its exported result interface (the consumers — `AdvertiserDashboard`, `UserProfile`,
etc. — change minimally).
**Hooks landed (`useMutation`):** any advertiser-page write (`UserProfile` profile/document
update; `MyClients` client CRUD if present — confirm at inventory).
**Invalidation graph:** profile-update mutation → invalidate `queryKeys.advertiser.profile`;
client mutation → invalidate `queryKeys.advertiser.clients`.
**Files:** create `features/advertiser/hooks/queryKeys.ts`; rewrite the 5 hook files; modify
their consumer pages; extract `useDashboardStats`'s year-bucketing math into
`features/advertiser/hooks/dashboard-stats.transform.ts`.
**Tests:** `queryKeys.test.ts` + `dashboard-stats.transform.test.ts` (~3–4 tests).
**File-count delta:** +2 (queryKeys + transform; +1 if a separate test file per — call it
+3..+4 incl. tests).

### Commit 3 — `features/events/`

**Hooks:** `useEvents` (all events / featured events — `events.service` read methods),
`useMyEventCampaignLinks`. **Mutations:** event-campaign link writes if present on `Events.tsx`.
**Invalidation:** link mutation → invalidate `queryKeys.events.myLinks`.
**Files:** `features/events/hooks/{queryKeys,useEvents}.ts`; modify `Events.tsx`.
**Tests:** `queryKeys.test.ts` (~2 tests). **File-count delta:** +2..+3.

### Commit 4 — `features/wallet/`

**Hooks:** `useRecharges` (`MyRecharges`), `useInvoices` (`MyInvoices`) — both wrap
`revenue.service` / direct Supabase reads. **Mutations:** recharge creation if it lives on a
wallet page (confirm at inventory — recharge *approval* is admin-side, Commit 7).
**Invalidation:** recharge mutation → invalidate `queryKeys.wallet.recharges` **and**
`queryKeys.advertiser.balance` (cross-feature — a recharge changes the dashboard balance;
this is money-adjacent, get it right — §9 R-5).
**Files:** `features/wallet/hooks/{queryKeys,useRecharges,useInvoices}.ts`; modify both pages.
**Tests:** `queryKeys.test.ts` (~2 tests). **File-count delta:** +3..+4.

### Commit 5 — `features/performances/` + `features/screens/` (service-only)

**performances:** `usePerformance` wrapping `performance.service` (consumed by
`OwnerPerformance` — note the page lives under `screenhost/`; the hook lives under the feature
that owns the service, `performances/`, per D6).
**screens:** `screens.service` + `predefined-zones.service` are consumed by admin and
screenhost pages; this commit lands `useScreens` / `usePredefinedZones` query hooks under
`features/screens/hooks/` so the later screenhost/admin commits consume them rather than
re-wrapping.
**Mutations:** screen CRUD if a screens-owned page writes (most screen writes are on
`OwnerScreens` → Commit 6, and `admin/ScreenManagement` → Commit 7; this commit may be
read-only).
**Files:** `features/performances/hooks/{queryKeys,usePerformance}.ts`;
`features/screens/hooks/{queryKeys,useScreens}.ts`.
**Tests:** two `queryKeys.test.ts` (~3 tests). **File-count delta:** +4..+6.

### Commit 6 — `features/screenhost/` (large — may split 6a/6b)

**Surface:** 18 service-consuming pages + 7 direct-Supabase pages. The heaviest read pages:
`OwnerDashboard`, `OwnerScreens`, `OwnerCampaigns`, `OwnerRevenue`, `OwnerLocations`,
`OwnerCampaignApprovals`, `OwnerStatementsPage`, `OwnerStatementDetailPage`, `MyAccount`,
`OwnerSettings`, `OwnerCalendarDevices`.
**Hooks:** one `useQuery` per page-level read; `useMutation` per write (screen create/update,
unavailability set, campaign approval/rejection, settings save, account update).
**Invalidation graph (representative):** campaign-approval mutation → invalidate
`queryKeys.screenhost.campaignApprovals` + `queryKeys.screenhost.campaigns`; screen mutation →
invalidate `queryKeys.screens.list`; unavailability mutation → invalidate the affected
screen's calendar query.
**Split rule:** if inventory shows > ~12 page rewrites, split into **6a** (dashboard +
screens + locations + calendar) and **6b** (campaigns + approvals + revenue + statements +
account + settings). Decide at the commit's inventory phase per §2.4.
**Tests:** `queryKeys.test.ts` + any extracted revenue/statement transforms.
**File-count delta:** +2..+5 (hooks dir + queryKeys + transforms).

### Commit 7 — `features/admin/` (large — may split 7a/7b)

**Surface:** 12 service-consuming pages — `UserManagement`, `CampaignMonitoring`,
`EventManagement`, `RechargeManagement`, `ScreenManagement`, `VideoManagement`,
`AdminDashboard`, `GeographicZonesManagement`, `AdminGlobalConfiguration`, `AdminManagement`,
`CreateAdmin`, + `AffluenceModal`.
**Hooks:** one `useQuery` per admin list view; `useMutation` per admin write. The
`business_profiles` mutation cluster Codex flagged (recharge approval, user validation, user
CRUD) is real — these are **admin destructive / money-adjacent** writes; their invalidation
graphs must be exhaustive (§9 R-5, R-7).
**Invalidation graph (representative):** recharge-approval mutation → invalidate
`queryKeys.admin.recharges` + the affected user's balance query; user-validation mutation →
invalidate `queryKeys.admin.users`; video mutation → invalidate `queryKeys.admin.videos`.
**Split rule:** same as Commit 6 — split 7a/7b if > ~10 page rewrites.
**Tests:** `queryKeys.test.ts` + extracted admin-dashboard-stats transform if present.
**File-count delta:** +2..+5.

### Commit 8 — `features/campaigns/` (largest read surface, last)

**Surface:** `MyCampaigns`, `CartPage`, `CampaignDetails`, `NewCampaign`. **D2 boundary:**
the cart Zustand store is NOT migrated — only *server* reads/writes are. `NewCampaign`'s 18
`useEffect`s are mostly wizard-state syncs (client state); only its genuine server fetches
(screen/zone/estimate data) and its campaign-creation mutation migrate.
**Hooks:** `useMyCampaigns`, `useCampaignDetails(id)`; `useCampaignMutations` (create / update
/ delete / save-draft / add-to-cart-server-side if any).
**Invalidation graph:** campaign create/update/delete → invalidate `queryKeys.campaigns.list`
+ `queryKeys.campaigns.detail(id)` + `queryKeys.advertiser.dashboardStats` (campaign count
feeds the dashboard).
**Cart-coordination edge (§9 R-6):** verify campaign `useQuery` refetches do not implicitly
depend on cart Zustand state; the cart stays Zustand (D2) and campaign queries key off
`userId`, not cart contents.
**Tests:** `queryKeys.test.ts` (~3 tests). **File-count delta:** +2..+4.

### Commit 9 — Notification bells consolidation (D5 — scoped exception to D3)

**Per F-3, this covers BOTH bells.** Implementation per decision D-5: either one parameterized
`features/<owner>/hooks/useNotifications.ts` pair shared by both bells, or two pairs.
**Hooks:** `useNotificationsFeed(scope)` — one `useQuery` per bell, the multi-table join moved
into the `queryFn` (or a thin notifications synthesis function per D3's D5 carve-out);
`refetchInterval` replaces the manual `setInterval` (F-2). `useMarkNotificationRead` —
`useMutation` with **optimistic update + `onError` rollback**: `onMutate` snapshots the
`readIds` cache and applies the optimistic add; `onError` restores the snapshot; `onSettled`
invalidates the feed. **This rollback is the explicit D5 deliverable** — it fixes the
confirmed no-rollback staleness bug (F-3).
**Files:** `features/advertiser/hooks/useNotifications.ts` +
`features/screenhost/hooks/useNotifications.ts` (or one shared module per D-5); rewrite both
bell components to consume them; delete the manual `setInterval` + `setReadIds` blocks.
**Tests:** mark-read optimistic/rollback logic is the highest-value test here — if D-T is
option A, extract the cache-update + rollback reducer into a pure function and test it
(apply → success keeps, apply → error reverts); if D-T is option B, a `renderHook` test.
(~3–4 tests.) **File-count delta:** +1..+3.

### Commit 10 — Audit refresh + close #6 + file follow-up issues

**Files:** `docs/audit.md` (§2 snapshot, §3, §5 row 10, §4 new row); this is a doc commit
(CF-6 — push immediately).
**Work:**
- [ ] §5 row 10 `☐` → `☑` with the merge commit.
- [ ] §3 "No server-state layer" entry → moved into §4 "Already resolved" as the Step 10 row.
- [ ] §2 snapshot: lint (likely flat 357), file count (+M-ish), main-bundle gzip
      (+~13 kB from React Query — record the settled number), per-chunk deltas.
- [ ] §4 add the Step 10 row (mirroring the Step 8 / Step 9 / TBD-C row format).
- [ ] Close issue #6.
- [ ] File follow-up issues via `gh issue create --label cleanup` — see §6.
**Gates:** doc commit — gates flat at the post-Commit-9 numbers.

---

## Section 6 — Follow-up issues to file at Commit 10

Captured live as Step 10 surfaces them; filed at the audit-refresh commit, each
cross-referencing the Step 10 commit that surfaced it. Decision **D-K** below decides whether
to file these pre-emptively (before Commit 1) or at Commit 10.

| ID (proposed) | Title | Rationale |
| ------------- | ----- | --------- |
| TBD-K | Storage service abstraction | 9 files do `supabase.storage` directly with no service layer (F-4). D3 defers this; Phase 1 owns the typed-client version. |
| TBD-L | Campaign-relationships service | The campaign↔screen↔location↔owner-approval join logic is duplicated across the two bells and several pages; D3 defers consolidating it into a service. |
| TBD-M | `checkExpiredUnavailability` interval duplication | The same `setInterval(checkExpiredUnavailability, 60000)` block is copy-pasted in `ScreenCalendar.tsx` and `OwnerScreens.tsx` (F-2). Not a React Query concern; a small dedup follow-up. |
| TBD-N (conditional) | Test-infra for hook-level testing | Only if D-T resolves to option A — records that `useQuery` hooks are covered only at the pure-function layer and a future step may want `@testing-library/react` + jsdom for hook-render tests. |

---

## Section 7 — Hard-halt summary

A consolidated restatement of §3, in the Step-8 §7 shape — the conditions under which the
executing engineer stops, does not commit, and surfaces to the user:

- Any gate moves off baseline in a direction the plan does not predict (typecheck off 55;
  lint spike survives autofix; test drops or fails; main bundle jumps on a feature commit;
  devtools bytes in prod).
- A behavioral regression — different data, dropped toast, changed empty-state — beyond the
  one sanctioned D5 mark-read fix.
- A query-key collision, an incomplete invalidation graph, or a failed optimistic rollback.
- A D1/D2/D3 violation (store slice pulled into React Query; cart wrapped; new service
  abstraction outside the D5 carve-out).
- `QueryClient` config drift after Commit 1.
- File-count delta exceeds the per-commit forecast by > ±2 without explanation.
- An inventory grep contradicts a D1–D6 premise hard enough that the decision produces
  nonsense → surface as "scope decision needed," do not silently adjust scope.

---

## Section 8 — Carry-forward methodology rules

Cited from the actual notes file `docs/superpowers/plans/2026-05-15-step-8-notes.md` (read at
plan time). The file's numbered rules are **CF-1 … CF-10 and CF-12** — there is **no CF-11**
(a candidate refinement under CF-10, the directory-survivor / consumer-grep pairing, was
explicitly "folded into audit §3, not a separate CF"). Which apply to Step 10:

| CF | Rule | Applies to Step 10? |
| -- | ---- | ------------------- |
| CF-1 | Sed-pattern coverage (three import shapes) | **No** — Step 10 is not a rename/move pass; no sed sweep. New imports are added by hand to a bounded set of files. |
| CF-2 | Four-gate cadence with scoped `eslint --fix` after import changes | **Yes** — new `@tanstack/*` imports land un-sorted; scoped autofix before measuring the lint gate (§2.1). The CSS/side-effect-import autofix blind spot (CF-2 third amendment) is unlikely but possible on a page that already has a CSS import. |
| CF-3 | Chunk-hash soft signal | **Partial** — Commit 1 changes the main chunk's content (real, expected). Feature commits change only the chunks whose source they touch. Hash *identity* is not expected; an *unexplained* hash change still triggers a diff check. |
| CF-4 | Importer counts are ±1; re-grep, don't trust the doc | **Yes** — §4's counts are plan-time greps; each commit re-verifies (§2.4). |
| CF-5 | Audit §2 per-rule lint breakdown can be stale | **Minor** — Commit 10 audit refresh resyncs §2 if needed. |
| CF-6 | Two-tier push: doc commits push immediately, code commits hold for "go" | **Yes** — this plan doc and Commit 10 push immediately; Commits 1–9 hold local until "go". |
| CF-7 | Two-tier push policy detail (notes-file edits as own micro-commits) | **Yes** — any mid-Step-10 notes file lands as its own pushed micro-commit. |
| CF-8 | Importer/usage counts must be grep-verified at write time | **Yes** — §4 is grep-derived; §4.7's two-bell finding is a direct CF-8 catch. |
| CF-10 | Codex-finding ↔ migration-branch divergence — re-grep before acting | **Yes, heavily** — §4's F-1…F-4 are all CF-10 findings (file counts, bell count, storage count, polling semantics all diverged from the Codex production-code estimates). |
| CF-12 | Measure gates in the committed end-state, after transient install/uninstall settles | **Yes** — Commit 1 installs two packages; the bundle/lint numbers in its pause summary are measured after install completes, not mid-flight. |

**Candidate new carry-forwards surfaced while writing this plan** (promote to numbered CFs
during execution only if they earn it — next free number is **CF-13**, since CF-11 was never
issued and CF-12 is taken):

- **CF-13 candidate — query-key naming convention.** Every feature's `queryKeys.ts` follows
  one factory shape (`queryKeys.<feature>.<view>(...args)` → a readonly tuple). Locked at
  Commit 2; later commits conform. Worth a CF if a later commit drifts.
- **CF-14 candidate — invalidation-graph completeness rule.** Every `useMutation` must
  enumerate, in a comment above its `onSuccess`/`onSettled`, *every* query key it invalidates
  and why. An incomplete graph is the exact bug class Step 10 exists to kill (§3 halt #7).
- **CF-15 candidate — `useQuery` test-pattern rule.** Under D-T option A, the testable unit
  is the query-key factory + extracted pure transforms, never the hook render. Records the
  Step-7 "pure-function tests only" precedent extended to the query layer.

---

## Section 9 — Risk register

| ID | Risk | Likelihood | Mitigation |
| -- | ---- | ---------- | ---------- |
| R-1 | **Loading-state cascade** — a page that rendered instantly off Zustand/derived state now has a genuine `isLoading` window and shows a flash, spinner gap, or undefined-access crash. | Medium | Each migrated page keeps its existing loading treatment; where none existed, consult Figma (§2.6) before inventing one. Spot-check every migrated page's first paint. |
| R-2 | **Query-key collision** — two unrelated queries share a key, read each other's cache, render wrong data. | Medium | One `queryKeys.ts` factory per feature; keys are namespaced by feature (`['campaigns', …]`, `['admin', 'users', …]`). CF-13 candidate. Spot-check cross-feature. |
| R-3 | **Optimistic rollback mistake** (D5 mark-read) — `onError` does not restore the pre-mutation cache, or restores a stale snapshot. | Medium | `onMutate` snapshots, `onError` restores that exact snapshot, `onSettled` invalidates. Pure-function-test the cache reducer (§Commit 9). Halt #8. |
| R-4 | **DevTools shipped to prod** — `@tanstack/react-query-devtools` bytes leak into the production bundle. | Low | `import.meta.env.DEV`-gated lazy import; verify the prod build has zero devtools bytes (§2.1, halt #4). |
| R-5 | **Money-adjacent invalidation gap** — a recharge/balance/invoice mutation does not invalidate every view that shows the figure (dashboard balance, wallet page, admin recharge list). | Medium | Cross-feature invalidation is explicit in §5 (Commit 4, Commit 7). CLAUDE.md rule 10 — money-adjacent: get it right or ask. CF-14 candidate. |
| R-6 | **Cart-coordination edge** — campaign `useQuery` refetches implicitly depend on cart Zustand state, which is NOT in React Query (D2), creating a desync. | Low | Commit 8 explicitly verifies campaign queries key off `userId`, not cart contents. Cart stays Zustand; no React Query ↔ cart bridge. |
| R-7 | **Service-vs-direct-Supabase asymmetry** — some features migrate by wrapping a service method, others by wrapping a direct `supabase.*` call; the two produce different `queryFn` shapes and different test surfaces, risking inconsistent hook structure across features. | Medium | The per-feature commit shape (§5) is identical regardless; the `queryFn` body differs but the hook signature, key convention, and test approach do not. Commit 2 sets the template; reviewers check conformance. |
| R-8 | **`QueryClient` default-config surprise** — `refetchOnWindowFocus`/`staleTime` defaults change perceived behavior (e.g. every tab-focus refetches, flickering data). | Medium | D-Q locks the defaults before Commit 1 with explicit reasoning; §2.5 forbids per-commit drift. |
| R-9 | **StrictMode double-invoke** — React 18 StrictMode double-mounts in dev; a naively module-scoped `QueryClient` or a `queryFn` with side effects misbehaves. | Low | Client created via `useState(() => createQueryClient())` or stable module scope; `queryFn`s are pure fetches with no side effects. |
| R-10 | **Node-version split** — packages installed under Node 24, gates run under Node 20 (or vice versa), lockfile integrity drifts. | Low | §0.2 — `nvm use 20.20.2` confirmed before Commit 1's install. |

---

## Section 10 — Open inventory questions to verify in-flight

Per the Step-8 §10 shape — questions this plan could not fully resolve from grep alone; each
owning commit's inventory phase answers them:

1. **Commit 2** — do any advertiser pages besides `UserProfile`/`MyClients` write to Supabase?
   Re-grep advertiser write sites.
2. **Commit 3** — does `Events.tsx` perform event-campaign-link *mutations*, or only reads?
   The `.insert` count for `events/` was not separated at plan time.
3. **Commit 4** — is recharge *creation* on a wallet page or only admin-side? Determines
   whether Commit 4 has a `useMutation` or is read-only.
4. **Commit 5** — does any `screens/`-owned page write screens, or are all screen writes on
   `OwnerScreens` (Commit 6) / `admin/ScreenManagement` (Commit 7)? Determines if Commit 5 is
   read-only.
5. **Commit 6** — does the screenhost surface exceed ~12 page rewrites (→ split 6a/6b)?
6. **Commit 7** — does the admin surface exceed ~10 page rewrites (→ split 7a/7b)? Confirm the
   `business_profiles` mutation cluster (recharge approval + user validation + user CRUD) and
   its full invalidation graph.
7. **Commit 8** — which of `NewCampaign.tsx`'s 18 `useEffect`s are genuine server fetches vs
   wizard-state syncs? Only the former migrate; the latter are D2-adjacent client state.
8. **Commit 9** — confirm both bells' exact table-join lists at execution time (the feeds may
   have drifted) and whether the two bells share enough shape for one parameterized hook pair.

---

## Decisions needed — lock these in BEFORE Commit 1 fires

Numbered list for user sign-off. Commit 1 cannot start until D-Q, D-B, D-L, D-M, D-T, D-V are
resolved; D-2..D-8 (per-feature ordering) and D-5, D-K can be confirmed slightly later but are
cleanest decided now.

1. **D-Q — QueryClient default config.** Propose: `staleTime: 30_000` (30 s — most TOODOOH
   data is not real-time; avoids refetch storms), `gcTime: 5 * 60_000` (5 min, the v5
   default), `refetchOnWindowFocus: false` (the app is a dashboard, not a feed —
   focus-refetch would flicker money figures), `retry: 1` (one retry, then surface the error).
   The two bells override `refetchInterval` per-hook. **Confirm or amend.**

2. **D-B — Build-delta tolerances.** Propose: main-bundle gzip one-time **+10..+16 kB** at
   Commit 1 (React Query runtime), then flat ±0.5 kB per feature commit; per-feature chunk
   gzip ±0.5 kB; devtools 0 kB in prod. **Confirm.**

3. **D-L — Lint tolerance.** Propose: end-state lint must remain **≤ 357**; a transient
   pre-autofix `import-x/order` spike of ≤ +5 is routine; anything surviving autofix or any
   non-order rule regressing is a halt. **Confirm.**

4. **D-M — Test-count growth target.** Propose **M ≈ 20** (range 16–26): Commit 1 +1 smoke;
   each feature commit +2–4 (query-key factory + extracted transforms). **Confirm M.**

5. **D-T — Hook test strategy.** Option A (recommended): pure-function tests only — query-key
   factories + extracted transforms, no test-infra change, stays in node env / `.test.ts`.
   Option B: add `@testing-library/react` + `jsdom`, write `renderHook` tests. **Pick A or B.**
   (Plan is written for A; B grows Commit 1 and raises M.)

6. **D-V — DevTools production posture.** Propose: dev-only, `import.meta.env.DEV`-gated lazy
   import, 0 prod bytes. **Confirm** (this is the default; flagged only for explicit sign-off).

7. **D-5 — D5 bell scope.** F-3 found **two** bells, not one. Does D5's "one commit's worth of
   scope" cover both bells in Commit 9 (proposed: yes), and is the implementation **two**
   hook-pairs or **one** parameterized `useNotifications(scope)` pair (proposed: one
   parameterized pair, since both bells share the optimistic-read-rollback shape)? **Decide.**

8. **D-O — Per-feature commit ordering for Commits 2..8.** Proposed:
   advertiser → events → wallet → performances+screens → screenhost → admin → campaigns
   (simplest-isolated first, largest last; bells at Commit 9). **Confirm or reorder.**

9. **D-K — Follow-up issue timing.** File TBD-K (storage) / TBD-L (campaign-relationships) /
   TBD-M (interval dedup) / TBD-N (test-infra, conditional on D-T=A) **pre-emptively before
   Commit 1**, or **at Commit 10** with the audit refresh? Proposed: at Commit 10 (the Step-8
   precedent — follow-ups filed at the audit-refresh commit). **Confirm.**

10. **D-SPLIT — Screenhost/admin commit splitting.** Commits 6 and 7 may each split into a/b
    if inventory shows > ~12 / > ~10 page rewrites. Proposed: decide at each commit's
    inventory phase (§2.4), not now — total commit count lands in the 8–12 range either way.
    **Confirm this is acceptable, or pre-commit to split/no-split now.**

---

## End-state expectations after Commit 10

- `@tanstack/react-query` is the server-state layer for `apps/web`; every migrated read is a
  `useQuery`, every migrated write a `useMutation` with an explicit invalidation graph.
- Zustand holds only client state (auth/admin session coordination — D1; cart — D2).
- Both notification bells run on React Query with a working optimistic-mark-read + rollback;
  the staleness bug is fixed.
- audit §3 "No server-state layer" is resolved into §4; §5 row 10 is ticked.
- Gates: typecheck **55** (unchanged) · lint **≤ 357** · test **~118** (98 + M) · build main
  gzip **≈ 144 kB** (131.47 + ~13 React Query) · file count **≈ 157 + ~20**.
- Service-layer shape is unchanged (D3/D4) — Phase 1 owns the typed-client rewrite.
- Follow-ups TBD-K…N filed.

---

## Plan-review pause

This is a doc commit (CF-6) — committed and pushed immediately, then a CF-9 pause summary with
the GitHub URL. **No code is touched until the user signs off on the Decisions-needed list
(D-Q, D-B, D-L, D-M, D-T, D-V, D-5, D-O, D-K, D-SPLIT) and gives "go" for Commit 1.**
