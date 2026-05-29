# Phase 1h-prep — production deployment artifacts (source-internal, no VPS)

**Date:** 2026-05-29 · **Phase 1h commit 1 (prep)** · **Companion:** the ratified 1h-prep scoping
CF-9 (D-1h-A…H) · **HEAD:** `c2d1f6a` · **Floor:** apps/web typecheck 33 / lint 1 / test 217 /
build 134.53; apps/api typecheck 0 / lint 0 / test 174.

**Goal.** Draft the production artifact set — a prod docker-compose, the nginx single-origin config,
the api Dockerfile + entrypoint, the GitHub Actions deploy workflow, the create-admin prod-safe
mode, the CI baseline ratchet, and a prep README — **source-internal, no VPS touched** (that's
1h-server-bootstrap). DNS stays put; everything is verifiable by `curl -H Host:` before the flip.

---

## §0 — Source-confirm (CF-23, verified at plan-write)

- **better-auth catch-all = literal `/auth/*`** (`auth/plugin.ts:12`) → nginx proxies **`/auth/`**
  (not `/api/auth/`). The whole auth flow (signin/signout/verify/reset) rides `/auth/*`.
- **S3 presign is path-style** (`s3-storage.ts:40` `forcePathStyle:true`; `getSignedUrl` over
  `GetObjectCommand{Bucket,Key}`, region `STORAGE_REGION`, endpoint `STORAGE_ENDPOINT`). A signed
  URL is **`${STORAGE_ENDPOINT}/${bucket}/${key}?X-Amz-…`**, SigV4 over host + path + query.
- **api boots** `env.HOST:env.PORT` (0.0.0.0:4000), CORS `origin:WEB_ORIGIN credentials:true`,
  graceful SIGTERM/SIGINT (`server.ts`). Build `tsc`→`dist`, run `node dist/server.js`; migrate via
  `tsx scripts/migrate.ts` (**tsx is a devDep — matters for the runtime image, §2.A**).
- **web** `vite build`, **`base` unset → absolute `/assets/*`** (collides with the landing's
  `/assets/*`; `infra/landing/index.html` hardcodes `/assets/index-DViMguIB.{js,css}` + `/images` +
  `/fonts`). The merge is the §3 crux.
- **env contract** (`env.ts`) — the prod var list (§6). `BETTER_AUTH_URL`/`WEB_ORIGIN` default to
  localhost; prod overrides to the single origin.
- **landing already dual-ignored** (eslint `infra/landing/**`, prettier `infra/landing/`); new
  `infra/` + `.github/` files need the same where prettier would touch them (§8).
- **CI baseline stale** — `ci.yml` `TYPECHECK_BASELINE=51` / `LINT_BASELINE=1`; real floor is 33/1
  (the ratchet, D-1h-G).

## §1 — Locked constraints (from the rulings)
- **D-1h-A:** `STORAGE_ENDPOINT=https://too-dooh.com`, **prod `STORAGE_BUCKET=storage`**, path-style;
  nginx `location /storage/` → `minio:9000` **path-preserving + Host-preserving** (signature
  correctness, §3). 20 MB body limit. `:9001` console not published.
- **D-1h-B:** deploy-time webroot assembly (landing `index.html` + app `app.html` + merged
  `/assets/`) with a collision-verify check.
- **D-1h-C:** `/auth/*` proxied alongside `/api/*`.
- **D-1h-D:** api containerized (multi-stage `node:20-alpine`); entrypoint migrate-then-start,
  **fail-fast** on migrate error.
- **D-1h-E:** build-on-runner + rsync + `compose up -d --build`.
- **D-1h-F:** create-admin (a) stdin + (b) `ADMIN_PASSWORD` env; generate-print behind
  `--generate-and-print-unsafe` (default false always).
- **D-1h-G:** ratchet CI baseline 51/1 → 33/1.
- **D-1h-H:** HSTS + nosniff + Referrer-Policy + CSP `frame-ancestors 'none'` (minimal).

## §2 — The artifacts (near-final contents)

### §2.A — `apps/api/Dockerfile` (NEW) + `apps/api/docker-entrypoint.sh` (NEW)
```dockerfile
# Multi-stage: build with the full workspace toolchain, run lean. tsx + drizzle-kit are kept in
# the runtime layer because migrations run via `tsx scripts/migrate.ts` at container start.
FROM node:20-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @toodooh/api... --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter @toodooh/api build      # tsc -> apps/api/dist
RUN pnpm --filter @toodooh/api deploy --prod=false /out   # symlink-free node_modules incl. tsx

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /out/node_modules ./node_modules    # self-contained (has tsx for migrate)
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/package.json ./
COPY --from=builder /repo/apps/api/drizzle ./drizzle     # §0-CORRECTED: migrationsFolder is 'drizzle'
COPY --from=builder /repo/apps/api/scripts ./scripts
COPY --from=builder /repo/apps/api/src ./src             # §0-CORRECTED: migrate.ts imports ../src/env.js
COPY apps/api/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
```
**§0 corrections (caught at pre-flight):** migrations live in `apps/api/drizzle/` (not
`migrations/`); `migrate.ts` resolves `migrationsFolder:'drizzle'` relative to the WORKDIR (`/app`)
and imports `../src/env.js`, so the runtime copies `drizzle/` + the full `src/`; only **tsx** is
needed at runtime (migrate uses `drizzle-orm/postgres-js/migrator`, not drizzle-kit). The actual
image build + the symlink-free `pnpm deploy` layout are **proven at 1h-app-deploy** (not CI).
```sh
#!/bin/sh
# Fail-fast: a schema-mismatched DB makes better-auth behavior undefined (D-1h watch-item).
set -e
echo "[entrypoint] running migrations…"
node_modules/.bin/tsx scripts/migrate.ts
echo "[entrypoint] starting api…"
exec node dist/server.js
```
- **Open sub-point (plan-level):** the runtime copies the full `node_modules` (keeps `tsx`/
  `drizzle-kit` for migrate) — larger image, slice-1-acceptable; a `pnpm deploy --prod` slim +
  compiled-migrate is a later optimization. **Verify at execution:** the exact migrations dir path
  (`apps/api/migrations` vs drizzle-kit's configured `out`) + that `migrate.ts`'s imports resolve
  from the copied layout. Halt-on-finding if the path differs.

### §2.B — `infra/docker-compose.prod.yml` (NEW)
```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    env_file: [.env]
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [internal]
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    restart: unless-stopped
    command: server /data            # NO --console-address publish; console via SSH tunnel
    env_file: [.env]
    environment:
      MINIO_ROOT_USER: ${STORAGE_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${STORAGE_SECRET_KEY}
    volumes: [miniodata:/data]
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [internal]
  api:
    build: { context: .., dockerfile: apps/api/Dockerfile }   # repo root context
    restart: unless-stopped
    env_file: [.env]
    depends_on:
      postgres: { condition: service_healthy }
      minio: { condition: service_healthy }
    networks: [internal]
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on: [api]
    ports: ['80:80', '443:443']
    volumes:
      - ./nginx/toodooh.conf:/etc/nginx/conf.d/default.conf:ro
      - ./www:/srv/toodooh/www:ro                  # the assembled webroot (rsync'd)
      - /etc/letsencrypt:/etc/letsencrypt:ro       # LE certs (1h-tls populates)
    networks: [internal]
volumes: { pgdata: {}, miniodata: {} }
networks: { internal: {} }
```
- Diffs from local compose: adds `api`+`nginx`; `env_file:.env` (not inline creds); minio console
  unpublished; everything on an internal bridge, only nginx publishes 80/443.

### §2.C — `infra/nginx/toodooh.conf` (NEW) — the load-bearing piece
```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {                                   # HTTP → HTTPS (defensive ACME path kept)
  listen 80; server_name too-dooh.com www.too-dooh.com;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://too-dooh.com$request_uri; }
}
server {
  listen 443 ssl; http2 on; server_name www.too-dooh.com;
  ssl_certificate     /etc/letsencrypt/live/too-dooh.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/too-dooh.com/privkey.pem;
  return 301 https://too-dooh.com$request_uri;   # www → apex
}
server {
  listen 443 ssl; http2 on; server_name too-dooh.com;
  ssl_certificate     /etc/letsencrypt/live/too-dooh.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/too-dooh.com/privkey.pem;
  root /srv/toodooh/www;
  client_max_body_size 20m;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Content-Security-Policy "frame-ancestors 'none'" always;
  gzip on; gzip_types text/css application/javascript image/svg+xml application/json; gzip_min_length 1024;

  # API + better-auth (D-1h-C) — Host + forwarded headers + cookie passthrough
  location /api/  { proxy_pass http://api:4000; include /etc/nginx/proxy_common.conf; }
  location /auth/ { proxy_pass http://api:4000; include /etc/nginx/proxy_common.conf; }

  # Object storage presign proxy (D-1h-A) — PATH-PRESERVING (no trailing slash on proxy_pass)
  # + HOST-PRESERVING so the SigV4 signature (signed over host=too-dooh.com, path=/storage/<key>)
  # validates at minio. Bucket is named `storage` so path-style /<bucket>/<key> == /storage/<key>.
  location /storage/ {
    proxy_pass http://minio:9000;            # NO trailing slash → /storage/... forwarded verbatim
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Hashed static — long-lived immutable
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; try_files $uri =404; }
  location /images/ { expires 30d; try_files $uri =404; }
  location /fonts/  { expires 1y; add_header Cache-Control "public, immutable"; try_files $uri =404; }

  # Landing SPA — apex + its client routes → landing index.html
  location = /                      { try_files /index.html =404; }
  location = /mentions-legales      { try_files /index.html =404; }
  location = /modalites-tarifaires  { try_files /index.html =404; }
  location = /politique-remboursement { try_files /index.html =404; }

  # Everything else → the React app SPA fallback (app.html, references its own /assets/<hash>)
  location / { try_files $uri /app.html; }
}
```
Plus `infra/nginx/proxy_common.conf` (NEW): `proxy_set_header Host $host; proxy_set_header
X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_http_version 1.1; proxy_set_header Connection "";`.
- **Verify at execution (watch-item):** the landing bundle loads only its own `/assets` +
  `/images` + `/fonts` (no third-party iframe/script) → `frame-ancestors 'none'` won't break it
  (it doesn't — the index.html is self-contained). Confirm by reading the landing's JS origin refs.

### §2.D — `.github/workflows/deploy.yml` (NEW)
```yaml
name: Deploy
on:
  workflow_dispatch:
  push: { tags: ['v*'] }
jobs:
  deploy:
    runs-on: ubuntu-latest
    env: { <the same gate env block as ci.yml> }
    services: { postgres: <same as ci.yml> }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20.20.2, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - <Start MinIO, Migrate, Typecheck/Lint baseline-gated, Test — reuse ci.yml steps>
      - run: pnpm build                               # apps/api dist + apps/web dist
      - name: Assemble webroot (D-1h-B)
        run: |
          mkdir -p www/assets
          cp -r infra/landing/* www/                  # landing index.html + assets + images + fonts
          cp -r apps/web/dist/assets/* www/assets/     # merge app hashed assets into the same dir
          cp apps/web/dist/index.html www/app.html     # app SPA entry, renamed
          # collision-verify: no duplicate basenames across the merged assets
          test -z "$(find www/assets -type f -printf '%f\n' | sort | uniq -d)"
      - name: Rsync to VPS
        run: rsync -az --delete www/ infra/docker-compose.prod.yml infra/nginx/ apps/api/ \
             ${SSH_USER}@${SSH_HOST}:/srv/toodooh/   # .env + volumes stay on the VPS
      - name: Deploy
        run: ssh ${SSH_USER}@${SSH_HOST} 'cd /srv/toodooh && docker compose -f docker-compose.prod.yml up -d --build'
      - name: Smoke check
        run: |
          ssh ${SSH_USER}@${SSH_HOST} 'curl -fsS -H "Host: too-dooh.com" http://localhost/api/health'
          # + a landing route + an app route (pre-DNS: Host header + localhost)
```
- Secrets: `SSH_PRIVATE_KEY` / `SSH_HOST` / `SSH_USER` / `SSH_KNOWN_HOSTS`. The rsync layout +
  the exact ssh-key setup steps are finalized in the plan; the `.env` and volumes are never synced.

### §2.E — `apps/api/scripts/create-admin.ts` (MOD — D-1h-F)
- Read the password in priority order: **`ADMIN_PASSWORD` env (b)** → else **stdin (a)** (when piped)
  → else require `--generate-and-print-unsafe` (default false) to generate+print (local only).
  Never echo the password otherwise. The existing argv-password path is **removed** (it leaked).
  Keep the email/name args. Add 1-2 vitest cases (env-mode sets the password; missing-input without
  the unsafe flag exits non-zero) → apps/api test 174 → ~176.

### §2.F — `ci.yml` baseline ratchet (MOD — D-1h-G)
`TYPECHECK_BASELINE=51` → **33**; `LINT_BASELINE=1` → **1** (unchanged — `database.types` floor).
One-line each + update the explanatory comment.

### §2.G — `docs/handoff/phase-1h-prep.md` (NEW, README)
Documents the artifact set, the prod env-var list, the deploy flow, the subsequent 1h phases, and
the manual one-time steps (VPS bootstrap, .env population, DNS-01, DNS flip).

### §2.H — dual-ignores (MOD — §8)
`eslint.config.js` `ignores`: add `infra/docker-compose.prod.yml`, `infra/nginx/**`,
`apps/api/docker-entrypoint.sh` (non-JS, but defensive). `.prettierignore`: add `infra/nginx/` +
the entrypoint + the Dockerfile (prettier shouldn't reflow the `.conf`/Dockerfile). `.github/
workflows/deploy.yml` is YAML — prettier formats it (fine; let it). **Gate with ROOT `pnpm lint`
before push** ([[root-lint-vs-scoped]], [[lint-staged-baseline-blocker]]).

## §3 — env / secrets (the prod `.env`, VPS-only, 0600, not in git)
```
NODE_ENV=production
PORT=4000  HOST=0.0.0.0
DATABASE_URL=postgresql://<user>:<pass>@postgres:5432/<db>     # internal host = service name
POSTGRES_USER=…  POSTGRES_PASSWORD=…  POSTGRES_DB=toodooh
AUTH_SECRET=<≥32 random>
BETTER_AUTH_URL=https://too-dooh.com
WEB_ORIGIN=https://too-dooh.com
SMTP_HOST=smtp.mail.ovh.net  SMTP_PORT=465  SMTP_SECURE=true
SMTP_USER=…  SMTP_PASSWORD=…  SMTP_FROM=no-reply@too-dooh.com
STORAGE_ENDPOINT=https://too-dooh.com
STORAGE_ACCESS_KEY=…  STORAGE_SECRET_KEY=…
STORAGE_BUCKET=storage   STORAGE_REGION=us-east-1
```
Populated manually at first deploy (MABA SSHes in); backed up to a password manager. The
create-admin password lives **only** in the password manager (never in `.env`).

## §4 — Test bar + gates
- New tests: the 2 create-admin mode tests (apps/api 174 → ~176). No apps/web change.
- Gate expectations: apps/web **flat** (33/1/217/134.53); apps/api typecheck **0** / lint **0** /
  test **~176** / build success. The deploy workflow + compose/nginx/Dockerfile are **not** executed
  by CI (no VPS) — they're artifacts; the gate verifies the repo still builds + lints (ROOT lint
  catches the new infra/.github files).

## §5 — Hard-halt conditions
- §0 drift (the auth path, the S3 signing config, the migrations dir layout).
- ROOT lint flags a new infra/.github file (dual-ignore gap) — fix before push.
- The migrate-tooling path (tsx-in-runtime) doesn't resolve from the Dockerfile layout — surface.
- typecheck/lint regress past 33/1; apps/web moves.

## §6 — Sub-factoring
**ONE commit (1h-prep).** Subject: `chore(infra): Phase-1h prep — prod compose + nginx + api
Dockerfile + deploy workflow + create-admin prod-safe + CI baseline ratchet`. No `Co-Authored-By`.
Then the VPS phases: 1h-server-bootstrap → 1h-app-deploy → 1h-tls → 1h-email → 1h-flip.

## §10 — Files touched
```
A  apps/api/Dockerfile
A  apps/api/docker-entrypoint.sh
M  apps/api/scripts/create-admin.ts                 # prod-safe modes + test
A  apps/api/tests/create-admin.test.ts (or extend)  # 2 mode cases
A  infra/docker-compose.prod.yml
A  infra/nginx/toodooh.conf
A  infra/nginx/proxy_common.conf
A  .github/workflows/deploy.yml
M  .github/workflows/ci.yml                          # baseline 51→33
M  eslint.config.js                                  # dual-ignore new infra files
M  .prettierignore                                   # dual-ignore new infra files
A  docs/handoff/phase-1h-prep.md                     # the prep README
```
~12 files; mostly net-new infra. No apps/web change; apps/api only gets create-admin + the Dockerfile/entrypoint.

## §11 — Status
Drafted, awaiting ratification. Source-internal; no VPS. On ratification: apply → ROOT gate-sweep
(typecheck/lint/test/build) → CF-9 → push. The configs are verified by inspection + the gates;
real-VPS verification is 1h-server-bootstrap onward.
