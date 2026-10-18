# TOODOOH Platform — Engineering Rules for Claude Code

TOODOOH is a Tunisian DOOH advertising marketplace. **Screencasters** (advertisers) buy airtime on the
TV screens of **Screenhosts** (cafés, restaurants, gyms); the engine dispatches each campaign to venues,
the TV app plays it and sends proofs, settlement pays the owner and bills the advertiser. **Agents**
(Agent Screencaster / Agent Screenhost) recruit both sides for commissions. An internal **hub**
(« wedooh ») turns ESP32 people-counter readings into venue audience.

The platform is in production at https://too-dooh.com and ships features continuously. The old
Supabase frontend is retired; the self-hosted stack below is the only one.

## Repository shape

pnpm monorepo (pnpm 9, Node 20 — use Node 20.20.2 for every git/pnpm command; husky runs lint-staged):

- `apps/api/` — Fastify 5 + Drizzle + Postgres/PostGIS + better-auth, TypeScript. Entry `src/server.ts`.
  - `src/routes/` (~68 route files, all registered in `src/routes/index.ts`), `src/lib/` (domain logic:
    `dispatch/`, `playout/`, `reconcile/`, `event-pricing/`, `event-playout/`, `report/`, …),
    `src/auth/` (better-auth, cookie sessions under `/auth`), `src/storage/` (S3/MinIO, presigned URLs),
    `src/db/schema.ts` (all tables), `src/email/`, `src/simulator/`.
  - Device auth for the TV app: `routes/device-auth.ts` (opaque tokens, 12 h / 90 d).
  - TV WebSocket: `routes/screen-ws.ts` at `/ws/screen` (playlist push, proofs, heartbeats).
  - Hub endpoints: `routes/internal.ts` (`/api/internal/*`, guarded by `WEDOOH_SYNC_KEY`).
  - Background jobs are `start*Job` sweeps + `setInterval`, started in `src/server.ts` after `listen`.
  - Migrations: `apps/api/drizzle/NNNN_name.sql`, **hand-written SQL + a hand-added entry in
    `drizzle/meta/_journal.json`** (snapshots stop at 0065). They run at container start. Never compare
    a `user_role` enum value added in the same migration run (Postgres 55P04) — cast with `::text`.
  - Env: `src/env.ts` is a zod schema parsed at import — every NEW variable must be optional or defaulted.
  - Tests: vitest on a real Postgres (per-worker cloned DBs, `tests/helpers/`), fixtures in `tests/fixtures/`.
    ffmpeg/ffprobe/Chromium tests skip unless `FFMPEG_PATH` / `FFPROBE_PATH` / `CHROMIUM_PATH` are set.
  - Operator scripts: `apps/api/scripts/*.ts` (dry-run by default where they write).
- `apps/web/` — React 18 + Vite 7 + react-router 6 + TanStack Query 5 + Zustand + Tailwind.
  - Feature folders under `src/features/`: `admin`, `advertiser` (screencaster), `agent`, `appointments`,
    `apptv`, `auth`, `campaigns` (the 6-step wizard `NewCampaign` + `pages/new-campaign/Step*.tsx`),
    `cart`, `events`, `profile`, `screenhost` (owner), `screens`, `support`, `wallet`.
  - Routes and role guards in `src/App.tsx`; every page is `React.lazy`.
  - `src/lib/api-client.ts` (relative `/api`, cookies, `ApiError`); `src/lib/feature-flags.ts`
    (compile-time global flags, twin of `apps/api/src/lib/feature-flags.ts`).
  - Tests: vitest runs **only `src/**/*.test.ts`** — there is no render harness, `.test.tsx` never runs.
    Put rules in pure `.ts` libs and test those.
- `infra/` — `docker-compose.prod.yml` (postgres, minio, api, nginx), `docker-compose.yml` (dev:
  postgres + minio), `nginx/` (`toodooh.conf` = too-dooh.com, `wedooh.conf` = hub.too-dooh.com),
  `landing/` (the static landing page served at `/`).
- `docs/` — specs, QA evidence, handoffs, audits.

**Source code never lives at repo root.** Permitted root-level files and directories: `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`,
`.prettierignore`, `.gitignore`, `.git-blame-ignore-revs`, `.npmrc`, `.nvmrc`, `README.md`, `CLAUDE.md`,
`.github/`, `.husky/`, `docs/`. Adding any other root file requires explicit user approval.

## Related repositories (`~/Developer/toodooh/`)

| Repo | What it is | Talks to the platform |
|---|---|---|
| `toodooh-streamer` | Android TV app « Toodooh Streamer » (Kotlin, Media3). `PlaybackService` owns the WS, cadence, proofs, cache; activities only render. | device auth + `/ws/screen`. Caches spots **by playlist entry id (= campaign id)** — a new file under the same id is never re-downloaded. |
| `toodooh-dashboard` | The hub « wedooh » (Node/Express + SQLite, PM2 on the same VPS, hub.too-dooh.com). MQTT sensors → affluence. | calls `/api/internal/*`; serves `/api/sync/*` to `lib/wedooh-sync.ts` |
| `toodooh-mobile` | Screenhost mobile app (Expo). | `/api/device/auth/*`, `/api/screenhosts/*` |
| `toodooh-firmware` | ESP32 Paxcounter fork (people counter), MQTT only. | via the hub |
| `toodooh-desktop` | Windows Electron flasher for the sensors. | none (serial + MQTT) |
| `toodooh-web` | **Legacy** Supabase frontend — reference only. | — |

## Production

One VPS (`ssh ubuntu@too-dooh.com`, compose in `/srv/toodooh`, `sudo docker compose -f docker-compose.prod.yml`).
nginx routes `/api/`, `/auth/`, `/ws/screen` → `api:4000`; `/storage/` → minio; `/downloads/` → APKs;
`/` → landing; everything else → `app.html` (the web SPA). The api image ships ffmpeg/ffprobe and Chromium.

- **Deploy**: `gh workflow run deploy.yml --ref main` (needs a green CI run on that commit), then
  `gh run watch`. Migrations apply on api start. Verify with `/api/health` uptime + read-only queries.
- **Prod database reads are read-only** (`PGOPTIONS="-c default_transaction_read_only=on"`). Any prod
  write, data script, or deploy needs the user's explicit go.

## Non-negotiable rules

1. **TypeScript strict mode is on.** No `any`, no `@ts-ignore`, no `@ts-expect-error`. The only escape is
   `unknown` followed by a real type guard. If you need more, stop and ask.
2. **No `console.*` in committed code.** Use pino (`apps/api/src/logger.ts`, `apps/web/src/lib/logger.ts`).
   `console` is allowed only under `**/scripts/**` and tests.
3. **No `window.location.reload()`.** Fix the state, use router navigation.
4. **No `localStorage` outside Zustand `persist`.**
5. **One concept per file.** Pages over 400 lines are presumed broken; split before growing them.
6. **No new files in repo root.**
7. **Every task ends green**, gates named exactly. CI (`.github/workflows/ci.yml`) counts typecheck errors
   **per package against a baseline** — `api 0`, `web 14` — then lint (0) and tests:

   ```bash
   pnpm --filter @toodooh/api typecheck   # tsc --noEmit -p tsconfig.test.json  (tests INCLUDED)
   pnpm --filter @toodooh/web typecheck   # tsc --noEmit -p tsconfig.app.json   (baseline 14)
   pnpm lint                              # CI lints the ROOT; locally add --ignore-pattern ".claude/**"
   pnpm --filter @toodooh/web test
   pnpm --filter @toodooh/api test        # real Postgres; migrate the test DB first
   ```

   - Never gate `apps/api` with bare `tsc --noEmit` (that skips the tests).
   - Root `pnpm typecheck` carries `--no-bail` on purpose — do not remove it.
   - Assert exit codes, not grepped output. If your gate differs from CI's, say so in the report.
8. **Plan before you act** on non-trivial work: a short numbered plan the user approves (or an explicit
   "go"). Surface decisions as short A/B questions with a recommendation.
9. **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`), the *what* and *why*,
   one logical change per commit. No `Co-Authored-By: Claude` trailer. **Commits stay local until the user
   says push or deploy.**
10. **When uncertain, ask.** Especially: the dispatch/pricing engine, authorization, anything money-adjacent
    (recharges, balances, invoices, settlement, reversements), and the TV playout contract.

## Architecture conventions

- **Web routing**: real `react-router-dom` routes to real pages; every page `React.lazy()`.
- **Web folders**: feature-based under `apps/web/src/features/<domain>/` (pages, components, services,
  hooks with a per-feature `queryKeys.ts`, pure `lib/*.ts` + tests). Shared components in
  `src/components/`, shared hooks in `src/hooks/`.
- **State**: server data through React Query, client state through Zustand. Never mixed.
- **Services**: one service file per domain (`*.service.ts` or `*.api.ts`, not both for one domain).
- **Styling**: Tailwind only, no inline `style={{}}`. Brand colours are theme tokens — `brand-primary`
  (#76E6AB), `brand-deep` (#204B43), `brand-accent` (#9195F8) — never hardcoded hex.
- **Dates**: `date-fns` / `date-fns-tz`; business time is `Africa/Tunis`.
- **One home per rule**: a business rule lives in ONE lib (api or web) and every reader goes through it; when
  the api and web both need it, keep a twin with pinned tests and say so in a comment.
- **New readers of a table**: trace every consumer before changing a shared predicate (demo venues,
  `demo_only`, approved owners, installed screens, in-effect affluence…).
- **TV contract changes**: the streamer ignores unknown playlist fields; anything that needs the TV to act
  differently needs a new APK, and installed TVs update slowly — prefer server-side changes.

## Security notes

- `itstrategix.tn` in auth code is a third-party developer's domain — stop and tell the user.
- Test credentials live only in `apps/api/.env`; never print them. Prod dumps contain PII: delete after use.

## How to work with the user

The user builds this solo and is time-constrained. Prefer short, decision-forcing questions ("A or B?"),
concrete file paths, Conventional-Commits summaries, and honesty about uncertainty. Write user-facing
product text in French. End each task with a one-line summary, the commits made, and flags (skipped
items, things noticed, things needing their attention).
