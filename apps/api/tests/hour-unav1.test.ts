import { and, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  campaignTargeting,
  eventAllocations,
  events,
  screenhostAffluence,
  screenhosts,
  screenhostUnavailability,
  screenhostUnavailableHours,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays } from '../src/lib/campaign-dates.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { fenetreDiffusion } from '../src/lib/fenetre-diffusion.js';
import {
  cellsForHours,
  describeDay,
  isWholeDayUnavailable,
  openingDayCells,
} from '../src/lib/unavailable-hours.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// HOUR-UNAV1 (Mariem 26/10, operator rulings 2026-10-27) — a venue's unavailability by the HOUR:
// the shared cell model, the backward-compatible route (whole days unchanged), the engine reading
// declared hours like reserved ones, and the CAL-1 move of exactly the declared hours' share —
// classic créneaux AND sold event slots (ruling 8.2).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'individual_owner'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `hu1-${seq}@example.com`,
      contactName: `HU1 ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

// Open 8:00 → 18:00, 100 impressions an hour on Monday and Tuesday (the E2 fixture).
const seedVenue = async (cat: string): Promise<{ shId: string; ownerId: string }> => {
  const ownerId = await seedUser({ role: 'individual_owner' });
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `HU1 Venue ${seq}`,
      ownerId,
      businessSectorId: cat,
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
  return { shId, ownerId };
};

/** A future Monday at least `minDays` away (the venue's affluence is on Mondays and Tuesdays). */
const futureMonday = (minDays: number): string => {
  let day = plusCalendarDays(new Date().toISOString().slice(0, 10), minDays);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = plusCalendarDays(day, 1);
  return day;
};

describe('HOUR-UNAV1 pure rules', () => {
  it('an opening day is its window hours; an overnight venue’s small hours are the next date', () => {
    expect(openingDayCells('2027-06-10', 20, 2)).toEqual([
      { date: '2027-06-10', hour: 20 },
      { date: '2027-06-10', hour: 21 },
      { date: '2027-06-10', hour: 22 },
      { date: '2027-06-10', hour: 23 },
      { date: '2027-06-11', hour: 0 },
      { date: '2027-06-11', hour: 1 },
    ]);
    expect(openingDayCells('2027-06-10', null, null)).toHaveLength(24);
  });

  it('chosen hours keep only the window’s; none inside → null', () => {
    expect(cellsForHours('2027-06-10', [1, 22, 9], 20, 2)).toEqual([
      { date: '2027-06-10', hour: 22 },
      { date: '2027-06-11', hour: 1 },
    ]);
    expect(cellsForHours('2027-06-10', [9, 10], 20, 2)).toBeNull();
  });

  it('describes a day in words, an overnight range as one', () => {
    const cells = new Set(['2027-06-10:23', '2027-06-11:0', '2027-06-10:20']);
    expect(describeDay('2027-06-10', cells, 20, 2)).toBe('Indisponible 20 h–21 h, 23 h–1 h');
    expect(describeDay('2027-06-10', new Set(), 20, 2)).toBe('Disponible');
    const all = new Set(openingDayCells('2027-06-10', 20, 2).map((c) => `${c.date}:${c.hour}`));
    expect(describeDay('2027-06-10', all, 20, 2)).toBe('Indisponible toute la journée');
    expect(isWholeDayUnavailable('2027-06-10', all, 20, 2)).toBe(true);
    expect(isWholeDayUnavailable('2027-06-10', cells, 20, 2)).toBe(false);
  });
});

const buildApp = () => Fastify({ logger: false });

describe('HOUR-UNAV1 on the database', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await sql`delete from events`;
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const put = (shId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/api/screenhosts/${shId}/unavailability`, payload });
  const get = async (shId: string, day: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/screenhosts/${shId}/unavailability?from=${day}&to=${day}`,
      })
    ).json<{ days: string[]; hours: { day: string; hour: number }[]; opening_hour: number }>();
  const hourRows = (shId: string) =>
    db
      .select()
      .from(screenhostUnavailableHours)
      .where(eq(screenhostUnavailableHours.screenhostId, shId));
  const dayRows = (shId: string) =>
    db
      .select()
      .from(screenhostUnavailability)
      .where(eq(screenhostUnavailability.screenhostId, shId));

  it('the route: some hours, the whole day (stored as one day row), part of a whole day undone; the old contract is unchanged', async () => {
    const venue = await seedVenue(await ownerSectorId());
    mockSession(venue.ownerId);
    const D = futureMonday(5);

    expect((await put(venue.shId, { day: D, unavailable: true, hours: [14, 15] })).statusCode).toBe(
      200,
    );
    expect(await get(venue.shId, D)).toMatchObject({
      days: [],
      hours: [
        { day: D, hour: 14 },
        { day: D, hour: 15 },
      ],
      opening_hour: 8,
    });

    // The whole day, the original contract (no `hours`) — one day row, its hour rows dropped.
    expect((await put(venue.shId, { day: D, unavailable: true })).statusCode).toBe(200);
    expect((await get(venue.shId, D)).days).toEqual([D]);
    expect(await dayRows(venue.shId)).toHaveLength(1);
    expect(await hourRows(venue.shId)).toHaveLength(0);

    // Undo 9 h only: the day row goes, its other nine hours stay as hour rows.
    expect((await put(venue.shId, { day: D, unavailable: false, hours: [9] })).statusCode).toBe(
      200,
    );
    expect(await dayRows(venue.shId)).toHaveLength(0);
    const left = (await get(venue.shId, D)).hours.map((h) => h.hour);
    expect(left).toEqual([8, 10, 11, 12, 13, 14, 15, 16, 17]);

    // Hours outside the window → 400; today → 400 as before.
    expect((await put(venue.shId, { day: D, unavailable: true, hours: [3] })).statusCode).toBe(400);
    const today = new Date().toISOString().slice(0, 10);
    expect((await put(venue.shId, { day: today, unavailable: true, hours: [10] })).statusCode).toBe(
      400,
    );
  });

  it('the engine: declared hours shrink capacity hour by hour, the day stays', async () => {
    const cat = await ownerSectorId();
    const venue = await seedVenue(cat);
    const MON = '2026-07-20';
    const TUE = '2026-07-21';
    await db
      .insert(screenhostUnavailableHours)
      .values([8, 9, 10, 11, 12].map((hour) => ({ screenhostId: venue.shId, day: TUE, hour })));
    const advertiserId = await seedUser({ role: 'advertiser' });
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: 'HU1',
        campaignType: 'standard',
        status: 'pending',
        startDate: MON,
        endDate: TUE,
      })
      .returning();
    await db
      .insert(campaignTargeting)
      .values({ campaignId: c?.id ?? '', categoryId: cat, class: null });
    const { pool } = await assemblePool(
      db,
      { id: c?.id ?? '', startDate: MON, endDate: TUE },
      { s: 10, t: 0.6, fMaxSeconds: 300 },
    );
    const entry = pool.find((p) => p.id === venue.shId);
    // 20 hours − 5 declared = 15 (the whole day E2 test had 10) — exactly ∝, both days kept.
    expect(entry?.hours).toBe(15);
    expect(entry?.capaciteUtile).toBe(27_000);
    expect(entry?.days.map((d) => d.date)).toEqual([MON, TUE]);
  });

  it('declaring hours moves exactly those hours’ créneaux; the rest of the day stays', async () => {
    const cat = await ownerSectorId();
    const venue = await seedVenue(cat);
    const D1 = futureMonday(10);
    const advertiserId = await seedUser({ role: 'advertiser' });
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: 'HU1 créneaux',
        campaignType: 'standard',
        status: 'upcoming',
        startDate: D1,
        endDate: D1,
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: c?.id ?? '',
        iCible: 10_000,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '0.6',
        seuilDiffusable: 2000,
        sMin: '20',
        gJour: '3.3333',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 10_000,
        nMin: 1,
        nMax: 10,
        nRetenus: 1,
      })
      .returning();
    const frozen: DispatchCreneau[] = [];
    for (let h = 8; h < 18; h += 1) frozen.push({ date: D1, hour: h, reps: 10, impressions: 1000 });
    const [alloc] = await db
      .insert(campaignDispatchAllocation)
      .values({
        planId: plan?.id ?? '',
        screenhostId: venue.shId,
        iiPotentiel: 6000,
        rI: 10,
        revenuPrevisionnel: '60',
        creneaux: frozen,
        statutAcceptation: 'ACCEPTE',
      })
      .returning();

    mockSession(venue.ownerId);
    const res = await put(venue.shId, { day: D1, unavailable: true, hours: [10, 11] });
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ redispatched: { mode: string; slots_moved: number; v_fact: number }[] }>()
        .redispatched,
    ).toEqual([expect.objectContaining({ mode: 'cascade', slots_moved: 2, v_fact: 1200 })]);
    const [after] = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.id, alloc?.id ?? ''));
    expect(after?.creneaux.map((cr) => cr.hour)).toEqual([8, 9, 12, 13, 14, 15, 16, 17]);
    expect(after?.iiPotentiel).toBe(4800);
  });

  it('ruling 8.2 — a sold event slot in the declared hours leaves the venue (re-placed); its other slots stay', async () => {
    const venue = await seedVenue(await ownerSectorId());
    const D1 = futureMonday(10);
    // Kick-off 14:00, end 16:00 (Tunis) → « avant » 13:00–14:00, « après » 16:00–17:00.
    const kickoff = new Date(`${D1}T14:00:00+01:00`);
    const ends = new Date(`${D1}T16:00:00+01:00`);
    const [ev] = await db
      .insert(events)
      .values({
        name: 'HU1 Match',
        type: 'sport',
        kickoffAt: kickoff,
        endsAt: ends,
        source: 'official',
      })
      .returning();
    const advertiserId = await seedUser({ role: 'advertiser' });
    const [positioning] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: 'HU1 positionnement',
        campaignType: 'event',
        status: 'upcoming',
        startDate: D1,
        endDate: D1,
        eventId: ev?.id,
      })
      .returning();
    const grid = fenetreDiffusion(kickoff, ends).blocs;
    const blocs = grid.map((b) => ({
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      impressions: 100,
    }));
    const [alloc] = await db
      .insert(eventAllocations)
      .values({
        campaignId: positioning?.id ?? '',
        screenhostId: venue.shId,
        blocs,
        impressionsTotal: 600,
        montantTnd: '60.000',
        statut: 'ACCEPTE',
        decidedAt: new Date(),
      })
      .returning();

    mockSession(venue.ownerId);
    const res = await put(venue.shId, { day: D1, unavailable: true, hours: [16] });
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ redispatched: { mode: string; slots_moved: number; v_fact: number }[] }>()
        .redispatched,
    ).toEqual([expect.objectContaining({ mode: 'evenement', slots_moved: 3, v_fact: 300 })]);
    const [after] = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.id, alloc?.id ?? ''));
    expect((after?.blocs as { start: string }[]).map((b) => b.start)).toEqual(
      grid.slice(0, 3).map((b) => b.start.toISOString()),
    );
    expect(after).toMatchObject({ statut: 'ACCEPTE', impressionsTotal: 300, montantTnd: '30.000' });
    // The venue's hold for the event follows: only the « avant » hour (13 h) is still held.
    const holds =
      await sql`select hour from hour_reservations where event_id = ${ev?.id ?? ''} and screenhost_id = ${venue.shId}`;
    expect(holds.map((h) => Number(h['hour']))).toEqual([13]);

    // Declaring the « avant » hour too leaves nothing: the allocation is a refusal.
    await put(venue.shId, { day: D1, unavailable: true, hours: [13] });
    const [refused] = await db
      .select({ statut: eventAllocations.statut })
      .from(eventAllocations)
      .where(
        and(
          eq(eventAllocations.id, alloc?.id ?? ''),
          eq(eventAllocations.screenhostId, venue.shId),
        ),
      );
    expect(refused?.statut).toBe('REFUSE');
  });
});
