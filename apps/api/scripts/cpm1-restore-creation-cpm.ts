import { pathToFileURL } from 'node:url';

import { and, asc, eq, inArray, isNull, lt, ne, notExists, sql as dsql } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { campaignDispatchPlan, campaigns } from '../src/db/schema.js';

// CPM-1 ruling 1A (operator, 2026-09-17) — ONE-OFF data fix, DRY-RUN BY DEFAULT.
//
// Migration 0074 snapshots every existing campaign's CPM, but the database holds no CPM history:
// a classic campaign that was never dispatched (no campaign_dispatch_plan — a draft, a pending or
// a rejected one) is backfilled with the config of the day the migration runs. On prod the
// standard CPM moved 15 → 10 on 2026-09-17 (admin save at 11:08:46 UTC), so the campaigns created
// before that save would keep 10 although they were created at 15. This script puts the
// operator-confirmed rate back on them. Nothing here hard-codes that history: the cutoff and the
// rate are arguments.
//
// Scope, deliberately narrow: classic campaigns (event_id IS NULL) WITHOUT a dispatch plan,
// created strictly before --created-before, whose standard_cpm_tnd differs from --standard-cpm.
// Campaigns with a plan already carry plan.cpm (0074); positionings and event_cpm_tnd are never
// touched; updated_at is preserved (a data correction is not an advertiser edit). The write
// re-checks the same predicate inside one transaction, so a campaign activated between the
// dry-run and --execute is skipped, and a re-run changes nothing.
//
// Usage (prod, after the 0074 deploy):
//   sudo docker compose -f /srv/toodooh/docker-compose.prod.yml exec api \
//     node_modules/.bin/tsx scripts/cpm1-restore-creation-cpm.ts \
//     --created-before 2026-09-17T11:08:46Z --standard-cpm 15        # dry-run
//   … the same command … --execute                                   # write
// Locally: pnpm --filter @toodooh/api cpm1:restore -- --created-before <iso> --standard-cpm <tnd>

const USAGE =
  'usage: cpm1-restore-creation-cpm --created-before <ISO timestamp with Z or offset> --standard-cpm <TND> [--execute]';

// An explicit zone is required: a zone-less timestamp would be read in the machine's own zone.
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// numeric(10, 3): at most 7 integer digits and 3 decimals.
const CPM_RE = /^\d{1,7}(\.\d{1,3})?$/;

export interface RestoreArgs {
  createdBefore: Date;
  /** Normalised to numeric(10, 3)'s text form, e.g. '15.000'. */
  standardCpmTnd: string;
  execute: boolean;
}

export type ParsedRestoreArgs = { ok: true; args: RestoreArgs } | { ok: false; error: string };

const valueAfter = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

export const parseRestoreArgs = (argv: readonly string[]): ParsedRestoreArgs => {
  const before = valueAfter(argv, '--created-before');
  const cpm = valueAfter(argv, '--standard-cpm');
  if (before === undefined || cpm === undefined) return { ok: false, error: USAGE };
  if (!ISO_WITH_ZONE_RE.test(before) || Number.isNaN(new Date(before).getTime())) {
    return { ok: false, error: `--created-before must be an ISO timestamp with a zone: ${before}` };
  }
  if (!CPM_RE.test(cpm) || Number(cpm) <= 0) {
    return {
      ok: false,
      error: `--standard-cpm must be a positive TND amount with at most 3 decimals: ${cpm}`,
    };
  }
  return {
    ok: true,
    args: {
      createdBefore: new Date(before),
      standardCpmTnd: Number(cpm).toFixed(3),
      execute: argv.includes('--execute'),
    },
  };
};

export interface RestoreRow {
  campaignId: string;
  name: string;
  status: string;
  createdAt: Date;
  currentStandardCpmTnd: string;
}

export interface RestoreInventory {
  createdBefore: Date;
  targetStandardCpmTnd: string;
  /** The campaigns --execute would change. */
  rows: RestoreRow[];
  /** In scope but already at the target rate (a re-run, or a campaign created at that rate). */
  alreadyAtTarget: number;
}

/** In scope: a never-dispatched classic campaign created strictly before the cutoff. */
const inScope = (createdBefore: Date) =>
  and(
    isNull(campaigns.eventId),
    lt(campaigns.createdAt, createdBefore),
    notExists(
      db
        .select({ id: campaignDispatchPlan.id })
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, campaigns.id)),
    ),
  );

export const collectCpmRestoreInventory = async (
  createdBefore: Date,
  targetStandardCpmTnd: string,
): Promise<RestoreInventory> => {
  const candidates = await db
    .select({
      campaignId: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      createdAt: campaigns.createdAt,
      currentStandardCpmTnd: campaigns.standardCpmTnd,
    })
    .from(campaigns)
    .where(inScope(createdBefore))
    .orderBy(asc(campaigns.createdAt));
  const target = Number(targetStandardCpmTnd);
  const rows = candidates.filter((c) => Number(c.currentStandardCpmTnd) !== target);
  return {
    createdBefore,
    targetStandardCpmTnd,
    rows,
    alreadyAtTarget: candidates.length - rows.length,
  };
};

/** Writes the inventory's rows (re-checked in one transaction). Returns the ids actually changed. */
export const applyCpmRestore = async (inventory: RestoreInventory): Promise<string[]> => {
  if (inventory.rows.length === 0) return [];
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(campaigns)
      .set({
        standardCpmTnd: inventory.targetStandardCpmTnd,
        updatedAt: dsql`${campaigns.updatedAt}`,
      })
      .where(
        and(
          inArray(
            campaigns.id,
            inventory.rows.map((row) => row.campaignId),
          ),
          inScope(inventory.createdBefore),
          ne(campaigns.standardCpmTnd, inventory.targetStandardCpmTnd),
        ),
      )
      .returning({ id: campaigns.id });
    return updated.map((row) => row.id);
  });
};

// ── CLI (console permitted under scripts/) ────────────────────────────────────────────────────
const printInventory = (inventory: RestoreInventory): void => {
  console.info(
    `CPM-1 restore — classic campaigns without a plan created before ${inventory.createdBefore.toISOString()} → standard CPM ${inventory.targetStandardCpmTnd}`,
  );
  for (const row of inventory.rows) {
    console.info(
      `  ${row.campaignId}  ${row.status.padEnd(9)} created ${row.createdAt.toISOString()}  ${row.currentStandardCpmTnd} → ${inventory.targetStandardCpmTnd}  ${row.name}`,
    );
  }
  console.info(
    `${inventory.rows.length} to change, ${inventory.alreadyAtTarget} already at ${inventory.targetStandardCpmTnd}`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsed = parseRestoreArgs(process.argv.slice(2));
  (async () => {
    if (!parsed.ok) {
      console.error(parsed.error);
      process.exit(1);
    }
    const { createdBefore, standardCpmTnd, execute } = parsed.args;
    const inventory = await collectCpmRestoreInventory(createdBefore, standardCpmTnd);
    printInventory(inventory);
    if (!execute) {
      console.info('DRY-RUN — nothing written. Re-run with --execute to apply.');
      await sql.end();
      process.exit(0);
    }
    const changed = await applyCpmRestore(inventory);
    const skipped = inventory.rows.length - changed.length;
    console.info(
      `done: ${changed.length} changed${skipped > 0 ? `, ${skipped} skipped (activated or edited since the inventory)` : ''}`,
    );
    await sql.end();
    process.exit(0);
  })().catch(async (err: unknown) => {
    console.error('cpm1-restore failed:', err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
}
