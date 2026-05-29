# Phase 1h — deployment prep artifacts

Drafted in **1h-prep** (source-internal, no VPS). These artifacts are verified by inspection + the
CI gates (they exist, lint, format); their **runtime correctness is proven at 1h-app-deploy** — the
first VPS-touching phase. DNS stays at its current target until everything is verified by
`curl -H "Host: too-dooh.com"`; the A-record flip is the last step (1h-flip).

## The artifacts

| File | Purpose |
|---|---|
| `apps/api/Dockerfile` | Multi-stage prod image (node:20-alpine). Builder runs `pnpm build` + `pnpm deploy --prod=false`; runtime keeps `tsx` for the migrate-on-start entrypoint. |
| `apps/api/docker-entrypoint.sh` | `tsx scripts/migrate.ts` (**fail-fast**, `set -e`) then `node dist/server.js`. |
| `infra/docker-compose.prod.yml` | postgres + minio + api + nginx; internal bridge; only nginx publishes 80/443; `env_file: .env`; healthchecks gate startup. |
| `infra/nginx/toodooh.conf` | Single-origin routing: landing at `/`, app SPA fallback (`app.html`), `/api/`+`/auth/` proxy, `/storage/` presign proxy, merged immutable `/assets/`, HTTP→HTTPS, www→apex, the minimal security headers. |
| `infra/nginx/proxy_common.conf` | Shared proxy headers (Host + X-Forwarded-* + cookie passthrough). |
| `.github/workflows/deploy.yml` | `workflow_dispatch` + `v*` tags → gates → build → assemble webroot (+ collision-verify) → rsync → `compose up -d --build` → smoke check. |
| `apps/api/scripts/create-admin.ts` | Prod-safe: password via `ADMIN_PASSWORD` env or piped stdin; never echoed. `--generate-and-print-unsafe` (default off) is local-only. |
| `.github/workflows/ci.yml` | Typecheck baseline ratcheted 51 → 33. |
| `docs/handoff/phase-1h-prep.md` | This README. |

## Single-origin model

`too-dooh.com` serves everything (the same-origin-cookie model the keystone was built for):

- `/` and the landing SPA routes (`/mentions-legales`, `/modalites-tarifaires`,
  `/politique-remboursement`) → the marketing landing (`infra/landing`, assembled to the webroot).
- All other paths → the React app (`apps/web/dist`, served as `app.html`).
- `/assets/` is a **merge** of the landing's and the app's content-hashed files (coexist).
- `/api/*` and `/auth/*` reverse-proxy to the api container (better-auth's catch-all is `/auth/*`).
- `/storage/*` proxies presigned object URLs to minio — **path- and host-preserving** so the
  path-style SigV4 signature validates. The prod bucket is named **`storage`** so the path-style
  URL `https://too-dooh.com/storage/<key>` matches what minio receives.

## Production env (`.env` on the VPS — mode 0600, deploy-user-owned, NOT in git)

```
NODE_ENV=production
PORT=4000  HOST=0.0.0.0
POSTGRES_USER=…  POSTGRES_PASSWORD=…  POSTGRES_DB=toodooh
DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>
AUTH_SECRET=<≥32 random>
BETTER_AUTH_URL=https://too-dooh.com
WEB_ORIGIN=https://too-dooh.com
SMTP_HOST=smtp.mail.ovh.net  SMTP_PORT=465  SMTP_SECURE=true
SMTP_USER=…  SMTP_PASSWORD=…  SMTP_FROM=no-reply@too-dooh.com
STORAGE_ENDPOINT=https://too-dooh.com
STORAGE_ACCESS_KEY=…  STORAGE_SECRET_KEY=…
STORAGE_BUCKET=storage   STORAGE_REGION=us-east-1
```

The create-admin password is **not** in `.env` — it lives only in a password manager (one-time
bootstrap via `ADMIN_PASSWORD=… docker compose … run --rm api tsx scripts/create-admin.ts <email>`).

## GitHub Actions secrets (for `deploy.yml`)

`SSH_PRIVATE_KEY` (the `deploy` user's key), `SSH_HOST` (`54.38.26.121`), `SSH_USER` (`deploy`),
`SSH_KNOWN_HOSTS`.

## The subsequent 1h phases (VPS-touching, each its own commit/run)

1. **1h-server-bootstrap** — create the `deploy` user (key-only auth, minimal perms), install Docker
   + compose, firewall (80/443 + SSH), the `/srv/toodooh` layout.
2. **1h-app-deploy** — first real deploy: `docker compose up --build`, prove the image builds, the
   migrate entrypoint resolves `drizzle/` + `tsx`, the stack is healthy; smoke via `curl -H Host:`.
3. **1h-tls** — Let's Encrypt via **DNS-01** (Kais adds the OVH TXT record); certs land in
   `/etc/letsencrypt`, nginx serves 443.
4. **1h-email** — OVH SMTP verification end-to-end + the domain-reputation warm-up (the Phase-1b
   carry-forward).
5. **1h-flip** — point the `too-dooh.com` A record at `54.38.26.121` (the last step, after
   everything verifies by Host-header).

## Verified-at-deploy, not now

The Docker build, the `pnpm deploy` node_modules layout, the migrate-on-start path resolution, the
nginx presign signature round-trip, and the TLS cert paths are all **proven at 1h-app-deploy** —
green CI here means the artifacts exist + lint + format, **not** that the deploy works.
