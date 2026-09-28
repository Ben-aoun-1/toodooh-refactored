import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaigns,
  creatives,
  eventAllocations,
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

// EVT-STOP S4 (docs/daily/2026-09-28.md §2 R4, ruling S2 A) — classic planning around the
// network blackout: a partly blacked-out hour is priced pro rata of the minutes left and the
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

/** A SOLD event whose (only) allocation — at ANOTHER venue — holds the given blocs. */
const seedSoldEvent = async (blocs: { start: string; end: string }[]): Promise<string> => {
  const [event] = await db
    .insert(events)
    .values({
      name: `EVTSTOP plan match ${seq}`,
      kickoffAt: new Date(`${MON}T20:00:00+01:00`),
      endsAt: new Date(`${MON}T22:00:00+01:00`),
      source: 'official',
    })
    .returning();
  const advertiserId = await seedUser();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/evtstop-plan/${seq}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Positionnement',
      campaignType: 'event',
      status: 'active',
      startDate: MON,
      endDate: MON,
      requestedBudget: '200.00',
      eventId: event?.id,
      creativeId: creative?.id,
    })
    .returning();
  const ownerId = await seedUser({ role: 'individual_owner' });
  const [elsewhere] = await db
    .insert(screenhosts)
    .values({ name: `EVTSTOP plan elsewhere ${seq}`, ownerId })
    .returning();
  await db.insert(eventAllocations).values({
    campaignId: positioning?.id ?? '',
    screenhostId: elsewhere?.id ?? '',
    blocs: blocs.map((b) => ({ ...b, impressions: 1000 })),
    impressionsTotal: 1000,
    montantTnd: '100.000',
    statut: 'ACCEPTE',
  });
  return event?.id ?? '';
};

const campaignRef = { id: '00000000-0000-0000-0000-000000000000', startDate: MON, endDate: TUE };
const inputs = { s: 10, t: 0.6, fMaxSeconds: 300 };

describe('EVT-STOP S4 — the pool plans around the network blackout (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('two 20-min blocs on Monday take 40 minutes off Hi; the créneaux carry blackoutMin', async () => {
    const shId = await seedVenue();
    // Tunis 09:00–09:20 and 10:40–11:00 (UTC+1) — one bloc in h9, one in h10.
    await seedSoldEvent([
      { start: `${MON}T08:00:00.000Z`, end: `${MON}T08:20:00.000Z` },
      { start: `${MON}T09:40:00.000Z`, end: `${MON}T10:00:00.000Z` },
    ]);
    const { pool } = await assemblePool(db, campaignRef, inputs);
    const entry = pool.find((p) => p.id === shId);
    // 2 days × 10 hours = 20, minus 2 × 20 min.
    expect(entry?.hours).toBeCloseTo(20 - 40 / 60, 10);
    expect([...(entry?.blackoutByCell ?? new Map()).entries()]).toEqual([
      [`${MON}:9`, 20],
      [`${MON}:10`, 20],
    ]);
    const creneaux = buildCreneaux(
      entry?.days ?? [],
      entry?.slots ?? [],
      10,
      entry?.blackoutByCell,
    );
    const h9 = creneaux.find((c) => c.date === MON && c.hour === 9);
    expect(h9).toEqual({ date: MON, hour: 9, reps: 10, impressions: 667, blackoutMin: 20 });
    expect(creneaux).toHaveLength(20);
  });

  it('an UNSOLD event (pending positioning) changes nothing', async () => {
    const shId = await seedVenue();
    const eventId = await seedSoldEvent([
      { start: `${MON}T08:00:00.000Z`, end: `${MON}T08:20:00.000Z` },
    ]);
    await db.update(campaigns).set({ status: 'pending' }).where(eq(campaigns.eventId, eventId));
    const { pool } = await assemblePool(db, campaignRef, inputs);
    const entry = pool.find((p) => p.id === shId);
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
