import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, businessSectors, events, screenhosts, users } from '../src/db/schema.js';
import {
  blackoutMinutesByVenueCell,
  blackoutMinutesInHour,
  eventBlackouts,
  isInBlackout,
  mergeBlackouts,
  upcomingBlackouts,
  windowsForVenue,
} from '../src/lib/event-blackout.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { eventSector } from './helpers/installed-screen-matrix.js';

// EVT-STOP (2026-09-28) + EVT-PLAY1 (operator rulings 2026-10-08) — from kickoff − 1 h to the
// end + 1 h of every CONFIRMED match (official, not annulé, date and time confirmed — sold or
// not), the venues that show events (event switch on, event-eligible sector) stop classic
// campaigns. This file pins the ONE home of those windows and the pure minute arithmetic
// planning reads.

const at = (iso: string): Date => new Date(iso);
const w = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe('EVT-STOP — the pure blackout rules', () => {
  it('merges overlapping and touching windows into one', () => {
    const merged = mergeBlackouts([
      w('2027-03-12T19:40:00Z', '2027-03-12T20:00:00Z'),
      w('2027-03-12T19:00:00Z', '2027-03-12T19:20:00Z'),
      w('2027-03-12T19:20:00Z', '2027-03-12T19:40:00Z'),
      w('2027-03-12T21:00:00Z', '2027-03-12T21:20:00Z'),
      w('2027-03-12T21:10:00Z', '2027-03-12T21:30:00Z'),
    ]);
    expect(merged.map((m) => [m.start.toISOString(), m.end.toISOString()])).toEqual([
      ['2027-03-12T19:00:00.000Z', '2027-03-12T20:00:00.000Z'],
      ['2027-03-12T21:00:00.000Z', '2027-03-12T21:30:00.000Z'],
    ]);
  });

  it('an instant is blacked out on [start, end) — half-open like the blocs', () => {
    const windows = [w('2027-03-12T19:00:00Z', '2027-03-12T19:20:00Z')];
    expect(isInBlackout(windows, at('2027-03-12T18:59:59Z'))).toBe(false);
    expect(isInBlackout(windows, at('2027-03-12T19:00:00Z'))).toBe(true);
    expect(isInBlackout(windows, at('2027-03-12T19:19:59Z'))).toBe(true);
    expect(isInBlackout(windows, at('2027-03-12T19:20:00Z'))).toBe(false);
  });

  it('blackout minutes per Tunis (date, hour) — a bloc straddling the hour splits', () => {
    // Tunis = UTC+1: the 20:00 Tunis hour of 2027-03-12 is [19:00Z, 20:00Z).
    const windows = [
      w('2027-03-12T19:45:00Z', '2027-03-12T20:05:00Z'), // 15 min in h20, 5 in h21
      w('2027-03-12T19:05:00Z', '2027-03-12T19:25:00Z'), // 20 min in h20
    ];
    expect(blackoutMinutesInHour(windows, '2027-03-12', 20)).toBe(35);
    expect(blackoutMinutesInHour(windows, '2027-03-12', 21)).toBe(5);
    expect(blackoutMinutesInHour(windows, '2027-03-12', 19)).toBe(0);
    // overlapping windows (two events at once) never count a minute twice
    const twice = [...windows, w('2027-03-12T19:05:00Z', '2027-03-12T19:25:00Z')];
    expect(blackoutMinutesInHour(twice, '2027-03-12', 20)).toBe(35);
  });

  it('the playlist horizon keeps windows ending after now and starting before now + horizon', () => {
    const now = at('2027-03-12T12:00:00Z');
    const windows = [
      w('2027-03-12T11:00:00Z', '2027-03-12T11:20:00Z'), // over
      w('2027-03-12T11:50:00Z', '2027-03-12T12:10:00Z'), // running
      w('2027-03-13T11:00:00Z', '2027-03-13T11:20:00Z'), // within 48 h
      w('2027-03-15T11:00:00Z', '2027-03-15T11:20:00Z'), // beyond 48 h
    ];
    expect(upcomingBlackouts(windows, now).map((x) => x.start.toISOString())).toEqual([
      '2027-03-12T11:50:00.000Z',
      '2027-03-13T11:00:00.000Z',
    ]);
  });
});

let seq = 0;
const seedOwner = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `evtstop-${seq}@example.com`,
      contactName: `EVTSTOP ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// The match: Friday 2027-03-12 20:00–22:00 Tunis (19:00–21:00Z) → the window 18:00Z–22:00Z.
const KICKOFF = at('2027-03-12T20:00:00+01:00');
const ENDS = at('2027-03-12T22:00:00+01:00');
const WINDOW = { start: '2027-03-12T18:00:00.000Z', end: '2027-03-12T22:00:00.000Z' };

const seedMatch = async (values: Partial<typeof events.$inferInsert> = {}): Promise<string> => {
  seq += 1;
  const [event] = await db
    .insert(events)
    .values({
      name: `EVTSTOP Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      ...values,
    })
    .returning();
  return event?.id ?? '';
};

/** An owner sector that never shows events — none is seeded, so the test adds (and drops) one. */
const withOtherSector = async (run: (sectorId: string) => Promise<void>): Promise<void> => {
  const [s] = await db
    .insert(businessSectors)
    .values({ name: `EVTSTOP Pharmacie ${seq}`, audience: 'owner', eventEligible: false })
    .returning({ id: businessSectors.id });
  if (!s) throw new Error('withOtherSector: no row');
  try {
    await run(s.id);
  } finally {
    // The reference table is not reset between tests (db.test pins its seed count).
    await db.delete(screenhosts).where(eq(screenhosts.businessSectorId, s.id));
    await db.delete(businessSectors).where(eq(businessSectors.id, s.id));
  }
};

const seedVenue = async (sectorId: string, broadcastCapacity: number | null): Promise<string> => {
  const [venue] = await db
    .insert(screenhosts)
    .values({
      name: `EVTSTOP Venue ${seq}-${Math.random()}`,
      ownerId: await seedOwner(),
      businessSectorId: sectorId,
      broadcastCapacity,
    })
    .returning();
  return venue?.id ?? '';
};

const DAY = { from: at('2027-03-12T00:00:00Z'), to: at('2027-03-13T00:00:00Z') };
const windowsOfDay = async (): Promise<{ start: string; end: string }[]> =>
  (await eventBlackouts(DAY.from, DAY.to)).windows.map((x) => ({
    start: x.start.toISOString(),
    end: x.end.toISOString(),
  }));

describe('EVT-PLAY1 — eventBlackouts (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a confirmed match reserves kickoff − 1 h → end + 1 h, sold or not (Q2 A)', async () => {
    await seedMatch();
    expect(await windowsOfDay()).toEqual([WINDOW]);
  });

  it('a provisional date or time, a suggestion and an annulé match reserve nothing', async () => {
    await seedMatch({ dateTbc: true });
    await seedMatch({ timeTbc: true });
    await seedMatch({ source: 'suggested' });
    await seedMatch({ annule: true });
    expect(await windowsOfDay()).toEqual([]);
  });

  it('only the venues that show events honour the window', async () => {
    await seedMatch();
    const shows = await seedVenue(await eventSector(), 1);
    const switchOff = await seedVenue(await eventSector(), null);
    await withOtherSector(async (sectorId) => {
      const otherTrade = await seedVenue(sectorId, 1);
      const b = await eventBlackouts(DAY.from, DAY.to);
      expect(windowsForVenue(b, shows)).toHaveLength(1);
      expect(windowsForVenue(b, switchOff)).toEqual([]);
      expect(windowsForVenue(b, otherTrade)).toEqual([]);

      // Per venue cell (R5 late-reservation input): 20:00 Tunis is a whole reserved hour.
      const cells = [{ date: '2027-03-12', hour: 20 }];
      const byVenue = await blackoutMinutesByVenueCell([
        { screenhostId: shows, creneaux: cells },
        { screenhostId: otherTrade, creneaux: cells },
      ]);
      expect(byVenue.get(shows)?.get('2027-03-12:20')).toBe(60);
      expect(byVenue.get(otherTrade)).toBeUndefined();
    });
  });

  it('overlapping matches merge; only windows overlapping [from, to) are returned', async () => {
    await seedMatch();
    await seedMatch({
      kickoffAt: at('2027-03-12T22:30:00+01:00'),
      endsAt: at('2027-03-13T00:30:00+01:00'),
    });
    expect(await windowsOfDay()).toEqual([
      { start: WINDOW.start, end: '2027-03-13T00:30:00.000Z' },
    ]);
    expect((await eventBlackouts(DAY.from, at('2027-03-12T18:00:00Z'))).windows).toEqual([]);
  });
});
