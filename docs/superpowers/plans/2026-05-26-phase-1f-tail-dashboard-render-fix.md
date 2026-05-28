# Phase 1f tail — OwnerDashboard render fix (shell decouple + Supabase noise kill)

**Phase:** 1f tail (post-F8, pre-phase-close-visual-QA) · **Commit:** small fix · **Date:** 2026-05-26 ·
**HEAD at plan-write:** `6852723` (F8 audit refresh CI-green) · **Floor:** apps/web typecheck 36 /
lint 1 / test 217 / build 135.73; apps/api 146.

**Companion docs.** `docs/audit.md` §17 (Phase-1f close + §17.2 the landing/Figma phase pointer);
this fix is the "post-signin landing must render" tail the architect surfaced after the F8
audit refresh shipped. The full diagnosis the fix consumes lives in the chat (the source-driven
read of OwnerDashboard's 5-hook `||`-aggregate loading gate + the dead Supabase later-slice
hooks); not duplicated here because it's a small fix with a single ratified cause.

**Architect rulings consumed.** **(a) decouple shell from content** (gate the shell on
account-data hooks only — `profileLoading`; let the later-slice widgets render their own
empty states which already exist) · **(c) kill the Supabase auto-refresh noise** (set
`autoRefreshToken: false` + clear stale `sb-*-auth-token` localStorage keys at auth-store
initialize). Ruled OUT: (b) replace with placeholder landing, W3 full JSX render-crash pass,
W4 post-signin-landing redesign (forward-flagged to the landing/Figma phase).

---

## §0 — Pre-flight verification

- **Baseline (post-F8, HEAD `6852723`):** apps/web typecheck 36 / lint 1 / test 217 / build
  135.73 kB; apps/api 146 (CI-verified). The dev server is currently running (background task
  `b82vdgoq0`) — leave it up; the fix is hot-reloadable so MABA can visually verify in the
  same session.
- **Working-tree state:** clean.
- **§0 source-confirm at EXECUTION (CF-22/CF-23 — corrected after the §0 hard-halt):** the
  plan-write inventory was MATERIALLY WRONG (claimed `loading` had only two consumers; source
  has **nine**). The architect ratified the §0 catch and **Option B** (full rename, all 9
  sites). The true map:
  - **`loading` definition** — `OwnerDashboard.tsx:117-118` (NOT 124; plan-write eyeballed —
    content identical, [[verify-line-counts-not-eyeball]]):
    `const loading = profileLoading || sectorsLoading || screensLoading || revenueLoading || notificationsLoading;`
  - **All 9 `loading` consumers** (grep-confirmed):

    | Line | Site | Backing data |
    |---|---|---|
    | 117–118 | definition | — |
    | 149 | alerts `useEffect` early-`return` | `screens` |
    | 206 | alerts `useEffect` **dependency array** `[loading, screens, revenueStats]` | — |
    | 339 | **shell early-return spinner** (the whole-page blocker) | account-layer only |
    | 437 | Revenue card `{loading ? '...' : stats.totalRevenue}` | dead Supabase `revenueStats` |
    | 456 | **Catégorie** `{loading ? '…' : businessSectorName}` | **LIVE — profile + apps/api sectors** |
    | 470 | **Taille du réseau / Zone** `{loading ? '…' : profile.company_size}` | **LIVE — pure profile** |
    | 629 | KPI Revenus cumulés | dead |
    | 651 | KPI Campagnes diffusées (`ownerKpi`) | dead |
    | 663 | KPI Impressions | dead |
    | 677 | KPI Durée totale | dead |

  - **Orphan consequence of Option B:** removing the aggregate orphans three destructured
    loading aliases whose ONLY reference was the aggregate — `sectorsLoading` (`:87`),
    `revenueLoading` (`:91`), `notificationsLoading` (`:98`). Option B MUST also drop those
    three aliases or lint moves off 1 (no-unused-vars). `screensLoading` survives (149+206);
    `profileLoading` survives (→ `accountLoading`).
  - **Advertiser dashboard — checked-and-clear, owner-only.** `AdvertiserDashboard.tsx` (55 ln)
    has NO page-level aggregate gate — renders the shell unconditionally and passes per-slice
    `loading` props to each widget (`<BalanceCard loading={loadingStats}>` etc.). It is ALREADY
    the decoupled shape. Option B converges OwnerDashboard onto this reference impl. No 4th file.
  - `lib/supabase.ts:11` — `autoRefreshToken: true` ✓ (matches).
  - `auth.store.ts:86-93` — `initialize()` has `set({ loading: true, rehydrateError: false });`
    at 87 then the `typeof window !== 'undefined'` admin-skip guard at 90 ✓ (matches). The
    localStorage sweep slots in after 87, before the admin-skip guard.

---

## §1 — Locked constraints

**In this fix:**
- **OwnerDashboard.tsx (Option B)**: replace the 5-hook `||`-aggregate `loading` with
  `accountLoading = profileLoading` and rename ALL 9 consumers (def + shell gate 339 + 7 widget
  branches) to it — so live-data widgets (Catégorie, Taille du réseau) show real values on
  account-resolve and dead-backed widgets show their zero state, neither flashing on unrelated
  dead-backend waits. The alerts useEffect (149) + dep array (206) re-gate on `screensLoading`.
  The 3 loading aliases the aggregate alone referenced (`sectorsLoading`/`revenueLoading`/
  `notificationsLoading`) are dropped from their destructures (else unused-var lint).
- **lib/supabase.ts**: set `autoRefreshToken: false` (the trajectory removes Supabase, so no
  consumer depends on automatic Supabase session refresh going forward).
- **auth.store.ts** (`initialize()`): clear pre-1f stale `sb-*-auth-token` localStorage keys
  on every app load (idempotent — a fresh post-1f user has no such keys; a migrated user does,
  and they're what feed the broken refresh loop).

**Out of this fix (deferred / forward-flagged):**
- Per-widget skeleton loaders for the later-slice widgets (design polish — the architect ruled
  the empty branches are the correct new-screenhost UX: "0 écrans → Ajouter votre premier
  établissement" is honest, not broken).
- Post-signin-landing redesign (forward-flagged to the landing/Figma phase per §17.2).
- Repointing the 3 later-slice hooks (`useScreens` / `useRevenueStats` /
  `useOwnerCampaignApprovals`) — that's the campaigns/screens/wallet slices' work, not this
  fix's. They stay on Supabase per survey §2.3.
- Removing `lib/supabase.ts` itself — survives until the last-slice removal per §17.1.

---

## §2 — Inventory phase (exact edits)

### §2.A — `apps/web/src/features/screenhost/pages/OwnerDashboard.tsx` (Option B — 9-site rename + 3 orphan-alias removals + alerts re-gate)

**Hunk 1a/b/c: drop the 3 orphaned loading aliases** (only the aggregate referenced them; B
removes the aggregate → they'd be unused-var lint errors).

```diff
-  const { data: sectors, isLoading: sectorsLoading, isError: sectorsError } = useSectors();
+  const { data: sectors, isError: sectorsError } = useSectors();
   const { screens, loading: screensLoading, isError: screensError } = useScreens();
   const {
     stats: revenueStats,
-    loading: revenueLoading,
     isError: revenueError,
   } = useRevenueStats(user?.id);
   ...
-  const { campaigns: pendingApprovalCampaigns, loading: notificationsLoading } =
+  const { campaigns: pendingApprovalCampaigns } =
     useOwnerCampaignApprovals(user?.id);
```

**Hunk 2: replace the aggregate with `accountLoading` — line 117-118.**

```diff
   const stats = revenueStats ?? EMPTY_REVENUE_STATS;
-  const loading =
-    profileLoading || sectorsLoading || screensLoading || revenueLoading || notificationsLoading;
+  // Phase-1f tail: shell + ALL widgets gate on account-layer load only (profileLoading →
+  // /api/me, fast). The dead-backend later-slice hooks (screens/revenue/campaigns, survey
+  // §2.3) no longer block render: once the account layer resolves, live-data widgets
+  // (Catégorie, Taille du réseau — profile/sectors) show real values, and dead-backed
+  // widgets (revenue + 4 KPIs) show their honest empty/zero new-screenhost defaults.
+  // Pre-fix this was a `||`-aggregate of all 5 hooks → blocked the whole page on Supabase
+  // queries that error in ~2-5s, presenting as a stuck spinner; AND made the live-data
+  // widgets flash on the unrelated dead waits.
+  const accountLoading = profileLoading;
```

**Hunk 3: re-gate the alerts useEffect — lines 149 + 206.** (The effect derives from `screens`
+ guarded `revenueStats`; gate it on `screensLoading`, not the former aggregate. Dep array
matches.)

```diff
   useEffect(() => {
-    if (loading) return;
+    if (screensLoading) return;
     const generatedAlerts: Alert[] = [];
     // ...
     setAlerts(generatedAlerts.slice(0, 5));
-  }, [loading, screens, revenueStats]);
+  }, [screensLoading, screens, revenueStats]);
```

**Hunk 4: shell early-return gate — line 339.** `if (loading) {` → `if (accountLoading) {`.

**Hunk 5: the 7 widget render branches** — `{loading` → `{accountLoading` at lines 437, 456,
470, 629, 651, 663, 677 (replace_all on the `{loading` token — it matches ONLY these 7 JSX
expressions; the destructure key `loading: profileLoading` at :86 is `loading:` not `{loading`,
so it is untouched).

| Line | Widget | Post-fix behavior |
|---|---|---|
| 437 | Revenue card | `0,000 TND` on account-resolve (dead backend → default) |
| 456 | **Catégorie** | real `businessSectorName` on account-resolve (LIVE) |
| 470 | **Taille du réseau / Zone** | real `profile.company_size`/`zone` (LIVE) |
| 629 | KPI Revenus cumulés | `0` (dead → default) |
| 651 | KPI Campagnes diffusées | `0` (dead → default) |
| 663 | KPI Impressions | `0` (dead → default) |
| 677 | KPI Durée totale | `0` (dead → default) |

**Net for §2.A:** the page shell renders the instant the account layer resolves; the live-data
widgets show real values immediately (no more flashing on unrelated dead waits); the dead-backed
widgets show the honest new-screenhost zero state instead of a permanent `'...'`.

### §2.B — `apps/web/src/lib/supabase.ts` (1 hunk)

```diff
 export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
   auth: {
     persistSession: true,
-    autoRefreshToken: true,
+    // Phase-1f tail: false. The Supabase backend is dead post-keystone (apps/api owns auth);
+    // the auto-refresh loop fires every ~10s against a DNS-dead URL → console wall of
+    // ERR_NAME_NOT_RESOLVED with no consumer benefit. Later slices REMOVE Supabase usage
+    // (won't ADD a dependency on Supabase session refresh), so flipping this off is safe and
+    // durable. Paired with the auth-store stale-session cleanup in initialize() (the source
+    // of what the loop tries to refresh — pre-1f leftover sb-*-auth-token keys).
+    autoRefreshToken: false,
     detectSessionInUrl: true,
   },
 });
```

### §2.C — `apps/web/src/features/auth/stores/auth.store.ts` (1 hunk in `initialize()`)

Add the cleanup as the first action inside `initialize()`, nested under the existing
`typeof window !== 'undefined'` guard pattern (line 90). Idempotent — a fresh post-1f user
has zero `sb-*-auth-token` keys to clear.

```diff
       initialize: async () => {
         set({ loading: true, rehydrateError: false });

+        // Phase-1f tail: clear pre-1f leftover Supabase session keys from localStorage.
+        // Post-keystone the auth store of truth is apps/api (cookie + /api/me); a user who
+        // signed in via Supabase pre-1f has stale `sb-<project-ref>-auth-token` localStorage
+        // entries that feed the Supabase client's (now-disabled, see lib/supabase.ts)
+        // refresh-token loop. Idempotent: a fresh post-1f user has no such keys.
+        if (typeof window !== 'undefined') {
+          for (let i = window.localStorage.length - 1; i >= 0; i--) {
+            const key = window.localStorage.key(i);
+            if (key && /^sb-.+-auth-token(\.|$)/.test(key)) {
+              window.localStorage.removeItem(key);
+            }
+          }
+        }
+
         // Admin identity rides its own store (admin.store, Phase 1g); skip /api/me on admin routes.
         if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
           set({ ...LOGGED_OUT, initialized: true, loading: false });
           return;
         }
```

**The regex `^sb-.+-auth-token(\.|$)`** matches both the canonical Supabase localStorage key
(`sb-<project-ref>-auth-token`) and its `.0` / `.1` chunked-storage variants (Supabase splits
large session payloads across `.N` suffixed keys). Iterates backward (`for i = length-1; i >= 0`)
because `removeItem` shifts indexes — backward iteration is safe under shifting.

### §2.D — Mechanical-vs-judgment classification

All three hunks are **MECHANICAL** — deterministic edits per the ratified design. Per-commit
verification = "did the loading gate switch from 5-hook aggregate to profileLoading? + did the
two config knobs land? + does the dashboard render visually (per MABA's QA)?"

---

## §3 — Commit factoring

**ONE commit.** Three related hunks, one cohesive fix ("make the post-signin landing render
+ stop the dead-backend noise"). Splitting buys nothing (each hunk is small + tightly coupled
to the others — the shell-decouple is the visible fix, the noise-kill is what makes the
diagnosis-via-console-clean possible going forward).

**Commit subject (Conventional Commits):**
`fix(web): Phase-1f tail — render OwnerDashboard with empty later-slice widgets + kill stale Supabase auto-refresh noise`

**No `Co-Authored-By` trailer** (CLAUDE.md rule 9).

---

## §4 — Per-commit verification gates

### §4.A — Expected outcomes

| Gate | Baseline (post-F8) | Post-fix (expected) | Notes |
|---|---|---|---|
| apps/web typecheck | 36 | **36 (flat)** | Pure render-logic + config edits; no type changes |
| apps/web lint | 1 | **1 (flat)** | `database.types` unresolved import unchanged |
| apps/web test | 217 / 29 files | **217 / 29 (flat)** | Zero new tests (per ratified test bar); no test references the modified call sites |
| apps/web build | 135.73 kB gzip | **flat or marginally up** | Adding two short comment blocks + the localStorage scan loop in initialize. The bundle delta is at the noise floor (±0.05 kB) |
| apps/api | 146 (CI-verified) | **untouched** | Zero apps/api files touched |

### §4.B — Verification commands

Run under Node 20.20.2 (`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`).

```
pnpm -F @toodooh/web typecheck
pnpm -F @toodooh/web lint
pnpm -F @toodooh/web test
pnpm -F @toodooh/web build
```

### §4.C — Visual QA (the ratified non-unit gate)

The phase's node-only test-bar + RTL-never-stood-up (§7.6) means **MABA-driven visual QA is
the gate** for this fix:

1. With both apps running (`pnpm dev` already active in task `b82vdgoq0`), Vite hot-reload
   should apply the OwnerDashboard.tsx + auth.store.ts changes automatically; the
   `lib/supabase.ts` change may need a hard reload (Vite proxies it via the React-fast-refresh
   HMR; a full-page reload is safer).
2. **Sign out** (if a session is active) so `initialize()` runs fresh on the next page load
   (the localStorage cleanup needs to fire). Alternatively: open DevTools → Application →
   Local Storage → clear all `sb-*` keys manually + reload (equivalent + faster).
3. **Sign in as a screenhost** (the same user MABA used during the diagnosis).
4. **Expected:** the dashboard renders **immediately** with the shell (greeting, sidebar,
   header, validation pill). The later-slice widgets show their empty states:
   - "Mes établissements" shows the "Ajouter votre premier établissement" CTA.
   - Revenue card shows `0,000 TND`.
   - Notifications card is absent (`latestOwnerNotification === null`).
5. **Console expectations:** the Supabase `ERR_NAME_NOT_RESOLVED` wall is GONE
   (autoRefreshToken: false + the localStorage was cleared). A small handful of one-shot
   Supabase calls from the later-slice queries may still log (they're triggered by the
   queries themselves, not the auto-refresh loop), but they're bounded and fail-fast. The
   2× api/me 401 (pre-signin rehydration) is still expected and benign.
6. **Tossable smoke**: navigate to OwnerSettings, verify the section saves still work
   (Responsable / Entreprise / Adresse / Notifications PATCHes — slice-1 surface that
   should continue working unaffected by this fix).

If the dashboard still shows the spinner / blank / a console error post-fix → halt and
surface (the render-crash candidate (3) the architect ruled to skip would resurface).

---

## §5 — Standing operating procedure

- **CF-6 docs-immediate** for this plan-doc — push the plan commit before the fix commit
  lands (matches the F7a/F7b precedent).
- **CF-7 gate-sweep code-push** for the fix commit. CF-9 → architect approval → push.
- **CF-9 pause-summary** must include: the 3 hunks applied (per-line confirmation); the four
  gates with exact counts; the §4.C visual-QA expectations + what MABA should look at; any
  deviations.
- **CF-22 surface-don't-guess** on any §0/§2 line-number drift.
- **CF-23** — not load-bearing (no library interactions; pure FE config + render edits).
- **Node 20.20.2 PATH prefix** per [[node-20-required-for-commits]].

---

## §6 — Hard-halt conditions

- §0 source-confirm finds different line contents or line numbers than the inventory above.
- §4.A typecheck moves UP (regression) — pure config + render-logic edits shouldn't move it.
- §4.A lint moves off 1.
- §4.A tests change count.
- The dev-server fails hot-reload after the edits (a sign of a TS compile-fail mid-edit).
- §4.C visual QA: dashboard doesn't render even with the fix → the W3 ruled-skip resurfaces
  (architect call: do the JSX render-crash pass at that point).

---

## §7 — Risk register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| The localStorage regex misses a Supabase key variant | Low | Low (cosmetic noise survives) | The regex `^sb-.+-auth-token(\.|$)` is the documented Supabase v2 key format + the chunked-storage suffix; a missed variant just means one more refresh-loop attempt — non-fatal |
| `autoRefreshToken: false` breaks a later-slice flow MABA wants to test today | Low | Low (none are slice-1; campaigns/screens/wallet UI may not function but that's the existing later-slice state regardless) | Architect-ruled durable; the trajectory removes Supabase entirely |
| Removing the aggregate `loading` exposes an UN-renamed consumer | Was REAL (the plan-write inventory undercounted: claimed 2, source had 9) | Low | Caught by the §0 hard-halt; Option B renames ALL 9 + drops the 3 orphaned aliases. Post-edit grep must show zero bare lowercase `loading` except the `:86` destructure key |
| Hot-reload doesn't pick up the supabase.ts change (Vite caching) | Low | Low | MABA does a hard reload (Ctrl+Shift+R) as part of step 1 of the visual QA |
| The 217 tests reference `loading` or the supabase.ts auto-refresh flag somewhere | Very Low | Low | The 217 are all node-level; `OwnerDashboard.tsx` has zero tests (the page is renders-only); `lib/supabase.ts` is mocked in tests anyway |
| A future render-crash candidate (the (3) ruled-skip) resurfaces post-fix | Low | Medium | Halt-on-finding; the architect ruled "if something crashes POST-fix, THEN a targeted JSX read — don't pre-do the 1089-line pass" |

---

## §8 — Cross-references

- **Audit:** `docs/audit.md` §17 records Phase 1f close; this fix is the **phase-1f-tail**
  (the post-signin landing must render — part of "the account system works end-to-end"). The
  fix is recorded in F8's audit-refresh successor (the landing/Figma phase's audit refresh
  will cite it).
- **Architect rulings consumed:** (a) decouple shell from content with the implementation
  nuance ("shell gates on account-data; widgets gate on their own data") · (c) kill the
  noise (both autoRefreshToken: false + stale-localStorage clear).
- **Forward-flagged:** W4 post-signin-landing redesign → the landing/Figma phase per §17.2.

---

## §9 — Carry-forward methodology

**CFs applicable to this fix:**

- **CF-6** docs-immediate for this plan-doc.
- **CF-7** gate-sweep for the code commit.
- **CF-9** pause-summary with the §2 line confirmations + §4 gate results + §4.C QA pointers.
- **CF-22** surface-don't-guess on §0 line drift.

**CF candidates this fix may surface (not promoted):**

- **The "post-signin landing must render" discipline** — phase scope = "the account system
  works end-to-end" includes the user landing on a non-broken page after signin. The F8
  audit shipped before this was verified end-to-end via MABA's QA; the bug (5-hook
  ||-aggregate loading gate blocking on later-slice queries) surfaced at first-visual-QA. The
  pattern: **the visual-QA gate the methodology already named (§7.6 thin-adapter outcome) is
  load-bearing — schedule it BEFORE marking a phase closed**, not after the audit refresh
  ships. Not a new formal CF; an operational note worth recording at landing/Figma audit
  time (the phase-close visual QA was already-scheduled — just earlier than F8 would be
  cleaner next time).

**Cross-references to existing memory:**

- [[design-source-of-truth-consultation]] — the diagnosis read the actual source rather than
  reconstructing from memory.
- [[dead-ui-detection-patterns]] — the "attribute-gated unreachability" 3rd pattern §7.4
  introduced is structurally similar to this fix's "later-slice loading masks the working
  shell" — both are cases where existing-but-blocked render needs surfacing.
- [[node-20-required-for-commits]] — §4.B PATH prefix.

---

## §10 — Files touched

```
M  apps/web/src/features/screenhost/pages/OwnerDashboard.tsx          # Option B: 9-site rename + 3 orphan-alias removals + alerts re-gate (§2.A)
M  apps/web/src/lib/supabase.ts                                       # autoRefreshToken: false (§2.B)
M  apps/web/src/features/auth/stores/auth.store.ts                    # localStorage sb-* sweep (§2.C)
```

**3 files, all `apps/web/src/...`.** No `apps/api`, no lockfile, no test, no docs. The
OwnerDashboard edit is larger than the plan-write estimate (Option B touches 9 rename sites +
3 destructure cleanups) but every edit is mechanical.

---

## Document status

**Drafted, awaiting architect ratification.** Plan covers the dashboard render fix (shell
decouple + Supabase noise kill) per the architect's ratified (a)+(c) direction. No open
judgment calls remain — the implementation nuance (shell gates on `profileLoading` only,
widgets self-gate) is encoded; the localStorage cleanup placement (auth-store
`initialize()`, idempotent, SSR-safe) is encoded; the visual-QA gate is named.

Pending architect approval before opening §0 source-confirm and applying the 3 hunks.
