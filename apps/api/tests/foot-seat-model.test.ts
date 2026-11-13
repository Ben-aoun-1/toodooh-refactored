import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { campaigns, creatives, eventAllocations, events } from '../src/db/schema.js';
import { runEventDispatch } from '../src/lib/event-dispatch/dispatch.js';
import { activeEventSpots } from '../src/lib/event-playout/spots.js';
import {
  EVENT_SEAT_MODEL,
  EVENT_SEAT_MODEL_MIN1,
  eventMinutesPriceTnd,
  eventPodTimeline,
  eventPodWindow,
  eventSeatImpressions,
  eventSeatModel,
  eventSeatPriceTnd,
  eventSeatsFor,
  orderedEventMinutes,
  takeEventMinutes,
} from '../src/lib/event-pricing/minutes.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import { eventSector, seedVenue } from './helpers/installed-screen-matrix.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// Mariem 04/11/2026 — the Foot seat model: a bloc's pod is 6 minutes, three 2-minute seats, a
// campaign holding at most one seat per bloc and venue (operator: an advertiser reaches 4 or 6
// minutes in a bloc with several campaigns); a seat is priced A_max × R × 1 bloc (the ÷ 3 goes);
// the slider moves 2 minutes at a time. A match sold under EVT-MIN1 keeps its 1-minute seats.
// The match: Thursday 2027-06-10 20:00–22:00 Tunis → blocs 19:00/19:20/19:40 and 22:00/22:20/22:40.

const MODEL = EVENT_SEAT_MODEL;
const MIN1 = EVENT_SEAT_MODEL_MIN1;
const CPM = 15;
const at = (iso: string): Date => new Date(iso);
const fakeVenue = (id: string, amaxPph: number, blocStarts: string[]) => ({
  screenhostId: id,
  ownerId: `owner-${id}`,
  amaxPph,
  blocs: blocStarts.map((start) => ({
    start: at(start),
    end: new Date(at(start).getTime() + 20 * 60 * 1000),
  })),
});

describe('Mariem 04/11 — the 2-minute seat model (pure)', () => {
  it('a match without a mark sells 2-minute seats, 3 per bloc; a marked one keeps EVT-MIN1', () => {
    expect(eventSeatModel(null)).toEqual({ seatMinutes: 2, seatsPerBloc: 3, audienceDivisor: 1 });
    expect(eventSeatModel(2)).toBe(MODEL);
    expect(eventSeatModel(1)).toEqual({ seatMinutes: 1, seatsPerBloc: 5, audienceDivisor: 3 });
  });

  it('A_max × R × blocs: a seat holds the whole A_max, R its plays in the 2 minutes', () => {
    // A_max 100, an 11 s spot: R 5 a minute, 10 in the seat → 1 000 impressions a bloc.
    expect(eventSeatImpressions(100, 5, MODEL)).toBe(1000);
    // Six blocs at that venue: 100 × 10 × 6 = 6 000 — Mariem's formula, per Host.
    expect(6 * eventSeatImpressions(100, 5, MODEL)).toBe(100 * 10 * 6);
    expect(eventSeatPriceTnd(100, CPM, 5, MODEL)).toBe(15);
    // The same 2 minutes cost three times the EVT-MIN1 price (no ÷ 3 any more).
    expect(eventSeatPriceTnd(120, CPM, 5, MODEL)).toBe(
      3 * 2 * eventSeatPriceTnd(120, CPM, 5, MIN1),
    );
    // No spot yet (the catalogue card): the audience alone, once — all of A_max.
    expect(eventSeatImpressions(120, 1, MODEL)).toBe(120);
  });

  it('minutes come in whole seats: 2, 4, 6…; EVT-MIN1 any whole number', () => {
    expect(eventSeatsFor(4, MODEL)).toBe(2);
    expect(eventSeatsFor(2, MODEL)).toBe(1);
    expect(eventSeatsFor(3, MODEL)).toBeNull();
    expect(eventSeatsFor(1, MODEL)).toBeNull();
    expect(eventSeatsFor(3, MIN1)).toBe(3);
  });

  it('the slider gives up 2 minutes at a time, the last venue’s latest bloc first', () => {
    const list = orderedEventMinutes(
      [
        fakeVenue('best', 100, ['2027-06-10T18:00:00Z', '2027-06-10T21:00:00Z']),
        fakeVenue('last', 50, ['2027-06-10T18:00:00Z', '2027-06-10T21:20:00Z']),
      ],
      CPM,
      6, // a 10 s spot: 12 plays a seat
      MODEL,
    );
    // best: 100 × 12 = 1 200 → 18 TND a seat; last: 50 × 12 = 600 → 9 TND.
    expect(list.map((m) => m.priceTnd)).toEqual([18, 18, 9, 9]);
    expect(eventMinutesPriceTnd(list, 8, MODEL)).toBe(54);
    expect(eventMinutesPriceTnd(list, 6, MODEL)).toBe(45); // the last venue's 21:20 bloc is out
    const take = takeEventMinutes(list, 6, 1000, MODEL);
    expect(take.status).toBe('OK');
    if (take.status !== 'OK') return;
    expect(take.placements.map((p) => [p.screenhostId, p.blocs.length])).toEqual([
      ['best', 2],
      ['last', 1],
    ]);
    // An odd count or more than offered never sells; `available` is in minutes.
    expect(takeEventMinutes(list, 3, 1000, MODEL)).toEqual({ status: 'NOT_ENOUGH', available: 8 });
    expect(takeEventMinutes(list, 10, 1000, MODEL)).toEqual({ status: 'NOT_ENOUGH', available: 8 });
  });

  it('the pod: 2 minutes a seat, 6 at most — avant opens the bloc, après closes it', () => {
    const start = at('2027-06-10T18:00:00Z');
    const end = at('2027-06-10T18:20:00Z');
    expect(eventPodWindow('avant', start, end, 3, MODEL)).toEqual({
      start,
      end: at('2027-06-10T18:06:00Z'),
    });
    expect(eventPodWindow('apres', start, end, 1, MODEL)).toEqual({
      start: at('2027-06-10T18:18:00Z'),
      end,
    });
    expect(eventPodWindow('avant', start, end, 5, MODEL)?.end).toEqual(at('2027-06-10T18:06:00Z'));
  });

  it('three campaigns rotate through the 6 minutes, each airing its own 2 minutes', () => {
    const start = at('2027-06-10T18:00:00Z');
    const pod = eventPodTimeline(
      'avant',
      start,
      at('2027-06-10T18:20:00Z'),
      [
        { campaignId: 'A', slotSeconds: 12, spotSeconds: 11 },
        { campaignId: 'B', slotSeconds: 20, spotSeconds: 20 },
        { campaignId: 'C', slotSeconds: 10, spotSeconds: 10 },
        { campaignId: 'D', slotSeconds: 10, spotSeconds: 10 }, // a 4th never airs: 3 seats a bloc
      ],
      MODEL,
    );
    const count = (id: string) => pod?.slots.filter((s) => s.campaignId === id).length;
    expect([count('A'), count('B'), count('C'), count('D')]).toEqual([10, 6, 12, 0]);
    expect(pod?.slots.slice(0, 3).map((s) => s.campaignId)).toEqual(['A', 'B', 'C']);
    // Contiguous to the end of the 6-minute pod.
    pod?.slots.forEach((s, i) => {
      const next = pod.slots[i + 1]?.at ?? pod.end;
      expect(s.at.getTime() + s.seconds * 1000).toBe(next.getTime());
    });
    expect(pod?.end).toEqual(at('2027-06-10T18:06:00Z'));
  });
});

describe('Mariem 04/11 — seats, dispatch and the pod (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  const seedMatch = async (seatMinutes: number | null, day = '2027-06-10') => {
    const kickoffAt = new Date(`${day}T20:00:00+01:00`);
    const endsAt = new Date(`${day}T22:00:00+01:00`);
    const [event] = await db
      .insert(events)
      .values({
        name: `Foot ${day}`,
        type: 'sport',
        source: 'official',
        kickoffAt,
        endsAt,
        seatMinutes,
      })
      .returning({ id: events.id });
    if (!event) throw new Error('no event');
    return { id: event.id, kickoffAt, endsAt, seatMinutes };
  };

  /** A draft positioning with an approved spot of `seconds`, then dispatched and booked. */
  const book = async (
    event: Awaited<ReturnType<typeof seedMatch>>,
    minutes: number,
    seconds: number,
  ) => {
    const advertiserId = await seedApprovedOwner({ role: 'advertiser' });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: 'video',
        storageKey: `creatives/foot-seats/${crypto.randomUUID()}`,
        durationSeconds: seconds,
        validationStatus: 'approved',
      })
      .returning({ id: creatives.id });
    const day = event.kickoffAt.toISOString().slice(0, 10);
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: `Foot ${minutes} min`,
        campaignType: 'event',
        status: 'draft',
        startDate: day,
        endDate: day,
        eventId: event.id,
        creativeId: creative?.id ?? null,
        eventMinutes: minutes,
        requestedBudget: '1000.00',
      })
      .returning();
    if (!c) throw new Error('no positioning');
    const outcome = await runEventDispatch(
      {
        id: c.id,
        name: c.name,
        advertiserId,
        requestedBudget: 1000,
        eventMinutes: minutes,
      },
      event,
      CPM,
    );
    expect(outcome.status).toBe('OK');
    await db.update(campaigns).set({ status: 'upcoming' }).where(eq(campaigns.id, c.id));
    return c.id;
  };

  const oneVenue = async () => {
    const id = await seedVenue('Café Foot', await eventSector());
    await seedInstalledScreen(id);
    return id;
  };

  it('the ceiling: A_max × R × blocs, twelve minutes a venue; EVT-MIN1 matches keep theirs', async () => {
    await oneVenue();
    const match = await seedMatch(null);
    const cmax = await computeEventCmax(match, CPM, new Set(), 5); // a 12 s spot
    expect(cmax.seatMinutes).toBe(2);
    expect(cmax.maxMinutes).toBe(12);
    expect(cmax.iMax).toBe(100 * 10 * 6); // A_max 100 × R 10 a bloc × 6 blocs
    expect(cmax.cMaxEvtTnd).toBe(90); // 6 seats × 15 TND

    const legacy = await seedMatch(1, '2027-06-17');
    const old = await computeEventCmax(legacy, CPM, new Set(), 5);
    expect(old.seatMinutes).toBe(1);
    expect(old.maxMinutes).toBe(6);
    expect(old.iMax).toBe(167 * 6); // A_max ÷ 3 × R 5 a minute
  });

  it('three campaigns fill a bloc; a fourth takes the next bloc', async () => {
    const venue = await oneVenue();
    const match = await seedMatch(null);
    await book(match, 2, 12);
    await book(match, 2, 20);
    const two = await computeEventCmax(match, CPM, new Set(), 5);
    expect(two.maxMinutes).toBe(12); // the 19:00 bloc still has a seat
    await book(match, 2, 10);
    const three = await computeEventCmax(match, CPM, new Set(), 5);
    expect(three.maxMinutes).toBe(10); // the 19:00 bloc is full: 5 blocs left
    expect(three.minutes[0]?.blocStart).toEqual(new Date('2027-06-10T19:20:00+01:00'));
    const fourth = await book(match, 2, 10);
    const [row] = await db
      .select({ blocs: eventAllocations.blocs, screenhostId: eventAllocations.screenhostId })
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, fourth));
    expect(row?.screenhostId).toBe(venue);
    expect((row?.blocs as { start: string }[]).map((b) => b.start)).toEqual([
      new Date('2027-06-10T19:20:00+01:00').toISOString(),
    ]);
  });

  it('the TV gets one 6-minute pod rotating the three campaigns', async () => {
    const venue = await oneVenue();
    const match = await seedMatch(null);
    const ids = [await book(match, 2, 12), await book(match, 2, 20), await book(match, 2, 10)];
    await db.update(eventAllocations).set({ statut: 'ACCEPTE' });
    await db.update(campaigns).set({ status: 'active' });
    const blocStart = new Date('2027-06-10T19:00:00+01:00');
    const spots = await activeEventSpots(venue, new Date(blocStart.getTime() + 10_000));
    expect(spots.map((s) => s.campaignId).sort()).toEqual([...ids].sort());
    const podEnd = new Date(blocStart.getTime() + 6 * 60_000);
    for (const s of spots) expect(s.validUntil).toEqual(podEnd);
    const plays = new Map(spots.map((s) => [s.campaignId, s.slots?.length ?? 0]));
    expect(ids.map((id) => plays.get(id))).toEqual([10, 6, 12]); // 12 s, 20 s, 10 s spots
    const all = spots.flatMap((s) => s.slots ?? []).sort((a, b) => a.at.getTime() - b.at.getTime());
    expect(all[0]?.at).toEqual(blocStart);
    const last = all[all.length - 1];
    expect(last && last.at.getTime() + last.seconds * 1000).toBe(podEnd.getTime());
  });

  it('an EVT-MIN1 match keeps 5 one-minute seats per bloc', async () => {
    await oneVenue();
    const legacy = await seedMatch(1);
    await book(legacy, 1, 12);
    await book(legacy, 1, 20);
    await book(legacy, 1, 10);
    const cmax = await computeEventCmax(legacy, CPM, new Set(), 5);
    expect(cmax.maxMinutes).toBe(6); // three of five seats held: the 19:00 bloc still sells
  });
});
