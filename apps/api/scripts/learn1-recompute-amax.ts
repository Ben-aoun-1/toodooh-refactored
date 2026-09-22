import { pathToFileURL } from 'node:url';

import { asc, eq } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { screenhostAmax, screenhosts } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { AMAX_FALLBACK_PPH, measuredAmaxPph } from '../src/lib/event-pricing/pricing.js';

// LEARN-1 F1 (spec §9, operator-approved) — ONE-TIME reset of the A_max ratchet, DRY-RUN BY DEFAULT.
//
// screenhost_amax ratchets UP only, and every stored value came from the typical-week grid (4-week
// means and typed values, closed hours included). Under LEARNED_AFFLUENCE_ENABLED A_max is the
// highest hour ever MEASURED inside opening hours (measuredAmaxPph), so this rewrites every venue's
// stored value to that — which CAN LOWER a venue's event price (approved). A venue with no measured
// hour loses its row and prices at the unpersisted 50: storing 50 would ratchet over its first real,
// lower peak. Every venue is printed before → after.
//
// --execute is REFUSED while the flag is off: computeAmax's grid path would ratchet the old maxima
// straight back on the next read. Run it right AFTER the toodooh flip (spec §6 step 6).
//
// Usage (prod):
//   sudo docker compose -f /srv/toodooh/docker-compose.prod.yml exec api \
//     node_modules/.bin/tsx scripts/learn1-recompute-amax.ts            # dry-run
//   … the same command … --execute                                     # write
// Locally: pnpm --filter @toodooh/api learn1:recompute-amax [-- --execute]

export interface AmaxRecomputeRow {
  screenhostId: string;
  name: string;
  /** The stored screenhost_amax value, or null when the venue has no row. */
  before: number | null;
  /** The measured peak when > 0; null = no row (the venue prices at the unpersisted fallback). */
  after: number | null;
}

export const isChange = (row: AmaxRecomputeRow): boolean => row.before !== row.after;

/**
 * What the venue's event PRICE does, not its stored row: a missing row prices at the unpersisted
 * fallback, so compare `before ?? 50` with `after ?? 50` (a stored 30 reset to no row RAISES the
 * price to 50; no row → a measured 40 LOWERS it from 50). The operator reviews the dry-run by this.
 */
export const priceMove = (row: AmaxRecomputeRow): 'LOWER' | 'RAISE' | 'SAME' => {
  const before = row.before ?? AMAX_FALLBACK_PPH;
  const after = row.after ?? AMAX_FALLBACK_PPH;
  return after < before ? 'LOWER' : after > before ? 'RAISE' : 'SAME';
};

/** Every screenhost, by name, with its stored and recomputed A_max. Reads only. */
export const collectAmaxRecompute = async (): Promise<AmaxRecomputeRow[]> => {
  const venues = await db
    .select({
      screenhostId: screenhosts.id,
      name: screenhosts.name,
      stored: screenhostAmax.amaxPph,
    })
    .from(screenhosts)
    .leftJoin(screenhostAmax, eq(screenhostAmax.screenhostId, screenhosts.id))
    .orderBy(asc(screenhosts.name), asc(screenhosts.id));
  const rows: AmaxRecomputeRow[] = [];
  for (const venue of venues) {
    const peak = await measuredAmaxPph(venue.screenhostId);
    rows.push({
      screenhostId: venue.screenhostId,
      name: venue.name,
      before: venue.stored ?? null,
      after: peak > 0 ? peak : null,
    });
  }
  return rows;
};

/** Writes the changed rows in ONE transaction (upsert `after`, or delete). Returns how many. */
export const applyAmaxRecompute = async (rows: readonly AmaxRecomputeRow[]): Promise<number> => {
  const changes = rows.filter(isChange);
  if (changes.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const row of changes) {
      if (row.after === null) {
        await tx.delete(screenhostAmax).where(eq(screenhostAmax.screenhostId, row.screenhostId));
      } else {
        await tx
          .insert(screenhostAmax)
          .values({ screenhostId: row.screenhostId, amaxPph: row.after })
          .onConflictDoUpdate({
            target: screenhostAmax.screenhostId,
            set: { amaxPph: row.after, updatedAt: new Date() },
          });
      }
    }
  });
  return changes.length;
};

/** A reason to refuse --execute, or null. Off, computeAmax would ratchet the grid max back. */
export const executeRefusal = (learnedAffluence: boolean): string | null =>
  learnedAffluence
    ? null
    : 'LEARNED_AFFLUENCE_ENABLED is off — flip it first: with the flag off, computeAmax ratchets the grid maxima straight back on the next read.';

// ── CLI (console permitted under scripts/) ────────────────────────────────────────────────────
const show = (value: number | null): string =>
  value === null ? `— (fallback ${AMAX_FALLBACK_PPH}, not stored)` : String(value);

const tag = (row: AmaxRecomputeRow): string => {
  if (!isChange(row)) return '';
  const move = priceMove(row);
  return move === 'SAME' ? '  CHANGE (same price)' : `  ${move}`;
};

const printInventory = (rows: readonly AmaxRecomputeRow[]): void => {
  console.info('LEARN-1 F1 — A_max = the highest hour ever MEASURED inside opening hours');
  console.info(
    `LEARNED_AFFLUENCE_ENABLED is ${env.LEARNED_AFFLUENCE_ENABLED ? 'ON' : 'OFF — --execute will be refused'}`,
  );
  for (const row of rows) {
    console.info(
      `  ${row.screenhostId}  ${show(row.before)} → ${show(row.after)}${tag(row)}  ${row.name}`,
    );
  }
  console.info(
    `${rows.filter(isChange).length} to change, ${rows.filter((r) => !isChange(r)).length} unchanged`,
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const execute = process.argv.slice(2).includes('--execute');
  (async () => {
    const rows = await collectAmaxRecompute();
    printInventory(rows);
    if (!execute) {
      console.info('DRY-RUN — nothing written. Re-run with --execute to apply.');
      await sql.end();
      process.exit(0);
    }
    const refusal = executeRefusal(env.LEARNED_AFFLUENCE_ENABLED);
    if (refusal !== null) {
      console.error(refusal);
      await sql.end();
      process.exit(1);
    }
    console.info(`done: ${await applyAmaxRecompute(rows)} venue(s) rewritten`);
    await sql.end();
    process.exit(0);
  })().catch(async (err: unknown) => {
    console.error('learn1-recompute-amax failed:', err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
}
