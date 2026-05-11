# Frontend Cleanup Roadmap

This document expands the 15-step cleanup roadmap referenced in `00-PROJECT_HANDOFF.md`. Each step has its scope, rationale, dependencies, status, and notes from execution (where applicable).

The phase this document covers is **frontend cleanup**, which precedes backend migration. Goal: get `apps/web/` to a state where the next phases (backend extraction, auth rewrite, deployment) are tractable. Estimated total effort for the unfinished steps: **6–10 weeks solo + Claude Code**.

**Ordering principles:**
1. **Security and correctness first** (steps 1–2): real bugs, runtime crashes, security holes
2. **Performance wins next** (step 3): biggest user-visible improvement before structural work
3. **Mechanical cleanup before structural** (steps 4–6): clear lint noise so structural diffs are readable
4. **Real IP gets isolated** (step 7): make the DOOH calculation engine testable independent of persistence
5. **Restructure on a clean foundation** (steps 8–10): folder layout, service dedup, auth fix
6. **Polish** (step 11): theming
7. **The hard structural work last** (steps 12–13): mega-file decomposition, when everything else is tractable
8. **Tighten and tidy** (steps 14–15): tsconfig hardening, devDep hoisting

---

## Step 1 — Fix `react-hooks/rules-of-hooks` violations ✅ DONE

**Scope:** Resolve all 20 ESLint `react-hooks/rules-of-hooks` errors.

**Why first:** These are real runtime bugs, not style issues. Conditional hook calls violate React's hook-ordering invariant. The affected components can crash with "rendered more hooks than during the previous render" depending on user input or async state hydration. Doing structural refactoring while latent crashes exist makes them harder to attribute.

**Outcome:** All 20 violations were in a single file — `apps/web/src/pages/admin/CampaignMonitoring.tsx`. Single root cause: the super-admin permission guard was placed as an early return *above* all hooks. Since `admin` comes from a Zustand store that hydrates asynchronously, the hook count changed between renders. Fix: all hooks first, then the access-denied guard. Mount effect gated on `admin` so non-privileged paths don't fire admin API calls.

**Commit:** `bc63fb1` — `fix(admin): correct conditional hook calls in CampaignMonitoring`

**Notes:**
- One commit, surgical diff (1 file, +20 −17 lines)
- Lint: 20 → 0 for this rule
- Total lint count: −20 errors (no collateral)
- Pattern is generalizable: every other admin-gated page with hooks may have the same latent bug if the auth store hydrates after first render. Worth a sweep during step 10 (auth-store fix).

---

## Step 2 — Replace hardcoded `itstrategix.tn` redirects ✅ DONE

**Scope:** Replace two hardcoded `https://itstrategix.tn/...` URLs in `auth.service.ts` with an environment-variable-driven base URL.

**Why second:** Security flag, isolated, trivial. Password-reset emails currently send users to a domain TOODOOH doesn't control. Banked as an early win after the runtime bug fix.

**Outcome:** Created `apps/web/src/lib/app-url.ts` with a `getAppUrl(path)` helper. Reads `VITE_PUBLIC_APP_URL` if set, falls back to `window.location.origin`. Throws if neither is available (test imports stay safe; only fires if called without env or window). Two call sites in `auth.service.ts` (signup `emailRedirectTo`, resetPassword `redirectTo`) updated to use the helper. `.env.example` documents the new variable.

**Commit:** `854f112` — `fix(auth): replace hardcoded itstrategix.tn redirect with env-driven app URL`

**Notes:**
- Surgical: 1 import line + 2 call-site changes in `auth.service.ts`, 1 new helper file, 1 `.env.example` addition
- Build, typecheck, lint, test all unchanged
- **Code-side fix only** — the live Supabase project's redirect allowlist still includes `itstrategix.tn`. That's outside this repo and unfixable without admin access. Documented in `02-migration-notes.md` section 2.

---

## Step 3 — React.lazy() all routes + per-route code splitting ✅ DONE

**Scope:** Convert all 41 page components imported in `App.tsx` to lazy-loaded chunks via `React.lazy()`. Add a single `<Suspense fallback>` boundary around the routes. Convert any named-export pages to default exports for clean lazy syntax.

**Why third:** Biggest user-visible win available before structural refactoring. Initial bundle was 3.25 MB including admin code shipped to non-admin users. Vite's tree-shaking + chunking does the heavy lifting once routes are lazy.

**Outcome:**
- Main bundle: **3,254 kB → 434 kB** (gzip 937 → 129 kB). 87% reduction.
- Chunk count: ~5 → 110
- Largest non-main chunk: `Dashboard` at 608 kB (the god-component, expected — its decomposition is step 12)
- Admin code no longer ships to non-admin users
- 1 named-export converted to default (`RechargeManagement`)
- 7 dead imports in `App.tsx` removed (pages that were imported but never rendered as JSX, because the corresponding routes render `<Dashboard />` instead): `NewCampaign`, `MyCampaigns`, `MyInvoices`, `MyClients`, `MyRecharges`, `UserProfile`, `AdminDashboardSimple`. The .tsx files themselves stay until step 9 (page-duplicate resolution).
- Created `apps/web/src/components/PageLoadingFallback.tsx` — bare centered Lucide `Loader` icon, brand color, `min-h-screen`

**Commits:**
- `95df8a1` — `refactor(admin): convert RechargeManagement to a default export`
- `d80ef19` — `feat(ui): add PageLoadingFallback component`
- `290024a` — `perf(routing): lazy-load all route components`

**Notes:**
- No error boundary added — deferred to UX polish phase. Bare Suspense means a failed chunk fetch (stale deploy, offline) will bubble up unhandled.
- Hardcoded `#00B3A6` in `PageLoadingFallback.tsx` — intentional. Tailwind theming pass (step 11) sweeps all 447 occurrences in one consistent pass.
- **Correction from original audit:** I previously claimed App.tsx was a god-component router. It's not — App.tsx is a flat `<Routes>` table. But `Dashboard.tsx` internally switches on `useLocation()` and renders one of 7 different pages depending on the URL. 12 routes in App.tsx all render `<Dashboard />`. That's the real god-component. Step 12 decomposes it.

---

## Step 4 — Mechanical lint autofix pass 🔵 NEXT

**Scope:** One-time Prettier formatting pass across all of `apps/web/src/`, followed by ESLint `--fix` for safe auto-fixable rules (`import-x/order`, `prefer-const`), and then `no-unused-vars` removal with human-review checkpoint.

**Why fourth:** Three reasons:
1. Every commit so far has used `--no-verify` because the pre-commit hook would reformat the entire imported file. That's not sustainable. After this pass, future commits go through hooks normally.
2. Subsequent structural work (steps 8–13) is dramatically easier on lint-clean files — diffs show intent, not formatting churn.
3. It's fast — half a day of mechanical work that clears ~725 lint errors and reformats every file.

**Expected outcome:**
- 3 sequential commits: Prettier formatting (no semantic change), ESLint safe-rules autofix, no-unused-vars removal
- Plus a 4th commit creating `.git-blame-ignore-revs` so `git blame` skips these mechanical commits and shows original authorship
- Lint count: 2201 → ~1450 problems
- Typecheck count: 310 → some lower number (unused-var removal also clears TS6133)
- Post-pass: trivial commits pass the pre-commit hook without `--no-verify`

**Prompt:** `prompt-archive/step-6-lint-autofix.md` (named "step-6" because it's the 6th prompt I wrote overall — the prompt numbering doesn't match the roadmap step numbering, see section 14 of `00-PROJECT_HANDOFF.md`).

**Dependencies:** None. Can run any time after step 3.

---

## Step 5 — Console removal + pino logger introduction

**Scope:** Replace 917+ `console.*` calls with a proper logger (pino). `console.log` becomes `logger.debug` or gets deleted entirely depending on intent. `console.warn` and `console.error` become `logger.warn` / `logger.error`. Side-effect debug imports (`clearAuthCache`) get deleted.

**Why fifth:** Console statements are the largest single category of lint errors (917 of ~2200). Removing them without a logger replacement silently loses error visibility — that's why a blind `eslint --fix` for `no-console` is the wrong move. Need a logger first, then a thoughtful pass.

**Dependencies:**
- Step 4 completed (clean formatting baseline)
- Decision needed: pino-pretty in dev? Log levels by env? Centralized error reporting (Sentry) tie-in?

**Estimated effort:** 1–2 days. Mostly mechanical once the logger is wired in.

**Notes:**
- Don't blindly auto-delete; categorize:
  - **Deletion**: development-only debug logs (`console.log('user', user)`)
  - **Promotion to warn/error**: actual error reporting (`console.error('failed to load', err)`)
  - **Replacement with assert/throw**: dev-only assertions
- pino is the right pick (fast, structured, good ecosystem); no need to debate.
- This step is also when `clearAuthCache` side-effect import in `App.tsx` gets removed.

---

## Step 6 — Accessibility pass

**Scope:** Resolve 281 a11y lint errors:
- `jsx-a11y/label-has-associated-control` (232)
- `jsx-a11y/click-events-have-key-events` (26)
- `jsx-a11y/no-static-element-interactions` (23)
- Plus smaller rules: `media-has-caption` (6), `no-noninteractive-element-interactions` (3)

**Why sixth:** A11y is the next-largest mechanical category after `no-console`. Mostly form labels (`<label htmlFor="...">`) and `<div onClick>` → `<button>` conversions. Some require small JSX restructuring; some are codemod-able.

**Dependencies:** Step 4 completed.

**Estimated effort:** 1–2 days.

**Notes:**
- Form-heavy pages will dominate (signup, profile, settings)
- Some `<div onClick>` patterns may legitimately need keyboard handlers added rather than tag changes (e.g., custom dropdowns)
- Don't blanket-convert; per-file review for anything non-obvious

---

## Step 7 — Decouple DOOH calculation services from Supabase

**Scope:** Extract pure functions from the DOOH calculation services (`dooh-calculation.service.ts`, `dooh-hourly-grid.ts`, `campaign-hourly-location-plan.service.ts`, `dooh-location-affluence-engine.ts`) so the math is independent of the persistence layer. Keep persistence-touching code separate.

**Why seventh:** The DOOH calculation engine is **the real IP of this project**. It's the only part of the codebase with existing tests. But one of those tests (`campaign-hourly-location-plan.service.test.ts`) currently fails at import time because it transitively imports `src/lib/supabase.ts`, which calls `createClient()` at module load. Tests of pure math should not require a Supabase connection. Fixing this:
- Unlocks proper test coverage growth
- Forces the calculation logic to be documented (50–100 undocumented business rules become explicit)
- Makes the calculation engine **portable to the backend** — when Phase 1 starts, the engine moves into `apps/api/` and gets called from there. A coupled engine doesn't move cleanly.

**Dependencies:** Step 4 completed (clean baseline). Order vs steps 8–9 is flexible.

**Estimated effort:** 2–3 days. Most of the time is reading and understanding what the engine does, not the extraction itself.

**Notes:**
- Pure functions in `apps/web/src/services/dooh/` or similar
- Persistence wrappers stay in the existing service files but become thin
- This step also fixes the pre-existing failing test

---

## Step 8 — Folder restructure to `features/<domain>/`

**Scope:** Reorganize `apps/web/src/` from the current flat `pages/` + `services/` + `components/` layout to feature-based:

```
apps/web/src/features/
├── auth/
├── campaigns/      (advertiser side)
├── screens/        (owner side)
├── recharges/
├── admin/
├── dashboard/
└── shared/         (truly cross-feature components, hooks, utils)
```

**Why eighth:** Flat directories make ownership unclear and dependencies tangled. Feature folders make it obvious where new code goes, where shared code lives, and what depends on what. Also sets up Phase 1's backend organization — `apps/api/` will mirror this feature structure.

**Dependencies:** Steps 4–7 completed (clean baseline, calculation engine decoupled). This is invasive — every import path changes. Diffs are noisy. Doing it before lint cleanup makes lint output unreadable.

**Estimated effort:** 3–5 days.

**Notes:**
- One feature at a time, one commit per feature
- Use `tsc --noEmit` aggressively to catch broken imports
- `services/api/screens.api.ts` and similar get resolved into the feature folder during this step

---

## Step 9 — Service deduplication + page-duplicate resolution

**Scope:** Resolve the 4 page-duplicate pairs and the service duplicates:

**Page duplicates** (pick one per pair, delete the other):
- `MyCart.tsx` / `CartPage.tsx`
- `Perfor.tsx` / `OwnerPerformance.tsx`
- `Parcs.tsx` / `OwnerLocations.tsx`
- `admin/AdminDashboard.tsx` / `admin/AdminDashboardSimple.tsx`

**Service duplicates:**
- `campaign.service.ts` (1,065 lines) + `campaigns.service.ts` → merge to one
- `screens.service.ts` + `services/api/screens.api.ts` → unwrap the .api.ts pattern, merge
- `admin.service.ts` + 6 `admin-*.service.ts` files → consolidate into an admin module

**Why ninth:** Cannot be done earlier because each pair needs a real diff comparison and a user decision. Cannot wait until later because mega-file decomposition (step 12) will reference whichever survivor exists.

**Dependencies:** Steps 4, 8 completed. Each duplicate pair is its own mini-decision.

**Estimated effort:** 2–3 days. Most of the time is reading and diffing, not deleting.

**Notes:**
- Per CLAUDE.md: never silently pick a winner. For each pair, produce a 3–5 bullet diff summary, ask which to keep.
- Prod traffic check: if traffic logs are available, confirm which page is actually live before deleting. (Hostage situation — log access uncertain. If unavailable, ask the user which they remember being the one users hit.)
- Check the original developer's contact still works — if reachable, ask them which is canonical before deleting. (Probably not reachable; expect to decide alone.)

---

## Step 10 — Extract session logic from `auth.service.ts` back into `auth.store.ts`

**Scope:** The 1,000-line `auth.service.ts` owns session logic and writes localStorage directly. Pull that responsibility back into the Zustand store, which is the right home for client-side state.

**Why tenth:** Previously framed as "collapse dual auth stores" in the original audit, but there is no dual store — there's one store + a god-service. The actual fix is restoring proper separation of concerns. The service should be stateless API calls; the store owns state and persistence.

**Dependencies:** Steps 4, 8, 9 completed (auth-related services are in their final feature folder and deduplicated).

**Estimated effort:** 2–3 days.

**Notes:**
- This is also when the latent `CampaignMonitoring`-style bug gets swept across other admin-gated pages — pages whose hooks count changes based on auth-store hydration timing. Pattern is the same as step 1.
- Move the 66 direct `localStorage.*` calls in 8 files (`auth.store.ts`, `auth.service.ts`, `clearAuthCache.ts`, `Onboarding.tsx`, `CartPage.tsx`, `Dashboard.tsx`, `NewCampaign.tsx`, `ContactPage.tsx`) into the Zustand persist middleware or onto explicit store actions. No direct localStorage outside the store.

---

## Step 11 — Tailwind theming pass

**Scope:** Replace 447 hardcoded `#00B3A6` literals with a Tailwind theme token. Add the brand color to `tailwind.config.js` as `brand` (or `teal-500`-style alias), update components.

**Why eleventh:** Mechanical, low-risk, but takes a day. Doing it earlier means subsequent commits (steps 5–10) keep re-introducing `#00B3A6` in new code. Doing it once, late, gets every occurrence in one sweep.

**Dependencies:** Steps 4–10 completed.

**Estimated effort:** 1 day.

**Notes:**
- Codemod with care: `text-[#00B3A6]` → `text-brand`, `bg-[#00B3A6]` → `bg-brand`, `border-[#00B3A6]` → `border-brand`, etc.
- Inline `style={{ color: '#00B3A6' }}` gets the same treatment (and we kill the 114 `style={{` occurrences while we're at it)
- Visual regression risk: take screenshots of key pages before/after, eyeball-compare. The brand color appears in icons, buttons, focused states, hover states — all should be identical.

---

## Step 12 — Dashboard + NewCampaign decomposition (the big one)

**Scope:** Decompose two structures:

**Dashboard.tsx (2,161 lines, 608 kB chunk):**
- Internal `useLocation()` switch becomes real `<Route>` entries in App.tsx
- The 7 inline page bodies become real page components in `apps/web/src/features/<domain>/`
- The 12 routes in App.tsx that currently render `<Dashboard />` get pointed at the new real components
- `Dashboard.tsx` either disappears or becomes a thin advertiser-side layout

**NewCampaign.tsx (3,814 lines):**
- The 6-step campaign creation wizard becomes 6 step components in `features/campaigns/new/`
- The Leaflet map, video upload, zone selection, billing all extract into separate components
- The ~80 `useState` calls get consolidated into a wizard state machine (probably useReducer or Zustand-scoped store)

**Why twelfth:** The biggest single piece of structural work in the cleanup. Has to happen last among the structural items because:
1. Everything else needs to be tractable first (lint clean, services deduplicated, auth fixed, folder structure in place)
2. Encoded business rules — pending-state UI, role redirects, recharge approval flow, screen unavailability edge cases — need to be documented as part of this work. Tests added during decomposition force these rules to be written down. Rebuilding the wizard from scratch loses them.

**Dependencies:** Steps 4–11 completed.

**Estimated effort:** **1–2 weeks.** This is the dominant time cost in the entire cleanup phase.

**Notes:**
- One commit per extracted component
- Each step of the wizard becomes its own commit
- Smoke tests added during the work — at minimum, a Playwright integration test for "signup → onboarding → first campaign created"
- The 608 kB Dashboard chunk should disappear after this step (chunks become per-extracted-page)

---

## Step 13 — Decompose remaining mega-files

**Scope:** Apply the step-12 pattern to:
- `OwnerSettings.tsx` (1,704 lines)
- `admin/UserManagement.tsx` (1,388 lines)
- `MyCampaigns.tsx` (1,359 lines)
- Anything else >500 lines that survived the earlier passes

**Why thirteenth:** The Dashboard+NewCampaign decomposition in step 12 sets the pattern. The other mega-files are smaller and follow the same playbook. Doing them after step 12 means we've already discovered the gotchas (state extraction, prop drilling, where to draw component boundaries).

**Dependencies:** Step 12 completed.

**Estimated effort:** 2–3 weeks.

**Notes:**
- Same playbook: one component per file, real hooks, tests added during the work
- May be tempting to skip "good enough" mega-files. Don't. The point of this cleanup phase is that the *next* phase (backend extraction) has tractable code to work against.

---

## Step 14 — Tsconfig tightening

**Scope:** Re-enable the strict TS flags that were temporarily softened during step 2 (the frontend copy):
- `verbatimModuleSyntax: true`
- `noUncheckedIndexedAccess: true`
- `noPropertyAccessFromIndexSignature: true`

Plus a codemod pass to fix the resulting errors (mostly `import type` conversions for `verbatimModuleSyntax`, mostly defensive null checks for the others).

**Why fourteenth:** These flags were softened because the imported codebase would have produced 500+ mechanical errors that drowned out real signal. The structural cleanup is now done; the codebase is in a state where these flags catch real bugs rather than mechanical issues. The in-file comment in `tsconfig.app.json` says: "DO NOT remove these overrides until the tightening phase is scheduled." This is that phase.

**Dependencies:** Steps 4–13 completed.

**Estimated effort:** 1–2 days. Mostly codemod-driven.

**Notes:**
- `import type` conversion is a known codemod, probably `@typescript-eslint`-driven
- `noUncheckedIndexedAccess` errors are real — arrays/objects accessed by index can be `undefined`. Each fix should be a real defensive check, not a `!` non-null assertion.
- After this step, the tsconfig matches the monorepo's `tsconfig.base.json` and the softening overrides come out.

---

## Step 15 — Hoist duplicate devDependencies to root

**Scope:** The imported frontend `package.json` carries devDeps that duplicate root-level deps:
- `eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `typescript-eslint`, `typescript`

Plus `eslint-plugin-react-refresh` is now unused entirely (root config doesn't load it).

Move duplicates to root devDeps, remove from `apps/web/package.json`, ensure pnpm resolves correctly.

**Why fifteenth:** Trivial cleanup-of-cleanup. Not blocking anything; do whenever convenient. Goes last because it has zero impact on Phase 1.

**Dependencies:** Anything.

**Estimated effort:** 1 hour.

**Notes:**
- `pnpm dedupe` may handle some of this automatically
- Verify `pnpm install` resolves cleanly after the change

---

## After step 15

Frontend cleanup phase is complete. Move to Phase 1 (backend extraction).

The first Phase 1 task is the API surface inventory: grep `apps/web/src/` for every `supabase.from(`, `.rpc(`, `.auth.*`, `.storage.*`, and `.channel(` call. Build a spreadsheet. That's the API contract `apps/api/` needs to implement. The frontend is the spec.

---

End of cleanup roadmap.
