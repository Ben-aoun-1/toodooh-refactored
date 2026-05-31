# Phase 1h-app-deploy — first VPS application deploy runbook

The reproducible runbook for deploying the Toodooh app stack to a fresh-bootstrapped VPS via the
`deploy.yml` GitHub Actions workflow. It records the first real deploy session (2026-05-31), the
three pre-deploy fixes that the run forced, and the findings — so a future MABA can re-run an
identical deploy and recognise the same failure modes. Pairs with `phase-1h-server-bootstrap.md`
(the VPS provisioning that this builds on).

## Context

- **HEAD** at session start: `48c82e0` (the 1h-server-bootstrap runbook commit). The VPS was
  bootstrapped (Docker 29.5.2 + Compose v5.1.4, `deploy` user key-only + docker-group, `/srv/toodooh`
  owned by `deploy`, UFW 22/80/443, SSH hardened, fail2ban).
- **First real run of `.github/workflows/deploy.yml`** — build on the runner, rsync to the VPS,
  `docker compose up -d --build`, smoke. HTTP-only (TLS deferred to 1h-tls); verified by Host-header
  curl + a browser `/etc/hosts` map (no DNS flip until 1h-flip).
- **Operating pattern:** executor proposes; MABA runs on the VPS / in the GitHub UI; output pasted
  back; halt-on-first-error. The deploy itself runs in CI; the VPS-side diagnosis is MABA-driven.

## Pre-deploy commits (the cascade)

The first dispatch and the browser test forced three commits before the stack ran clean end-to-end:

| Commit | What | Why |
|---|---|---|
| `b8d8775` | **pre-deploy fixes** — D-AD-7 health route `/health`→`/api/health`; D-AD-8 prod compose `build.context ..`→`.`; D-AD-2 `infra/nginx/toodooh-http.conf` (port-80 variant) + compose mount swap | the shipped artifacts assumed a repo-mirroring VPS layout + TLS certs that don't exist yet |
| `9cbeafe` | **Supabase lazy-proxy** + de-dangle of the phantom `database.types` import + CI lint baseline ratchet 1→0 | eager `createClient(VITE_SUPABASE_URL)` at module load crashed every React route in prod |
| `2822435` | **deploy smoke retry** (30×2s = 60s, full `curl -i` on exhaustion) | `compose up -d` returns before the api finishes migrate-on-start; the bare immediate smoke false-failed |

## Unit A — GitHub Secrets

Four repository secrets (Settings → Secrets and variables → Actions) consumed by `deploy.yml`:

| Secret | Value / source |
|---|---|
| `SSH_HOST` | `54.38.26.121` |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | the `deploy` user's private key (paste-only; the public half is in `/home/deploy/.ssh/authorized_keys`) |
| `SSH_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 54.38.26.121` (single line) |

**Verification before relying on it in CI:** `ssh-keygen -y -f ~/.ssh/toodooh-deploy` matched the
VPS `authorized_keys` entry; `ssh -i ~/.ssh/toodooh-deploy deploy@54.38.26.121 'whoami && docker ps'`
returned `deploy` + a docker table (proving key auth + docker-group access, no sudo).

## Unit B — Production `.env`

Hand-created at `/srv/toodooh/.env` (mode 0600, `deploy:deploy`, never in git / never rsync'd). The
authoritative variable contract is `apps/api/src/env.ts` — an eager singleton that crash-loops the
api at boot if any required var is missing or zod-invalid. Notable per the scoping:

- Required (no default): `DATABASE_URL`, `AUTH_SECRET` (≥32), `SMTP_USER`/`SMTP_FROM` (valid email),
  `SMTP_PASSWORD` (≥8), `STORAGE_ENDPOINT` (valid URL), `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`.
- **`STORAGE_BUCKET=storage`** is mandatory (the default `toodooh-documents` breaks the nginx
  `/storage/` path-style proxy).
- **No `MINIO_ROOT_*` vars** — the compose `minio` service derives root creds from
  `${STORAGE_ACCESS_KEY}`/`${STORAGE_SECRET_KEY}` via interpolation from the auto-loaded `.env`.
- HTTP-only phase (D-AD-1): `BETTER_AUTH_URL` / `WEB_ORIGIN` / `STORAGE_ENDPOINT` = `http://too-dooh.com`
  (flip to `https://` at 1h-tls). SMTP placeholders are real-shaped (`no-reply@too-dooh.com`,
  ≥8-char password) so the api boots; email-triggering flows fail until 1h-email.
- Secrets generated locally (`openssl rand -hex 32` for `AUTH_SECRET`, `-hex 16` for db/storage
  passwords) → password manager.

> **KEY FINDING #1 — `.env` twin-value drift.** When one secret must appear in two places — the
> `DATABASE_URL` connection string **and** the standalone `POSTGRES_PASSWORD` — a manual paste is
> error-prone. The first paste put the 64-char `AUTH_SECRET` into `DATABASE_URL`'s password slot
> while `POSTGRES_PASSWORD` got the correct 32-char value, so the api could never authenticate to
> postgres. Caught by a **byte-comparison verify of the two values BEFORE deploy** (not after a
> failed boot). Slice-2 hardening: use Compose `${VAR}` interpolation so the value is defined once
> and referenced in both places.

## Unit C — nginx HTTP variant

Shipped in `b8d8775` (`infra/nginx/toodooh-http.conf`): port-80 only, the full routing of
`toodooh.conf` (`/api`, `/auth`, `/storage` path+host-preserving, `/assets`·`/images`·`/fonts`,
the landing/app SPA split) **minus** the 443 server block, the http→https redirect, and HSTS (which
requires HTTPS). The compose `nginx` mount points here for this phase; it swaps back to
`toodooh.conf` at 1h-tls once `/etc/letsencrypt` is populated.

## Unit D — first `workflow_dispatch`

GitHub UI → Actions → Deploy → Run workflow → `main`. **Workflow conclusion: failure — but
informative.** Every step succeeded through **Deploy (compose up)**; only **Smoke check** failed:

- Gates (typecheck 33 / lint / test / build) → assemble webroot → SSH → rsync → `compose up -d --build`
  all succeeded.
- The bare `curl -fsS .../api/health` returned **HTTP 502** from nginx, because `compose up -d`
  returns before the api finishes its migrate-on-start (~10–30s); the smoke fired immediately. **The
  stack was healthy; the smoke timing was wrong.**

This run **validated the three pre-deploy fixes** even though its conclusion was failure: reaching a
successful `compose up` means D-AD-8 (`build.context .`) resolved the image build on the flat VPS
layout, D-AD-2 (the HTTP variant) let nginx start without certs, and the smoke *reached* the api
(502 = upstream-not-ready, not a 404 routing miss → D-AD-7 `/api/health` is correctly wired). The
infrastructure works; only the smoke fire-and-forget didn't.

## Unit E — diagnosis + the Supabase discovery

The 502 was traced via `docker compose logs api`: **migrations applied successfully** (the
1h-prep §0 hard-halt watch-item — `drizzle/` + `tsx` resolving in the container — validated at
runtime), and the api booted to `Server listening at http://172.18.0.4:4000` ~30s after the smoke
had fired. So the api was fine; the smoke just raced it. (Fix → `2822435`, Unit D redux.)

But the browser test then surfaced a second, separate failure:

> **KEY FINDING #2 — eager Supabase construct crashes the prod React app.** Loading any React route
> (`/login`, `/signup`) in the browser crashed with `Uncaught Error: supabaseUrl is required` at
> `lib/supabase.ts:8`. The Supabase client was constructed **eagerly at module load** via
> `createClient(import.meta.env.VITE_SUPABASE_URL, …)`. Local dev had `VITE_SUPABASE_URL` in
> `.env.local`, masking it; prod has no such var (deliberately), so the constructor throws
> synchronously at module-eval — before React mounts. The static landing was unaffected (it loads no
> React bundle).

Root-caused via grep: **54 `apps/web/src` files** still `import { supabase } from '@/lib/supabase'`.
Per `frontend-repoint-survey.md` §2.3/§2.4, `lib/supabase.ts` is **intentionally kept** until each
later slice migrates its files to `apps/api` — but the construct-on-import pattern was incompatible
with prod's no-env-var state. The eager vector to the main chunk:
`main.tsx → App.tsx → auth.store.ts → auth.service.ts → lib/supabase.ts → createClient → throw`.

**Fix → `9cbeafe`:** a lazy `Proxy<SupabaseClient>` — `createClient` runs only on first property
access, and only if the env vars exist. The boot path never accesses `supabase.*`, so it loads
clean; deferred surfaces fail loudly on use with a descriptive error pointing to survey §2.3.

> **Bonus discovery (audit-model correction).** The standing **lint-1 baseline floor** was a
> dangling import to `./database.types` — a file that **never existed in the repo** (verified via
> `git log --all`), not a Supabase types artifact gated on the last-slice removal as the audit
> (§17/§18 + plan docs) claimed. De-dangled in `9cbeafe`; lint floor genuinely 0, CI baseline
> ratcheted 1→0 in `ci.yml` + `deploy.yml`. Tracked for the 1h-close audit refresh.

## Unit D redux + Unit F — clean deploy + browser verification

Second `workflow_dispatch` (post-`9cbeafe` + post-`2822435`): **clean success end-to-end.** The image
rebuild compiled the lazy-proxy `supabase.ts`; the smoke retry caught the api-boot window and logged
`Smoke OK (attempt N, …s elapsed)`.

**Unit F — browser verify** (MABA, via `/etc/hosts` map
`54.38.26.121 too-dooh.com www.too-dooh.com`, incognito):

- `http://too-dooh.com/` → landing renders.
- `http://too-dooh.com/login` (the canonical auth route; `/` and `/signin` redirect to it) → React
  signin form renders — **no white screen, no `supabaseUrl` error**.
- `http://too-dooh.com/signup` → React signup form renders.

The lazy-proxy fix is **proven in production**. Unit F closed.

## Unit G — production admin seed

Seeded `assistant.ia@too-dooh.com` as `superadmin` / `approved` / `email_verified=true` via the
prod-safe `create-admin.ts` (`docker compose exec -T api …`, password via stdin pipe / `read -rs`,
never argv). Verified via `docker compose exec -T postgres psql … -c "select email,role,status from
users;"`.

> **KEY FINDING #3 — literal-placeholder paste.** A command template with a `<ADMIN_PASSWORD>`-style
> marker was run with the **literal string** `<ADMIN_PASSWORD>` as the password (the substitution
> step wasn't explicit). Detected via the `psql` verify, cleaned up with `DELETE` + re-create using
> a **`read -rs ADMIN_PASSWORD`** pause-for-input (no value in shell history, none on the command
> line). Slice-2 + a methodology note: for any sensitive substitution, prefer the pause-for-input
> pattern (`read -rs`) over an "edit the command before pressing Enter" instruction.

## Final verification state

| Check | Result |
|---|---|
| Services on VPS | postgres + minio **healthy**, api + nginx **running** (`docker compose ps`) |
| `/api/health` | 200, body `{"status":"ok","uptime":N,"timestamp":…,"checks":{"db":"ok"}}` |
| Smoke matrix (Host-header curl) | `/`, `/login`, `/signup`, `/auth/get-session` all return expected responses |
| Browser via `/etc/hosts` | landing + `/login` + `/signup` render clean, no console errors |
| Production superadmin | `assistant.ia@too-dooh.com` in `users` |
| Stack | up, stable |

## Tracked for later (not blocking)

- **1h-tls** — Let's Encrypt DNS-01 (Kais adds the OVH TXT record); then swap the compose mount
  `toodooh-http.conf`→`toodooh.conf`, flip the `.env` schemes to `https://`, redeploy.
- **1h-email** — OVH SMTP creds + SPF/DKIM/DMARC (Kais); replace the SMTP placeholders, redeploy,
  verify Gmail delivery.
- **1h-flip** — point the `too-dooh.com` A record at `54.38.26.121` (the last step).
- **The 54 Supabase-importing files** migrate to `apps/api` per their slice-2+ backend slices (the
  repoint-survey roadmap); when the last goes, `lib/supabase.ts` is deleted.
- **`autoRefreshToken` / persisted-session Supabase auth options** — carry to the last-slice removal.
- **SSH `50-cloud-init.conf` rewrite risk** + **`ubuntu` `NOPASSWD: ALL`** — slice-2 hardening (see
  the server-bootstrap runbook).

## Methodology surfaces (for the 1h-close audit refresh)

Four CF-candidates and three operational learnings from the 1h slice:

1. **Verify EFFECTIVE config on cloud-image hardening** (`sshd -T`), not per-file declared values —
   OpenSSH first-match-wins precedence means later files may not override earlier ones. *(1h-server-bootstrap)*
2. **Training-cutoff priors lose to VPS-reported reality** — the halt-on-anomaly was correct
   discipline; verification via official docs resolved it (Compose v5.1.4 is real). *(1h-server-bootstrap)*
3. **Dev-mode env-var crutches mask prod-shape failures** — modules constructing external clients at
   load via `import.meta.env.VAR` succeed in dev (`.env.local`) and crash in prod. Fix: lazy-init via
   Proxy/thunk. Detection: run a prod-shaped local config (no `VITE_SUPABASE_URL`). *(1h-app-deploy)*
4. **Audit-tracked contingent assumptions stay stale until tested** — the lint-1 floor model ("clears
   at last-slice Supabase removal") was wrong for multiple phases because nobody independently tried
   to clear it; it was a phantom import. When the audit claims "X clears at Y," the Y-refresh should
   verify the X contingency. *(1h-app-deploy)*

Operational learnings:

- **A — `.env` twin-value drift:** detect with a byte-comparison verify pre-deploy; consider Compose
  `${VAR}` interpolation (define once).
- **B — `compose up -d` returns before containers are ready:** the smoke must retry-with-timeout, not
  fire-and-forget.
- **C — sensitive placeholders in command templates:** prefer pause-for-input (`read -rs`) over
  substitute-and-paste.
