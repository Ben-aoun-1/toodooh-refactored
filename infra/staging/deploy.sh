#!/usr/bin/env bash
# Deploy the current checkout to the STAGING box (the testing environment). RELEASE-1 (2026-10-26,
# Q3 A): staging only ever runs a commit of main, and only deploy.yml (target=staging) records it as
# the « ran on staging » proof production requires — a local run of this script leaves NO record and
# must not be used to stage a release. Run from the repo root by deploy.yml:
#
#   STAGING_SSH=deploy@141.95.52.165 STAGING_APP_HOST=… STAGING_HUB_HOST=… infra/staging/deploy.sh
#
#   SKIP_BUILD=1   reuse an existing `pnpm build` (deploy.yml has already built)
#
# Same shape as the production deploy: build → assemble the webroot → rsync flat into /srv/toodooh
# → compose up → restart nginx (it resolves the api upstream once, at start) → smoke over HTTPS.
# The box's .env and volumes are never synced; local .env files are excluded from the rsync.
set -euo pipefail

: "${STAGING_SSH:?set STAGING_SSH (e.g. deploy@141.95.52.165)}"
: "${STAGING_APP_HOST:?set STAGING_APP_HOST (the app hostname)}"
: "${STAGING_HUB_HOST:?set STAGING_HUB_HOST (the hub hostname)}"
SSH_OPTS="${SSH_OPTS:-}"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  pnpm install --frozen-lockfile
  VITE_HUB_URL="https://${STAGING_HUB_HOST}" pnpm build
fi

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
infra/scripts/assemble-webroot.sh "$stage/www"
mkdir -p "$stage/nginx-staging"
cp -r infra/staging/nginx/. "$stage/nginx-staging/"
cp infra/staging/docker-compose.yml "$stage/docker-compose.staging.yml"

# shellcheck disable=SC2086
rsync -az --delete -e "ssh $SSH_OPTS" \
  --exclude node_modules --exclude dist --exclude coverage --exclude .vite \
  --exclude '.env' --exclude '.env.*' \
  "$stage/www" "$stage/nginx-staging" "$stage/docker-compose.staging.yml" \
  infra/nginx \
  apps \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  "${STAGING_SSH}:/srv/toodooh/"

# shellcheck disable=SC2086
ssh $SSH_OPTS "$STAGING_SSH" \
  'cd /srv/toodooh && docker compose -f docker-compose.staging.yml up -d --build --remove-orphans && docker compose -f docker-compose.staging.yml restart nginx'

for i in $(seq 1 45); do
  body=$(curl -sS --max-redirs 0 --max-time 10 "https://${STAGING_APP_HOST}/api/health" || true)
  if echo "$body" | grep -q '"status":"ok"'; then
    echo "staging smoke OK (attempt $i): $body"
    exit 0
  fi
  sleep 2
done
echo "staging smoke FAILED after 90 s — last response: $body" >&2
exit 1
