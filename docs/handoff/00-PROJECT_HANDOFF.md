# TOODOOH Platform Migration — Project Handoff

**Status as of last session**: Step 5 of the frontend cleanup phase is complete. Step 6 (mechanical lint autofix pass) is the next executable task — the prompt is in `prompt-archive/step-6-lint-autofix.md`.

**How to use this handoff**: Read this doc first, then `02-migration-notes.md`, then the repo's root `CLAUDE.md`, then `03-cleanup-roadmap.md`. Reference `prompt-archive/` and `step-reports/` as needed when I ask about previous decisions. The current state of key files lives in `current-state/`.

---

## 1. Who I am

Mohamed Amine — AI & Vision Systems Founding Engineer at TOODOOH and final-year AI/Software Engineering student at MedTech Tunisia. I'm building this solo, time-constrained, technically strong.

I prefer:
- Decision-forcing questions ("A or B?") over open-ended ones
- Concrete file paths and diffs over abstract descriptions
- Being told I'm wrong directly when I'm wrong
- Surgical commits, scope discipline, plan-first execution
- Honesty over hedging — when you're uncertain, say so

I tolerate being told the architecture is wrong, the timeline is wishful, or the scope is creeping. I do not tolerate sycophantic agreement that lets me ship the wrong thing.

## 2. What TOODOOH is

A two-sided DOOH (Digital Out-of-Home) advertising marketplace, Tunisia-focused, French UI throughout. Three actor types:

- **Screencasters** (advertisers) — build campaigns via a multi-step wizard, choose screens or locations or hourly-grid plans, upload videos, recharge a wallet, receive invoices
- **ScreenHosts** (screen owners) — list digital screens at venues, set unavailability windows, receive revenue and statements
- **Admins / superadmins** — moderate users, validate videos, approve recharges, monitor campaigns, manage events/zones/global config

The product runs on Android TV APKs deployed to physical screens in Tunisian venues (cafés, pharmacies, restaurants). The DOOH calculation engine — impression estimation, hourly grid allocation, location-affluence-weighted pricing — is the real IP and the only part of the existing codebase with unit tests.

## 3. Why this migration exists (hostage situation)

This is not a refactor. It's a hostage extraction.

The codebase was built by an external developer who now holds production access as leverage. Specifically:
- I do **not** have admin access to the live Supabase project
- I do **not** have service-role keys
- I do not control the `itstrategix.tn` domain that the auth flow currently redirects to (that's the developer's domain)
- I likely do not control the Google Play Store account the APK is published under

I have everything **locally** — full frontend source, the APK binary, an OVH hosting snapshot, the database migration history — but operational control sits with someone whose interests are now adversarial.

This dictates the migration sequence and rules out half-measures:

1. **Stay quiet until extraction is done.** No rotated keys, no schema changes, no LinkedIn posts. The day the previous developer realizes I'm migrating is the day they can cut access.
2. **Pull everything pullable while access still works.** This is unfinished — see `02-migration-notes.md`.
3. **Build the new stack in parallel.** Self-hosted Node.js + Postgres + nginx + Docker. No external dependencies that can be revoked.
4. **Cut over the APK first**, then the web app, then lock everything down behind new keys and domains.
5. **Get a lawyer involved before going public.** Formal demand letter for handover of Supabase ownership, source code, domain, email/DNS. Not yet done.

If during work you find yourself thinking "this would be easier if we kept Supabase" — re-read this section. Supabase isn't the problem. Lack of control over Supabase is.

## 4. Target architecture (Phase 1)

Marketplace web app moves to a self-hosted stack. Player APK gets its own backend. Two services, one repo.

| Layer | Pick | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Stable, native fetch, native test runner |
| API framework | Fastify | Faster than Express, typed, plugin model, no architecture imposed |
| ORM | Drizzle | TypeScript-first, schema-as-code, real SQL when needed |
| Auth | Better-auth (self-hosted) | Handles email/password, sessions, reset, verification, MFA — don't roll our own |
| Session model | **Stateful sessions, not JWTs.** | Marketplace handles money; revocability matters more than statelessness |
| DB | Postgres 16 | Same Postgres as Supabase under the hood. Schema ports 1:1. |
| Storage | MinIO | S3-compatible, Dockerized, same SDK as AWS S3 |
| Email | Resend or Postmark | Deliverability for password resets and recharge confirmations. Self-hosted SMTP is a trap. |
| Realtime | Socket.IO (only if needed) | Skip if frontend doesn't currently use Supabase realtime |
| Player streaming | nginx + signed URLs | APK pre-downloads MP4s based on schedule, plays from local cache |
| Migrations | Drizzle Kit | One source of truth |
| Deploy | Docker Compose on a single VPS | Hetzner CX32 holds current scale plus 10x |

Project structure (target — does not exist yet):

```
toodooh-platform/
├── apps/
│   ├── web/              ← current frontend, being cleaned up
│   ├── api/              ← Fastify marketplace backend (not yet created)
│   └── player-api/       ← Node.js service for the APK (not yet created)
├── packages/
│   └── shared/           ← types shared across apps (created as needed)
├── infra/
│   ├── docker-compose.yml
│   ├── nginx/
│   └── sql/              ← migrations (will be reconstructed from Drizzle, not ported)
└── docs/
```

Schema migration carries one mandatory simplification: **collapse the dual identity model into one `users` table with a role enum** (`advertiser | owner | admin | superadmin`). The current schema has `admin_profiles` as a *sibling* of `auth.users`, not a child, and every `validated_by` / `created_by` / `admin_id` FK points at `admin_profiles.id`. This is the root cause of frontend auth complexity and most of the RLS rewrites in the migration history. Do not preserve it.

## 5. Repository state right now

**Two folders on my machine:**

- `~/Desktop/toodooh-web/` — old codebase, read-only source. Already a git repo (mirror of public `github.com/toodooh-source/toodooh`). **Do not modify.** Reference only.
- `~/Desktop/toodooh-platform/` — new monorepo. Private. All work happens here.

**Monorepo setup:**
- pnpm 9 workspaces, Node 20 LTS, TypeScript 5.4+ strict
- ESLint 9 flat config (not the legacy `.eslintrc.cjs`)
- Prettier, Husky pre-commit hook, GitHub Actions CI
- Root files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.npmrc`, `.nvmrc`, `README.md`, `CLAUDE.md`, `.github/`, `.husky/`

**What exists in `apps/web/`:**
- The full imported frontend (React 18 + Vite 7 + TypeScript)
- ~227 files, ~51,700 LOC under `src/`
- Per-route lazy loading is in place (after step 5)
- A new `lib/app-url.ts` helper (after step 4 — the security fix)
- Original code from imported files is otherwise untouched

**What does not exist yet:**
- `apps/api/` (backend) — Phase 1
- `apps/player-api/` (player backend) — Phase 1
- `packages/shared/` — created as needed
- `infra/` — Phase 1
- `docs/migration-notes.md` — should exist; see `02-migration-notes.md` template

## 6. Current state of the frontend (numbers)

**At import time (baseline, before cleanup):**
- 227 files, ~51,657 LOC under `apps/web/src/`
- 12 files over 1000 lines, 34 files over 500 lines
- 938 `console.*` calls, 44 `as any` escapes, 0 `@ts-ignore` / `@ts-expect-error`
- 447 hardcoded `#00B3A6` color literals (brand teal)
- 66 `localStorage.*` calls outside Zustand
- 2 `window.location.reload()` calls in `MyAccount.tsx` — both branches of an `if/else` call `reload()`. Yes, really.

**After steps 1–5 (current state):**
- Typecheck: 310 errors (was 317 — dead-import cleanup cleared 7)
- Lint: 2201 problems / 2174 errors / 27 warnings (was 2249)
- `react-hooks/rules-of-hooks`: 0 (was 20)
- Main bundle: 434 kB gzip 129 kB (was 3,254 kB / 937 kB) — 87% reduction
- 110 chunks total now (was ~5)
- Largest non-main chunk: Dashboard at 608 kB (the god-component)
- Build: passes, dev server starts clean, tests: 3 suites pass, 1 pre-existing import failure

## 7. Known anti-patterns in the codebase

These are the structural problems the cleanup roadmap addresses. Some have already been disproved by direct inspection — the audit (in `01-initial-audit.md`) was right about most things but wrong about two. Both corrections are below.

**Mega-files:**
- `NewCampaign.tsx` — 3,814 lines
- `Dashboard.tsx` — 2,161 lines
- `OwnerSettings.tsx` — 1,704 lines
- `admin/UserManagement.tsx` — 1,388 lines
- `MyCampaigns.tsx` — 1,359 lines

**Dashboard is a god-component router** (not App.tsx — App.tsx is fine). Dashboard internally switches on `useLocation()` and renders one of 7 different pages depending on the URL. 12 routes in App.tsx all render `<Dashboard />`. The Dashboard chunk is 608 kB after lazy-loading; it transitively imports `NewCampaign.tsx`. **Correction from original audit**: I previously claimed App.tsx was a god-router. It isn't; Dashboard is. The bug is one level deeper.

**Page duplicates** (one of each pair must be deleted in step 9, but defer until then — do not silently pick a winner):
- `MyCart.tsx` / `CartPage.tsx`
- `Perfor.tsx` (541 lines) / `OwnerPerformance.tsx` (596 lines)
- `Parcs.tsx` (static mock data, 4 kB) / `OwnerLocations.tsx` (full impl, 19 kB)
- `admin/AdminDashboard.tsx` / `admin/AdminDashboardSimple.tsx`

**Service duplicates:**
- `campaign.service.ts` (1,065 lines) + `campaigns.service.ts` (the singular/plural pair)
- `screens.service.ts` + `services/api/screens.api.ts` (the `.api.ts`-wrapping-`.service.ts` pattern)
- `admin.service.ts` plus six separate `admin-*.service.ts` files with overlapping methods

**Single auth store, plus god-service** (not dual auth stores). **Correction from original audit**: there is exactly one Zustand store, `auth.store.ts`. The complexity isn't a second store; it's a 1,000-line `auth.service.ts` that owns session logic and writes localStorage directly. The fix in step 10 is to extract session logic from the service back into the store — not to collapse two stores.

**Routing guards:** `AdvertiserRoute`, `OwnerRoute`, `PublicRoute` are three near-identical local components inside App.tsx, each with the same loading spinner JSX. Triplicated and worth factoring, but low priority.

**Debug code shipped to prod:** `import './utils/clearAuthCache'` in App.tsx registers `window.clearAuthCache()` for browser-console debugging. Stays for now (step 1 removed only the urgent hooks bug); part of the "delete dead code" pass later.

## 8. Security holes (known but unfixable without service-role access)

These exist in the **live Supabase project**. I cannot fix them because I don't have admin access. They get fixed automatically when Phase 1 replaces Supabase. Do not get distracted trying to mitigate them in the current frontend.

- **`create_business_profile()` RPC** accepts `p_is_admin BOOLEAN` and is `SECURITY DEFINER`. Anyone signing up can self-promote to admin via a network request. Critical.
- **`business_profiles` UPDATE policy** has no column whitelist. Authenticated users can `update business_profiles set is_admin = true where user_id = auth.uid()` from the browser. Critical.
- **Password reset emails redirect to `itstrategix.tn`** — that's the previous developer's domain. **Already fixed in code** (step 2 of cleanup, commit `854f112`), but the Supabase project's redirect allowlist still has `itstrategix.tn` on it. Code now sends users to the right place, Supabase still allows the wrong place.
- **Video upload silently falls back to public URL** when signed-URL generation fails. Private campaign creatives leak on transient backend hiccup.
- **`event-images` storage bucket is fully public** with no path restriction on INSERT.

## 9. Cleanup roadmap (15 steps, current phase)

Full detail with rationale per step is in `03-cleanup-roadmap.md`. Summary:

| # | Task | Status |
|---|---|---|
| 1 | Fix `react-hooks/rules-of-hooks` violations | ✅ Done (commit `bc63fb1`) |
| 2 | Replace hardcoded `itstrategix.tn` redirects | ✅ Done (commit `854f112`) |
| 3 | React.lazy() all routes + code splitting | ✅ Done (commits `95df8a1`, `d80ef19`, `290024a`) |
| 4 | Mechanical lint autofix pass (Prettier + ESLint) | 🔵 **NEXT** — prompt in `prompt-archive/step-6-lint-autofix.md` (named "step-6" because it's the 6th prompt I wrote overall, but it's the 4th cleanup step) |
| 5 | Console removal + pino logger introduction | Pending |
| 6 | a11y pass (label-has-associated-control, click-events-have-key-events) | Pending |
| 7 | Decouple DOOH calculation services from Supabase | Pending |
| 8 | Folder restructure to `features/<domain>/` | Pending |
| 9 | Service deduplication + page-duplicate resolution | Pending |
| 10 | Extract session logic from `auth.service.ts` back into `auth.store.ts` | Pending |
| 11 | Tailwind theming pass (447 `#00B3A6` → `brand` token) | Pending |
| 12 | Dashboard + NewCampaign decomposition (the big one — 1–2 weeks) | Pending |
| 13 | Decompose remaining mega-files (OwnerSettings, UserManagement, MyCampaigns) | Pending |
| 14 | Tsconfig tightening (re-enable `verbatimModuleSyntax`, `noUncheckedIndexedAccess`) | Pending |
| 15 | Hoist duplicate devDeps to root | Pending |

After step 15, the frontend is tractable and Phase 1 (backend extraction) starts. Estimated effort for steps 4–15: **6–10 weeks solo**.

## 10. Decisions already made

Locked decisions, don't relitigate unless I bring them up:

- **Monorepo, pnpm workspaces.** Not Turborepo (overkill at current scale), not Nx.
- **Frontend gets cleaned up in `apps/web/` before any backend work.** No parallel backend development during cleanup.
- **The backend will be Fastify + Drizzle + Better-auth + Postgres + MinIO.** Not NestJS, not Prisma, not Supabase Auth shim.
- **Stateful sessions, cookie-based.** Not JWTs.
- **Authorization is middleware, not row-level policies.** RLS was the wrong abstraction for a single-developer team. Express-style middleware predicates per route.
- **Default exports for page components.** Normalized during step 3.
- **No error boundaries in lazy-loaded routes yet.** Deferred to a UX polish phase. Bare `<Suspense fallback={...}>` is acceptable for now.
- **`#00B3A6` stays hardcoded** until step 11 (Tailwind theming pass). Don't replace it opportunistically.
- **The 4 page-duplicate pairs stay intact until step 9.** Don't silently pick winners.
- **The `clearAuthCache` debug import in App.tsx stays** until the dead-code pass.

## 11. Decisions still open

These need answers, surface them when relevant:

- **APK source code location** — I said I have everything; the previous assistant explicitly asked whether the APK *source* (Android Studio / Kotlin) is accessible to me, separate from the compiled `.apk` in the OVH hosting snapshot. Not yet answered. Determines whether the player gets rebuilt or reverse-engineered.
- **Marketing landing site source** — the OVH snapshot contains a separate marketing site at `www/index.html` whose source code isn't in `toodooh-web`. Unknown location.
- **Lawyer engagement** — advised, not yet acted on. Should happen before Phase 2 (cutover) goes public.
- **Production redirect target for auth** — currently `getAppUrl()` defaults to `window.location.origin`. Will need a real `VITE_PUBLIC_APP_URL` when staging/prod stand up.

## 12. Working methodology

The session model that has worked in practice:

1. I describe the next step or paste a Claude Code report
2. You write a paste-ready prompt for Claude Code
3. I paste it; Claude Code produces a plan
4. I approve, request changes, or ask you to revise
5. Claude Code executes; I paste the structured output back
6. You interpret, calibrate the next step, and write the next prompt

**Conventions established:**
- **Plan first, approve, then execute.** Every non-trivial task starts with a 3–10 bullet plan from Claude Code that I approve before any code changes happen.
- **Surgical commits.** A bug-fix commit fixes exactly the bug — no opportunistic console-removal, no formatting drive-bys, no import reordering. Scope discipline is load-bearing.
- **Conventional Commits.** `fix(auth):`, `refactor(admin):`, `perf(routing):`, `chore:`.
- **`--no-verify` is acceptable** when the pre-commit hook would reformat unrelated lines in an imported (not-yet-Prettier'd) file. After step 4 completes, `--no-verify` should not be needed anymore.
- **Genuine cases requiring redesign** get separate review — never blanket auto-fix complex cases. The "Trivial / Mechanical / Genuine" triage from step 1 is the model.
- **Decision-forcing questions** when calibrating. "A or B?" beats open-ended.

## 13. What's in this handoff folder

```
docs/handoff/
├── 00-PROJECT_HANDOFF.md          ← this doc
├── 01-initial-audit.md            ← the original audit I wrote at the start of the previous conversation
├── 02-migration-notes.md          ← source artifact inventory + hostage status
├── 03-cleanup-roadmap.md          ← the 15-step roadmap, expanded with rationale
├── prompt-archive/
│   ├── step-1-bootstrap.md            ← pnpm monorepo bootstrap
│   ├── step-2-frontend-copy.md        ← copying the old frontend into apps/web/
│   ├── step-3-hooks-fix.md            ← fixing react-hooks/rules-of-hooks (commit bc63fb1)
│   ├── step-4-itstrategix-fix.md      ← env-driven app URL helper (commit 854f112)
│   ├── step-5-lazy-routes.md          ← React.lazy() codemod (commits 95df8a1, d80ef19, 290024a)
│   └── step-6-lint-autofix.md         ← NEXT — Prettier + ESLint --fix pass
├── step-reports/
│   ├── step-1-bootstrap-report.md
│   ├── step-2-frontend-copy-report.md
│   ├── step-3-hooks-report.md
│   ├── step-4-itstrategix-report.md
│   └── step-5-lazy-routes-report.md
└── current-state/
    ├── App.tsx                    ← snapshot of the current apps/web/src/App.tsx
    ├── package.json               ← apps/web/package.json
    └── env-vars.md                ← VITE_* env var inventory
```

## 14. First message to send you when starting

"I'm continuing a project. Read `docs/handoff/00-PROJECT_HANDOFF.md`, then `02-migration-notes.md`, then the root `CLAUDE.md`. Then tell me what you understand of the current state and what you need clarified before we continue with step 6 (the lint autofix pass). Don't start writing prompts yet."

---

End of handoff document.
