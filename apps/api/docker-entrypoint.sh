#!/bin/sh
# Run migrations, then start the API. Fail-fast: a schema-mismatched DB makes better-auth
# behavior undefined, so a migrate failure must abort the container (compose restarts it) rather
# than start the server against a bad schema. `set -e` + the migrate's own non-zero exit enforce it.
set -e

echo "[entrypoint] applying migrations…"
node_modules/.bin/tsx scripts/migrate.ts

echo "[entrypoint] starting api…"
exec node dist/server.js
