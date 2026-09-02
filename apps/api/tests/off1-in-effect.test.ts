import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhostAffluence, screenhosts, users } from '../src/db/schema.js';
import { computeAmax } from '../src/lib/event-pricing/pricing.js';
import { loadBackupGrid } from '../src/lib/period-audience-source.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// OFF-1 — `in_effect = false` SUSPENDS a manual typical-week cell without deleting it.
//
// It exists because POST /api/internal/affluence is latest-value-wins with NO delete: a hub that
// simply stopped sending a suspended cell would FREEZE its last pushed value here forever, still
// feeding dispatch, C_max, A_max and monthly audience. A reversible flag, not a tombstone.
//
// EVERY reader treats false as ABSENT, and the filter runs BEFORE the hour-collapse. That ordering
// is the whole point of this file: `collapseHalvesSql` averages an hour's two halves, so filtering
// AFTERWARDS would still carry half of a value the rule says does not exist.

let seq = 0;
const seedVenue = async (): Promise<string> => {
  seq += 1;
  const values: NewUser = {
    email: `off1-${seq}@example.com`,
    contactName: `Owner ${seq}`,
    role: 'individual_owner',
    status: 'approved',
  };
  const [owner] = await db.insert(users).values(values).returning();
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `OFF1 venue ${seq}`, ownerId: owner?.id ?? '' })
    .returning();
  return sh?.id ?? '';
};

/** One typical-week cell, addressed by SLOT. `inEffect` null = unknown = in effect. */
const seedCell = async (
  screenhostId: string,
  slot: number,
  value: number,
  inEffect: boolean | null,
): Promise<void> => {
  await db.insert(screenhostAffluence).values({
    screenhostId,
    dayOfWeek: 1, // Monday
    hour: Math.floor(slot / 2),
    slot,
    estimatedImpressions: value,
    source: 'backup',
    inEffect,
  });
};

describe('OFF-1 — a suspended manual cell is ABSENT for every reader (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('the BackupGrid never sees it — `has` stays false, so rule 3 cannot reach it', async () => {
    const venue = await seedVenue();
    await seedCell(venue, 26, 50, true); // 13h00 — in effect
    await seedCell(venue, 27, 56, false); // 13h30 — SUSPENDED (Mejri's cell)

    const grid = await loadBackupGrid(venue);
    expect(grid.has[0]?.[26]).toBe(true);
    expect(grid.values[0]?.[26]).toBe(50);
    expect(grid.has[0]?.[27]).toBe(false); // absent, not zero
    expect(grid.values[0]?.[27]).toBe(0);
  });

  it('unknown (NULL) and true both stay IN EFFECT — the flag is inert until the hub sends it', async () => {
    const venue = await seedVenue();
    await seedCell(venue, 26, 50, null); // every row written before 0067
    await seedCell(venue, 28, 70, true);

    const grid = await loadBackupGrid(venue);
    expect(grid.has[0]?.[26]).toBe(true);
    expect(grid.has[0]?.[28]).toBe(true);
  });

  // ── THE ORDERING PIN ──────────────────────────────────────────────────────────────────────
  //
  // The two halves DIFFER on purpose. With a matched pair (56 and a suspended 56) the mean is 56
  // either way and the test would pass whether the filter ran before or after the collapse — it
  // would assert nothing. Here the answer is 56 if the suspended half never entered the average,
  // and 38 if it entered and was discarded afterwards.
  it('A_max collapses the SURVIVING half alone — the filter runs BEFORE the average', async () => {
    const venue = await seedVenue();
    await seedCell(venue, 26, 56, true); // 13h00 — in effect
    await seedCell(venue, 27, 20, false); // 13h30 — suspended

    const amax = await computeAmax(venue);
    expect(amax).toBe(56); // the surviving half alone
    expect(amax).not.toBe(38); // round((56 + 20) / 2) — filtered AFTER the damage
  });

  it('a venue whose only cells are suspended has no grid at all', async () => {
    const venue = await seedVenue();
    await seedCell(venue, 26, 56, false);
    await seedCell(venue, 27, 56, false);

    const grid = await loadBackupGrid(venue);
    expect(grid.has.every((row) => row.every((cell) => cell === false))).toBe(true);
    // …and A_max falls back to its unpersisted default rather than to the withdrawn value.
    expect(await computeAmax(venue)).not.toBe(56);
  });
});

afterAll(async () => {
  await sql.end();
});
