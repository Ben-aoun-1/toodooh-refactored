import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { type NewUser, screenhostAffluenceHourly, screenhosts, users } from '../src/db/schema.js';
import {
  openMinutesBetween,
  ownerSensorStatuses,
  SENSOR_OFFLINE_AFTER_MINUTES,
  sensorStatusOf,
  slotEndInstant,
  tunisSlotKey,
} from '../src/lib/owner-sensors.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// CAL-2 — the sensor state on the owner's « ÉTAT DE MON DISPOSITIF » card. The rule is pinned on
// FIXED instants; the route test only uses gaps far from the threshold (30 min vs 10 h), computed
// relative to the clock, so it holds whatever time the suite runs (tests-green-because-of-when).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
  } as unknown as GetSessionResult);
};

describe('CAL-2 — sensorStatusOf (pure)', () => {
  it('a half-hour ends at its slot boundary, in Tunis time', () => {
    // 2026-03-02 is winter time in Tunis (UTC+1): slot 20 = 10:00–10:30 local = 09:30Z end.
    expect(slotEndInstant('2026-03-02', 20).toISOString()).toBe('2026-03-02T09:30:00.000Z');
    // The last slot ends at the next day's midnight.
    expect(slotEndInstant('2026-03-02', 47).toISOString()).toBe('2026-03-02T23:00:00.000Z');
  });

  it('never / active / offline, with the hub rule plus one push cycle as the boundary', () => {
    const end = slotEndInstant('2026-03-02', 20);
    const at = (minutesAfterEnd: number) => new Date(end.getTime() + minutesAfterEnd * 60_000);
    const cell = { date: '2026-03-02', slot: 20, deviceOnline: true };
    expect(sensorStatusOf(null, at(0))).toEqual({ status: 'never', lastMeasuredAt: null });
    expect(sensorStatusOf(cell, at(SENSOR_OFFLINE_AFTER_MINUTES)).status).toBe('active');
    expect(sensorStatusOf(cell, at(SENSOR_OFFLINE_AFTER_MINUTES + 1)).status).toBe('offline');
    expect(sensorStatusOf(cell, at(5)).lastMeasuredAt).toBe(end.toISOString());
  });

  it('a recent cell the hub flagged as device-offline is not « active »', () => {
    const end = slotEndInstant('2026-03-02', 20);
    const cell = { date: '2026-03-02', slot: 20, deviceOnline: false };
    expect(sensorStatusOf(cell, new Date(end.getTime() + 60_000)).status).toBe('offline');
    // an unknown flag (null) does not count against the sensor
    expect(
      sensorStatusOf({ ...cell, deviceOnline: null }, new Date(end.getTime() + 60_000)).status,
    ).toBe('active');
  });

  it('tunisSlotKey maps an instant to its Tunis day and half-hour', () => {
    expect(tunisSlotKey(new Date('2026-03-02T09:45:00Z'))).toEqual({
      date: '2026-03-02',
      slot: 21,
    });
    expect(tunisSlotKey(new Date('2026-03-02T23:10:00Z'))).toEqual({ date: '2026-03-03', slot: 0 });
  });
});

// LEARN-1 — under the hub's flag closed half-hours are never sent: the 120 minutes are counted in
// the venue's opening time only, or every sensor would read « hors ligne » every night.
describe('LEARN-1 — recency counts opening time only', () => {
  const lastAt22 = { date: '2026-09-15', slot: 43, deviceOnline: null }; // 21h30–22h00, ends 22h00
  const tunis = (iso: string): Date => new Date(`${iso}+01:00`);
  const open10to22 = { openingHour: 10, closingHour: 22 };

  it('a venue closed for the night stays « active » overnight and in the first opening hour', () => {
    expect(sensorStatusOf(lastAt22, tunis('2026-09-16T00:30:00'), open10to22).status).toBe(
      'active',
    );
    expect(sensorStatusOf(lastAt22, tunis('2026-09-16T09:59:00'), open10to22).status).toBe(
      'active',
    );
    expect(sensorStatusOf(lastAt22, tunis('2026-09-16T11:59:00'), open10to22).status).toBe(
      'active',
    ); // 119 open min
    expect(sensorStatusOf(lastAt22, tunis('2026-09-16T12:01:00'), open10to22).status).toBe(
      'offline',
    ); // 121
  });

  it('NULL hours = open all day = exactly the wall-clock rule', () => {
    const none = { openingHour: null, closingHour: null };
    const at = tunis('2026-09-16T00:30:00'); // 150 wall-clock minutes after 22h00
    expect(sensorStatusOf(lastAt22, at, none)).toEqual(sensorStatusOf(lastAt22, at));
    expect(sensorStatusOf(lastAt22, at, none).status).toBe('offline');
    expect(sensorStatusOf(lastAt22, tunis('2026-09-15T23:59:00'), none).status).toBe('active'); // 119
  });

  it('a zero-width pair has no opening time: the wall-clock rule applies, never « active forever »', () => {
    expect(
      sensorStatusOf(lastAt22, tunis('2026-09-16T00:30:00'), { openingHour: 9, closingHour: 9 })
        .status,
    ).toBe('offline');
  });

  it('an overnight venue (08 → 01) counts its post-midnight hour', () => {
    const lastAt0030 = { date: '2026-09-16', slot: 0, deviceOnline: null }; // 00h00–00h30
    const open8to1 = { openingHour: 8, closingHour: 1 };
    // 30 open minutes (00h30–01h00), then closed until 08h00: 30 + 89 = 119 at 09h29.
    expect(sensorStatusOf(lastAt0030, tunis('2026-09-16T09:29:00'), open8to1).status).toBe(
      'active',
    );
    expect(sensorStatusOf(lastAt0030, tunis('2026-09-16T09:32:00'), open8to1).status).toBe(
      'offline',
    );
  });

  it('a device the hub flagged offline is still « offline », whatever the hours', () => {
    expect(
      sensorStatusOf({ ...lastAt22, deviceOnline: false }, tunis('2026-09-16T00:30:00'), open10to22)
        .status,
    ).toBe('offline');
  });

  it('openMinutesBetween counts open minutes of [from, to) and stops past the cap', () => {
    const from = tunis('2026-09-15T21:00:00');
    expect(openMinutesBetween(from, tunis('2026-09-16T10:30:00'), open10to22, 10_000)).toBe(90);
    // a year of a venue open all day stops early: the result is just past the cap, not 525 600
    const capped = openMinutesBetween(
      from,
      tunis('2027-09-15T21:00:00'),
      { openingHour: null, closingHour: null },
      120,
    );
    expect(capped).toBeGreaterThan(120);
    expect(capped).toBeLessThanOrEqual(150);
  });
});

const buildApp = () => Fastify({ logger: false });

describe('CAL-2 — GET /api/screenhosts/sensors (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  let seq = 0;

  const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
    seq += 1;
    const [u] = await db
      .insert(users)
      .values({
        email: `cal2-${seq}@example.com`,
        contactName: `U${seq}`,
        status: 'approved',
        ...values,
      })
      .returning();
    return u?.id ?? '';
  };
  const seedVenue = async (ownerId: string, name: string): Promise<string> => {
    const [v] = await db.insert(screenhosts).values({ name, ownerId }).returning();
    return v?.id ?? '';
  };
  const seedCell = async (
    screenhostId: string,
    instant: Date,
    opts: { value?: number | null; deviceOnline?: boolean | null } = {},
  ) => {
    const { date, slot } = tunisSlotKey(instant);
    await db.insert(screenhostAffluenceHourly).values({
      screenhostId,
      date,
      hour: Math.floor(slot / 2),
      slot,
      value: opts.value === undefined ? 12 : opts.value,
      deviceOnline: opts.deviceOnline === undefined ? true : opts.deviceOnline,
    });
  };

  beforeEach(async () => {
    await resetAuthTables();
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

  it("classifies each of the owner's venues, and only the owner's", async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const other = await seedUser({ role: 'individual_owner' });
    const now = Date.now();
    const live = await seedVenue(owner, 'A — capteur actif');
    const silent = await seedVenue(owner, 'B — capteur muet');
    const never = await seedVenue(owner, 'C — sans capteur');
    const flagged = await seedVenue(owner, 'D — hors ligne selon le hub');
    const emptyOnly = await seedVenue(owner, 'E — seulement des cases vides');
    await seedVenue(other, 'Z — autre propriétaire');

    await seedCell(live, new Date(now - 30 * 60_000));
    await seedCell(live, new Date(now - 10 * 60 * 60_000)); // older cells do not matter
    await seedCell(silent, new Date(now - 10 * 60 * 60_000));
    await seedCell(flagged, new Date(now - 30 * 60_000), { deviceOnline: false });
    await seedCell(emptyOnly, new Date(now - 30 * 60_000), { value: null });

    mockSession(owner);
    const res = await app.inject({ method: 'GET', url: '/api/screenhosts/sensors' });
    expect(res.statusCode).toBe(200);
    const rows =
      res.json<
        { venue_id: string; venue_name: string; status: string; last_measured_at: string | null }[]
      >();
    expect(rows.map((r) => r.venue_name)).toEqual([
      'A — capteur actif',
      'B — capteur muet',
      'C — sans capteur',
      'D — hors ligne selon le hub',
      'E — seulement des cases vides',
    ]);
    const statusOf = new Map(rows.map((r) => [r.venue_id, r.status]));
    expect(statusOf.get(live)).toBe('active');
    expect(statusOf.get(silent)).toBe('offline');
    expect(statusOf.get(never)).toBe('never');
    expect(statusOf.get(flagged)).toBe('offline');
    expect(statusOf.get(emptyOnly)).toBe('never'); // an empty cell is not a measurement
    expect(rows.find((r) => r.venue_id === never)?.last_measured_at).toBeNull();
  });

  it('LEARN-1 — counts only opening time, so a venue closed overnight still reads « active »', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const [withHours] = await db
      .insert(screenhosts)
      .values({ name: 'F — horaires 10h-22h', ownerId: owner, openingHour: 10, closingHour: 22 })
      .returning();
    const [nullHours] = await db
      .insert(screenhosts)
      .values({ name: 'G — sans horaires', ownerId: owner })
      .returning();
    const cellAt = new Date('2026-09-15T21:45:00+01:00'); // Tunis 21h45 → date 2026-09-15, slot 43
    await seedCell(withHours?.id ?? '', cellAt);
    await seedCell(nullHours?.id ?? '', cellAt);

    // The route itself calls `new Date()`; call ownerSensorStatuses directly to control the clock.
    const now = new Date('2026-09-16T00:30:00+01:00'); // Tunis 00h30 the next night
    const rows = await ownerSensorStatuses(owner, now);
    const statusOf = new Map(rows.map((r) => [r.venue_id, r.status]));
    expect(statusOf.get(withHours?.id ?? '')).toBe('active');
    expect(statusOf.get(nullHours?.id ?? '')).toBe('offline');
  });

  it('requires a session', async () => {
    vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
    expect((await app.inject({ method: 'GET', url: '/api/screenhosts/sensors' })).statusCode).toBe(
      401,
    );
  });
});
