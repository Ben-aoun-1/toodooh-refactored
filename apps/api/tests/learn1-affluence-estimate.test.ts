import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { screenhostAffluenceHourly, screenhosts } from '../src/db/schema.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// LEARN-1 T2 (spec 2026-09-21 §5) — the hub's READY-MADE value for a half-hour it did not measure
// (its learned average, else the typed seed) lives in its OWN column, beside `value = NULL`, so an
// estimate can never be read as a measurement. Nullable (absent = the hub offered nothing, and every
// row written before LEARN-1), never negative.

const seedVenue = async (name = 'LEARN-1 venue'): Promise<string> => {
  const [host] = await db.insert(screenhosts).values({ name }).returning({ id: screenhosts.id });
  return host!.id;
};

afterAll(async () => {
  await sql.end();
});

describe('LEARN-1 T2 — screenhost_affluence_hourly.estimate (migration 0077)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('is a NULLABLE integer', async () => {
    const [col] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type from information_schema.columns
      where table_name = 'screenhost_affluence_hourly' and column_name = 'estimate'`;
    expect(col).toEqual({ is_nullable: 'YES', data_type: 'integer' });
  });

  it('refuses a negative estimate at the database; NULL and 0 pass', async () => {
    const venue = await seedVenue();
    await db.insert(screenhostAffluenceHourly).values([
      { screenhostId: venue, date: '2026-09-14', hour: 10, slot: 20, value: null, estimate: 0 },
      { screenhostId: venue, date: '2026-09-14', hour: 10, slot: 21, value: 5 }, // estimate NULL
    ]);
    await expect(
      sql`insert into screenhost_affluence_hourly (screenhost_id, date, hour, slot, value, estimate)
          values (${venue}, '2026-09-14', 11, 22, null, -1)`,
    ).rejects.toThrow(/screenhost_affluence_hourly_estimate_nonneg/);
  });
});
