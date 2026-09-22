import { pathToFileURL } from 'node:url';

import { sql } from '../src/db/client.js';
import { isSyncEnabled, listResyncTargets, resyncAllLocations } from '../src/lib/wedooh-sync.js';

// LEARN-1 T1 — the ONE full location re-sync, DRY-RUN BY DEFAULT.
//
// The location payload gained opening_hour / closing_hour (the hub learns only inside a venue's
// hours), but the boot/10-min sweep only re-pushes pending/failed venues. This pushes every approved
// owner's venue once. Run it AFTER the hub's H1 is live (its .strict() receiver 400s the new keys
// before that) and after this deploy is up. Idempotent: the hub upserts on the location UUID, so a
// second run changes nothing.
//
// Usage (prod):
//   sudo docker compose -f /srv/toodooh/docker-compose.prod.yml exec api \
//     node_modules/.bin/tsx scripts/learn1-resync-locations.ts             # dry-run: lists the venues
//   … the same command … --execute                                        # pushes every one
// Locally: pnpm --filter @toodooh/api learn1:resync-locations [-- --execute]

const logger = { info: console.info, warn: console.warn, error: console.error };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const execute = process.argv.slice(2).includes('--execute');
  (async () => {
    if (!isSyncEnabled()) {
      console.error(
        'sync env unset (WEDOOH_INGEST_URL / TOODOOH_SYNC_KEY) — nothing can be pushed',
      );
      await sql.end();
      process.exit(1);
    }
    const targets = await listResyncTargets();
    for (const t of targets) {
      console.info(
        `  ${t.id}  ${t.exportStatus.padEnd(8)}  hours ${t.openingHour ?? '—'} → ${t.closingHour ?? '—'}  ${t.name}`,
      );
    }
    console.info(`${targets.length} location(s) of approved owners`);
    if (!execute) {
      console.info('DRY-RUN — nothing pushed. Re-run with --execute to push every one.');
      await sql.end();
      process.exit(0);
    }
    const report = await resyncAllLocations(logger);
    console.info(
      `done: ${report?.exported ?? 0} exported, ${report?.failed ?? 0} failed (the 10-min sweep retries them), ${report?.skipped ?? 0} skipped`,
    );
    await sql.end();
    process.exit(report !== null && report.failed === 0 ? 0 : 1);
  })().catch(async (err: unknown) => {
    console.error('learn1-resync-locations failed:', err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
}
