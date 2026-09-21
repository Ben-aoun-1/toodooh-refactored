import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  applyAmaxRecompute,
  collectAmaxRecompute,
  executeRefusal,
  isChange,
} from '../scripts/learn1-recompute-amax.js';
import { db, sql } from '../src/db/client.js';
import { screenhostAffluenceHourly, screenhostAmax, screenhosts } from '../src/db/schema.js';
import { AMAX_FALLBACK_PPH, computeAmax } from '../src/lib/event-pricing/pricing.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// LEARN-1 F1 — the ONE-TIME reset of the A_max ratchet to the measured rule. The current stored
// values came from the typical-week grid (4-week means and typed values, closed hours included), so
// some go DOWN (approved). A venue with no measured hour loses its row and prices at the unpersisted
// 50 — never a stored 50, which would ratchet over its first real, lower peak.

const seedVenue = async (name: string, stored: number | null): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({ name, openingHour: 8, closingHour: 22 })
    .returning({ id: screenhosts.id });
  if (stored !== null)
    await db.insert(screenhostAmax).values({ screenhostId: sh!.id, amaxPph: stored });
  return sh!.id;
};

const seedHour = async (venue: string, hour: number, value: number | null, estimate?: number) => {
  for (const slot of [hour * 2, hour * 2 + 1]) {
    await db.insert(screenhostAffluenceHourly).values({
      screenhostId: venue,
      date: '2026-09-14',
      hour,
      slot,
      value,
      ...(estimate === undefined ? {} : { estimate }),
    });
  }
};

const storedOf = async (venue: string): Promise<number | null> => {
  const [row] = await db
    .select({ v: screenhostAmax.amaxPph })
    .from(screenhostAmax)
    .where(eq(screenhostAmax.screenhostId, venue));
  return row?.v ?? null;
};

afterAll(async () => {
  await sql.end();
});

describe('LEARN-1 F1 — the A_max recompute (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('inventories every venue before → after, applies only the changes, lowers when due', async () => {
    const lowered = await seedVenue('A lowered', 300);
    await seedHour(lowered, 9, 90);
    const first = await seedVenue('B first', null);
    await seedHour(first, 10, 120);
    const unmeasured = await seedVenue('C unmeasured', 200);
    await seedHour(unmeasured, 11, null, 500); // estimates only
    const nothing = await seedVenue('D nothing', null);
    const same = await seedVenue('E same', 70);
    await seedHour(same, 12, 70);

    const rows = await collectAmaxRecompute();
    expect(rows).toEqual([
      { screenhostId: lowered, name: 'A lowered', before: 300, after: 90 },
      { screenhostId: first, name: 'B first', before: null, after: 120 },
      { screenhostId: unmeasured, name: 'C unmeasured', before: 200, after: null },
      { screenhostId: nothing, name: 'D nothing', before: null, after: null },
      { screenhostId: same, name: 'E same', before: 70, after: 70 },
    ]);
    expect(rows.filter(isChange).map((r) => r.name)).toEqual([
      'A lowered',
      'B first',
      'C unmeasured',
    ]);

    expect(await applyAmaxRecompute(rows)).toBe(3);
    expect(await storedOf(lowered)).toBe(90);
    expect(await storedOf(first)).toBe(120);
    expect(await storedOf(unmeasured)).toBeNull();
    expect(await storedOf(nothing)).toBeNull();
    expect(await storedOf(same)).toBe(70);

    // Idempotent: a second pass finds nothing to change.
    expect((await collectAmaxRecompute()).filter(isChange)).toEqual([]);
    // The reset venue prices at the fallback under the flag, and still stores nothing.
    expect(await computeAmax(unmeasured, { learnedAffluence: true })).toBe(AMAX_FALLBACK_PPH);
    expect(await storedOf(unmeasured)).toBeNull();
    expect(await computeAmax(lowered, { learnedAffluence: true })).toBe(90);
  });

  it('--execute is refused while LEARNED_AFFLUENCE_ENABLED is off', () => {
    expect(executeRefusal(false)).toMatch(/LEARNED_AFFLUENCE_ENABLED/);
    expect(executeRefusal(true)).toBeNull();
  });
});
