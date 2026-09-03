import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { estimationFloor, loadPeriodAudienceInput } from '../src/lib/period-audience-source.js';
import { periodAudience } from '../src/lib/period-audience.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';

// MEJ-7b (Mejri, ruled 2026-09-02) — « La courbe "Votre progression depuis le début" affiche des
// données pour le 26/08/2026, or que le capteur a été attaché le 31/08/2026, c'est-à-dire qu'il
// faut avoir 3 jours d'affluence et non pas 4 jours. »
//
// Her venue was CREATED 26/08 and its sensor attached 31/08. The floor was the creation day, so
// the manual grid answered for Wednesdays on which no sensor existed. The floor is now
// max(creation, first measured reading) — a reading is proof of observation.

let seq = 0;
const seedVenue = async (createdAt: Date): Promise<string> => {
  seq += 1;
  const values: NewUser = {
    email: `mej7b-${seq}@example.com`,
    contactName: `Owner ${seq}`,
    role: 'individual_owner',
    status: 'approved',
  };
  const [owner] = await db.insert(users).values(values).returning();
  const [sh] = await db
    .insert(screenhosts)
    .values({ name: `MEJ7B venue ${seq}`, ownerId: owner?.id ?? '', createdAt })
    .returning();
  return sh?.id ?? '';
};

/** A manual typical-week cell for every hour of every day — the grid that used to leak. */
const seedGrid = async (screenhostId: string, value: number): Promise<void> => {
  const rows = [];
  for (let day = 1; day <= 7; day += 1)
    for (let hour = 8; hour < 20; hour += 1)
      rows.push({ screenhostId, dayOfWeek: day, hour, estimatedImpressions: value });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
};

const seedReading = async (
  screenhostId: string,
  date: string,
  slot: number,
  value: number | null,
): Promise<void> => {
  await db
    .insert(screenhostAffluenceHourly)
    .values({ screenhostId, date, hour: Math.floor(slot / 2), slot, value });
};

const CREATED = new Date('2026-08-26T09:00:00Z'); // Wednesday — her venue's creation
const TODAY = '2026-09-02';

describe('MEJ-7b — the estimation floor is the first OBSERVATION, not the venue row', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  it('HER SHAPE: created 26/08, first reading 31/08 → the floor is 31/08', async () => {
    const venue = await seedVenue(CREATED);
    await seedReading(venue, '2026-08-31', 26, 40);
    expect(await estimationFloor(venue)).toBe('2026-08-31');
  });

  it('HER CURVE: 26/08–30/08 hold NO backup, and 31/08 onward is unchanged', async () => {
    const venue = await seedVenue(CREATED);
    await seedGrid(venue, 57); // the 57 pers. she saw on 26/08
    await seedReading(venue, '2026-08-31', 26, 40);

    // The all-time read behind « Votre progression depuis le début » — HER surface.
    const merged = periodAudience(
      await loadPeriodAudienceInput({
        venueId: venue,
        range: { from: '2020-01-01', to: TODAY },
        todayIso: TODAY,
        nowSlot: 48,
      }),
    );
    const dates = merged.days.map((d) => d.date);
    for (const before of ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']) {
      expect(`${before} present? ${String(dates.includes(before))}`).toBe(
        `${before} present? false`,
      );
    }
    expect(dates).toContain('2026-08-31'); // the day the sensor first observed the venue
    expect(dates[0]).toBe('2026-08-31'); // …and the curve STARTS there
  });

  it('a venue with NO measured row keeps its creation day — bit-identical to before', async () => {
    const venue = await seedVenue(CREATED);
    await seedGrid(venue, 57);
    expect(await estimationFloor(venue)).toBe('2026-08-26');

    const merged = periodAudience(
      await loadPeriodAudienceInput({
        venueId: venue,
        range: { from: '2020-01-01', to: TODAY },
        todayIso: TODAY,
        nowSlot: 48,
      }),
    );
    // A manual-only venue is « offline everywhere », so its grid applies from creation (OFF-1).
    expect(merged.days[0]?.date).toBe('2026-08-26');
  });

  // ── THE CROSS-LANE TRAP ───────────────────────────────────────────────────────────────────
  //
  // Since OFF-1 the hub sends a row for EMPTY slots (`value: null` carrying only device_online) —
  // 8 386 of them on its first push. Such a row is a RECORD OF SILENCE, not a reading. A floor
  // built on `min(date)` without `value IS NOT NULL` would snap back to the first empty slot the
  // hub reported and restore this bug in a different hat.
  it('a NULL-value row is silence, not an observation — it must not lower the floor', async () => {
    const venue = await seedVenue(CREATED);
    await seedReading(venue, '2026-08-27', 20, null); // the hub reporting « nothing here »
    await seedReading(venue, '2026-08-28', 20, null);
    await seedReading(venue, '2026-08-31', 26, 40); // the FIRST actual reading

    expect(await estimationFloor(venue)).toBe('2026-08-31');
    expect(await estimationFloor(venue)).not.toBe('2026-08-27');
  });

  it('a reading that predates creation cannot pull the floor backwards', async () => {
    const venue = await seedVenue(CREATED);
    await seedReading(venue, '2026-08-20', 26, 40); // older than the venue row itself
    expect(await estimationFloor(venue)).toBe('2026-08-26'); // max(), not min()
  });

  it('an unknown venue has no floor at all', async () => {
    expect(await estimationFloor('11111111-1111-4111-8111-111111111111')).toBeNull();
  });
});

afterAll(async () => {
  await sql.end();
});
