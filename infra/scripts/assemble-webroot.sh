#!/usr/bin/env bash
# Assemble the single-origin webroot nginx serves: the landing (infra/landing) at /, the app's
# hashed assets merged alongside it, and the app's index.html renamed app.html (the SPA fallback).
# Shared by deploy.yml (production) and infra/staging/deploy.sh. Run from the repo root after
# `pnpm build`.
#
#   infra/scripts/assemble-webroot.sh [out-dir]     (default: www)
set -euo pipefail

out="${1:-www}"
rm -rf "$out"
mkdir -p "$out/assets"
cp -r infra/landing/. "$out/"
cp -r apps/web/dist/assets/. "$out/assets/"
cp apps/web/dist/index.html "$out/app.html"

# The landing and the app share assets/: two files with one name would silently overwrite.
dupes=$(find "$out/assets" -type f -exec basename {} \; | sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "asset filename collision in merged webroot:" >&2
  echo "$dupes" >&2
  exit 1
fi
# RELEASE-1 — the deployed version, readable by scripts at /version.json (the sidebars show the same
# one): {"sha": "<commit>", "built_at": "<ISO instant>"}. Only when the deploy passes APP_VERSION.
if [ -n "${APP_VERSION:-}" ]; then
  printf '{"sha":"%s","built_at":"%s"}\n' "$APP_VERSION" "${APP_BUILT_AT:-}" > "$out/version.json"
fi
echo "assembled $(find "$out" -type f | wc -l | tr -d ' ') files into $out"
