import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaigns,
  creatives,
  eventAllocations,
  events,
  screenhosts,
  users,
} from '../src/db/schema.js';
import {
  blackoutMinutesInHour,
  isInBlackout,
  mergeBlackouts,
  soldEventBlackouts,
  upcomingBlackouts,
} from '../src/lib/event-blackout.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// EVT-STOP (operator rulings 2026-09-28, docs/daily/2026-09-28.md §2) — during a SOLD event's
// blocs, every screen of the network stops classic campaigns. This file pins the ONE home of the
// blackout windows: which events black out (sold = ≥ 1 upcoming/active positioning, not annulé;
// only the blocs its live allocations placed), and the pure minute arithmetic planning reads.

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
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `evtstop-${seq}@example.com`,
      contactName: `EVTSTOP ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const KICKOFF = at('2027-03-12T20:00:00+01:00');
const ENDS = at('2027-03-12T22:00:00+01:00');
const bloc = (start: string, end: string) => ({ start, end, impressions: 1000 });
const PRE_LAST = bloc('2027-03-12T18:40:00.000Z', '2027-03-12T19:00:00.000Z');
const POST_FIRST = bloc('2027-03-12T21:00:00.000Z', '2027-03-12T21:20:00.000Z');

interface SeedOpts {
  annule?: boolean;
  status?: 'draft' | 'pending' | 'upcoming' | 'active' | 'completed';
  allocations?: { statut: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE'; blocs: unknown[] }[];
}

const seedSoldEvent = async (opts: SeedOpts = {}): Promise<string> => {
  seq += 1;
  const [event] = await db
    .insert(events)
    .values({
      name: `EVTSTOP Match ${seq}`,
      type: 'sport',
      kickoffAt: KICKOFF,
      endsAt: ENDS,
      source: 'official',
      annule: opts.annule ?? false,
    })
    .returning();
  const advertiserId = await seedUser();
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/evtstop/${seq}`,
      durationSeconds: 15,
      validationStatus: 'approved',
    })
    .returning();
  const [positioning] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `EVTSTOP Positionnement ${seq}`,
      campaignType: 'event',
      status: opts.status ?? 'active',
      startDate: '2027-03-12',
      endDate: '2027-03-12',
      requestedBudget: '200.00',
      eventId: event?.id,
      creativeId: creative?.id,
    })
    .returning();
  for (const a of opts.allocations ?? [{ statut: 'ACCEPTE', blocs: [PRE_LAST, POST_FIRST] }]) {
    const ownerId = await seedUser({ role: 'individual_owner' });
    const [venue] = await db
      .insert(screenhosts)
      .values({ name: `EVTSTOP Venue ${seq}-${Math.random()}`, ownerId })
      .returning();
    await db.insert(eventAllocations).values({
      campaignId: positioning?.id ?? '',
      screenhostId: venue?.id ?? '',
      blocs: a.blocs,
      impressionsTotal: 1000,
      montantTnd: '100.000',
      statut: a.statut,
    });
  }
  return event?.id ?? '';
};

const DAY = { from: at('2027-03-12T00:00:00Z'), to: at('2027-03-13T00:00:00Z') };
const starts = async (): Promise<string[]> =>
  (await soldEventBlackouts(DAY.from, DAY.to)).map((x) => x.start.toISOString());

describe('EVT-STOP — soldEventBlackouts (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('a sold event blacks out exactly the blocs its live allocations placed', async () => {
    await seedSoldEvent();
    expect(await starts()).toEqual([PRE_LAST.start, POST_FIRST.start]);
  });

  it('EN_ATTENTE allocations count (the blocs are held), REFUSE ones do not', async () => {
    await seedSoldEvent({
      allocations: [
        { statut: 'EN_ATTENTE', blocs: [PRE_LAST] },
        { statut: 'REFUSE', blocs: [POST_FIRST] },
      ],
    });
    expect(await starts()).toEqual([PRE_LAST.start]);
  });

  it('unsold events black out nothing: pending (P1 A), draft, annulé', async () => {
    await seedSoldEvent({ status: 'pending' });
    await seedSoldEvent({ status: 'draft' });
    await seedSoldEvent({ annule: true });
    expect(await starts()).toEqual([]);
  });

  it('upcoming counts as sold; completed no longer blacks out', async () => {
    await seedSoldEvent({
      status: 'upcoming',
      allocations: [{ statut: 'ACCEPTE', blocs: [PRE_LAST] }],
    });
    await seedSoldEvent({
      status: 'completed',
      allocations: [{ statut: 'ACCEPTE', blocs: [POST_FIRST] }],
    });
    expect(await starts()).toEqual([PRE_LAST.start]);
  });

  it('only windows overlapping [from, to) are returned', async () => {
    await seedSoldEvent();
    const late = await soldEventBlackouts(at('2027-03-12T20:00:00Z'), DAY.to);
    expect(late.map((x) => x.start.toISOString())).toEqual([POST_FIRST.start]);
  });
});
