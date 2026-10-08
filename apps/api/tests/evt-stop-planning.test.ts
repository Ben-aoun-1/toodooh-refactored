import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  events,
  hourReservations,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { buildCreneaux } from '../src/lib/dispatch/plan.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';

import { bothHalves, resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// EVT-STOP S4 (docs/daily/2026-09-28.md §2 R4, ruling S2 A) + EVT-PLAY1 (2026-10-08: the whole
// window of every confirmed match, on the venues that show events) — classic planning around the
// reservation: a partly blacked-out hour is priced pro rata of the minutes left and the
// créneau remembers the minutes already priced out (blackoutMin); a fully unsellable cell — an
// hour_reservations cell, or an hour covered by blocs — gets NO créneau (it used to get a full
// one although capacity excluded it).

describe('buildCreneaux — the per-cell blackout map (pure)', () => {
  const days = [{ date: '2027-03-15', dayOfWeek: 1 }];
  const slots = [8, 9, 10].map((hour) => ({ dayOfWeek: 1, hour, affluence: 100 }));

  it('no map = byte-identical to before (full hours, no blackoutMin key)', () => {
    const plain = buildCreneaux(days, slots, 10);
    expect(plain).toEqual([
      { date: '2027-03-15', hour: 8, reps: 10, impressions: 1000 },
      { date: '2027-03-15', hour: 9, reps: 10, impressions: 1000 },
      { date: '2027-03-15', hour: 10, reps: 10, impressions: 1000 },
    ]);
  });

  it('20 blacked-out minutes → 2/3 of the impressions and blackoutMin 20; 60 → no créneau', () => {
    const map = new Map([
      ['2027-03-15:9', 20],
      ['2027-03-15:10', 60],
    ]);
    expect(buildCreneaux(days, slots, 10, map)).toEqual([
      { date: '2027-03-15', hour: 8, reps: 10, impressions: 1000 },
      { date: '2027-03-15', hour: 9, reps: 10, impressions: 667, blackoutMin: 20 },
    ]);
  });
});

const MON = '2027-03-15';
const TUE = '2027-03-16';

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `evtstop-plan-${seq}@example.com`,
      contactName: `EVTSTOP plan ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

/** Open 8–18, uniform affluence 100 on Mon + Tue (the EV1 seam fixture). */
const seedVenue = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `EVTSTOP plan venue ${seq}`,
      ownerId,
      businessSectorId: s?.id ?? '',
      class: 'premium' as never,
      sps: '80',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const shId = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: shId, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(shId);
  return shId;
};

/** EVT-PLAY1 — a match on Monday (Tunis times); confirmed unless told otherwise. */
const seedMatch = async (
  kickoff: string,
  ends: string,
  values: Partial<typeof events.$inferInsert> = {},
): Promise<void> => {
  await db.insert(events).values({
    name: `EVTSTOP plan match ${seq}`,
    kickoffAt: new Date(`${MON}T${kickoff}:00+01:00`),
    endsAt: new Date(`${MON}T${ends}:00+01:00`),
    source: 'official',
    ...values,
  });
};

const campaignRef = { id: '00000000-0000-0000-0000-000000000000', startDate: MON, endDate: TUE };
const inputs = { s: 10, t: 0.6, fMaxSeconds: 300 };

describe('EVT-STOP S4 / EVT-PLAY1 — the pool plans around the match windows (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a confirmed match takes its window off Hi; a partly reserved hour carries blackoutMin', async () => {
    const shId = await seedVenue();
    // Kickoff 11:00, end 12:20 Tunis → reserved 10:00–13:20: h10, h11, h12 whole, 20 min of h13.
    await seedMatch('11:00', '12:20');
    const { pool } = await assemblePool(db, campaignRef, inputs);
    const entry = pool.find((p) => p.id === shId);
    // 2 days × 10 hours = 20, minus 3 hours and 20 minutes on Monday.
    expect(entry?.hours).toBeCloseTo(20 - 3 - 20 / 60, 10);
    expect([...(entry?.blackoutByCell ?? new Map()).entries()]).toEqual([
      [`${MON}:10`, 60],
      [`${MON}:11`, 60],
      [`${MON}:12`, 60],
      [`${MON}:13`, 20],
    ]);
    const creneaux = buildCreneaux(
      entry?.days ?? [],
      entry?.slots ?? [],
      10,
      entry?.blackoutByCell,
    );
    const h13 = creneaux.find((c) => c.date === MON && c.hour === 13);
    expect(h13).toEqual({ date: MON, hour: 13, reps: 10, impressions: 667, blackoutMin: 20 });
    expect(creneaux.some((c) => c.date === MON && c.hour >= 10 && c.hour <= 12)).toBe(false);
    expect(creneaux).toHaveLength(17);
  });

  it('a provisional match changes nothing; a venue that does not show events keeps its hours', async () => {
    const shId = await seedVenue();
    await seedMatch('11:00', '12:20', { timeTbc: true });
    let entry = (await assemblePool(db, campaignRef, inputs)).pool.find((p) => p.id === shId);
    expect(entry?.hours).toBe(20);
    expect(entry?.blackoutByCell?.size).toBe(0);

    await seedMatch('11:00', '12:20');
    await db.update(screenhosts).set({ broadcastCapacity: null }).where(eq(screenhosts.id, shId));
    entry = (await assemblePool(db, campaignRef, inputs)).pool.find((p) => p.id === shId);
    expect(entry?.hours).toBe(20);
    expect(entry?.blackoutByCell?.size).toBe(0);
  });

  it('a reserved cell gets NO créneau (the gap: it used to get a full one)', async () => {
    const shId = await seedVenue();
    const [ev] = await db
      .insert(events)
      .values({
        name: 'Reservation',
        kickoffAt: new Date(`${MON}T20:00:00+01:00`),
        endsAt: new Date(`${MON}T22:00:00+01:00`),
        source: 'official',
      })
      .returning();
    await db
      .insert(hourReservations)
      .values({ screenhostId: shId, day: MON, hour: 8, eventId: ev?.id ?? '' });
    const { pool } = await assemblePool(db, campaignRef, inputs);
    const entry = pool.find((p) => p.id === shId);
    expect(entry?.hours).toBe(19);
    const creneaux = buildCreneaux(
      entry?.days ?? [],
      entry?.slots ?? [],
      10,
      entry?.blackoutByCell,
    );
    expect(creneaux.some((c) => c.date === MON && c.hour === 8)).toBe(false);
    expect(creneaux).toHaveLength(19);
  });
});
