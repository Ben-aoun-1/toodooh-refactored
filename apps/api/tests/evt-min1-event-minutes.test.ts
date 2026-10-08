import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { campaigns, creatives, eventAllocations, hourReservations } from '../src/db/schema.js';
import { runEventDispatch } from '../src/lib/event-dispatch/dispatch.js';
import { activeEventSpots, venuesAtBlocEdge } from '../src/lib/event-playout/spots.js';
import {
  EVENT_SLOT_CLASSES,
  type EventMinute,
  eventMinutePriceTnd,
  eventMinutesPriceTnd,
  eventPlaysPerMinute,
  eventPodTimeline,
  eventPodWindow,
  eventSlotSeconds,
  orderedEventMinutes,
  takeEventMinutes,
} from '../src/lib/event-pricing/minutes.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';
import { computeScreenPlaylist } from '../src/lib/playout/playlist-service.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import {
  MATCH_KICKOFF,
  MATCH_ENDS,
  eventSector,
  seedVenue,
} from './helpers/installed-screen-matrix.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// EVT-MIN1 (operator rulings 2026-10-05) — the event MINUTES model:
//   • a bloc's 5-minute pod holds five one-minute seats; one minute = one seat in one bloc at one
//     venue, priced CPM_evt × A_max × 4 ÷ 1000 (1A), sold from an ordered list (venues SPS desc,
//     blocs chronological) whose tail — the last venue's latest bloc — goes first (3A);
//   • minimum one minute, no 100 TND floor, no N_max, no miette, never a silent partial (4A);
//   • the pod ROTATES its seats (5B) and lasts seats × 1 min (5C): avant blocs open with it,
//     après blocs close with it; the rest of the bloc stays dark (6B);
//   • a video lasts 10–30 s and airs in the smallest slot dividing the minute (7A).
// The match: Thursday 2027-06-10 20:00–22:00 Tunis → blocs 19:00/19:20/19:40 and 22:00/22:20/22:40.

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

describe('EVT-MIN1 — the pure rules', () => {
  it('slot classes: the smallest divisor of the minute ≥ the length; outside 10–30 s refused', () => {
    expect(EVENT_SLOT_CLASSES).toEqual([10, 12, 15, 20, 30]);
    expect(eventSlotSeconds('video', 10)).toBe(10);
    expect(eventSlotSeconds('video', 11)).toBe(12);
    expect(eventSlotSeconds('video', 13)).toBe(15);
    expect(eventSlotSeconds('video', 16)).toBe(20);
    expect(eventSlotSeconds('video', 23)).toBe(30); // 23 s of spot + 7 s of Toodooh screen
    expect(eventSlotSeconds('video', 30)).toBe(30);
    expect(eventSlotSeconds('video', 9)).toBeNull();
    expect(eventSlotSeconds('video', 31)).toBeNull();
    expect(eventSlotSeconds('photo', 20)).toBe(20);
    expect(eventSlotSeconds('photo', 15)).toBeNull(); // images: 10, 20 or 30 s only
    for (const c of EVENT_SLOT_CLASSES) expect(eventPlaysPerMinute(c) * c).toBe(60);
  });

  it('a minute = CPM × A_max × 4 ÷ 1000, to the centime', () => {
    expect(eventMinutePriceTnd(100, 15)).toBe(6);
    expect(eventMinutePriceTnd(37, 15)).toBe(2.22);
    expect(eventMinutePriceTnd(37, 12.5)).toBe(1.85);
  });

  it('the ordered list: venues in pool order, blocs chronological; the slider drops the tail first', () => {
    const list = orderedEventMinutes(
      [
        fakeVenue('best', 100, ['2027-06-10T21:00:00Z', '2027-06-10T18:00:00Z']),
        fakeVenue('last', 50, ['2027-06-10T18:00:00Z', '2027-06-10T21:20:00Z']),
      ],
      CPM,
    );
    expect(list.map((m) => `${m.screenhostId}@${m.blocStart.toISOString().slice(11, 16)}`)).toEqual(
      ['best@18:00', 'best@21:00', 'last@18:00', 'last@21:20'],
    );
    // 3 minutes = everything but the LAST venue's LATEST bloc.
    expect(eventMinutesPriceTnd(list, 3)).toBe(6 + 6 + 3);
    expect(eventMinutesPriceTnd(list, 4)).toBe(18);
  });

  it('take: grouped per venue, all or nothing, charge capped at the budget', () => {
    const list: EventMinute[] = orderedEventMinutes(
      [
        fakeVenue('a', 100, ['2027-06-10T18:00:00Z', '2027-06-10T18:20:00Z']),
        fakeVenue('b', 50, ['2027-06-10T18:00:00Z']),
      ],
      CPM,
    );
    const take = takeEventMinutes(list, 3, 15);
    expect(take.status).toBe('OK');
    if (take.status !== 'OK') return;
    expect(take.placements.map((p) => [p.screenhostId, p.blocs.length, p.montantTnd])).toEqual([
      ['a', 2, 12],
      ['b', 1, 3],
    ]);
    expect(take.impressions).toBe(2 * 400 + 200);
    // A_max rose since the budget was set: the overshoot is free delivery, never a charge.
    const capped = takeEventMinutes(list, 3, 14);
    expect(capped.status === 'OK' && capped.chargedTnd).toBe(14);
    expect(takeEventMinutes(list, 4, 100)).toEqual({ status: 'NOT_ENOUGH', available: 3 });
    expect(takeEventMinutes(list, 0, 100).status).toBe('NOT_ENOUGH');
  });

  it('the pod window: avant opens the bloc, après closes it, one minute per seat', () => {
    const start = at('2027-06-10T18:00:00Z');
    const end = at('2027-06-10T18:20:00Z');
    expect(eventPodWindow('avant', start, end, 2)).toEqual({
      start,
      end: at('2027-06-10T18:02:00Z'),
    });
    expect(eventPodWindow('apres', start, end, 3)).toEqual({
      start: at('2027-06-10T18:17:00Z'),
      end,
    });
    expect(eventPodWindow('avant', start, end, 0)).toBeNull();
    expect(eventPodWindow('avant', start, end, 9)?.end).toEqual(at('2027-06-10T18:05:00Z'));
  });

  it('the pod timeline rotates the seats, back to back, exactly seats × 60 s', () => {
    const pod = eventPodTimeline('avant', at('2027-06-10T18:00:00Z'), at('2027-06-10T18:20:00Z'), [
      { campaignId: 'A', slotSeconds: 30, spotSeconds: 30 },
      { campaignId: 'B', slotSeconds: 10, spotSeconds: 10 },
    ]);
    expect(
      pod?.slots.map(
        (s) => `${s.campaignId}+${(s.at.getTime() - Date.parse('2027-06-10T18:00:00Z')) / 1000}`,
      ),
    ).toEqual(['A+0', 'B+30', 'A+40', 'B+70', 'B+80', 'B+90', 'B+100', 'B+110']);
    const last = pod?.slots[pod.slots.length - 1];
    expect(last && last.at.getTime() + last.seconds * 1000).toBe(pod?.end.getTime());
    expect(pod?.slots.filter((s) => s.campaignId === 'A')).toHaveLength(2);
    expect(pod?.slots.filter((s) => s.campaignId === 'B')).toHaveLength(6);
  });

  it('EVT-PLAY1 — a round plays its spots back to back, then ONE Toodooh gap: A11 B18 T3', () => {
    // The operator's example: A 11 s (12 s slot, 5 plays), B 18 s (20 s slot, 3 plays).
    const start = at('2027-06-10T18:00:00Z');
    const pod = eventPodTimeline('avant', start, at('2027-06-10T18:20:00Z'), [
      { campaignId: 'A', slotSeconds: 12, spotSeconds: 11 },
      { campaignId: 'B', slotSeconds: 20, spotSeconds: 18 },
    ]);
    const rel = (d: Date) => (d.getTime() - start.getTime()) / 1000;
    expect(pod?.slots.map((s) => [s.campaignId, rel(s.at), s.spotSeconds, s.seconds])).toEqual([
      ['A', 0, 11, 11],
      ['B', 11, 18, 21], // 18 s of B, then the round's 1 + 2 = 3 s of Toodooh screen
      ['A', 32, 11, 11],
      ['B', 43, 18, 21],
      ['A', 64, 11, 11],
      ['B', 75, 18, 21],
      ['A', 96, 11, 12], // B's minute is spent: A 11 s, then 1 s of Toodooh screen
      ['A', 108, 11, 12],
    ]);
    // Contiguous: every slot owns exactly up to the next one, the last one up to the pod end.
    pod?.slots.forEach((s, i) => {
      const next = pod.slots[i + 1]?.at ?? pod.end;
      expect(s.at.getTime() + s.seconds * 1000).toBe(next.getTime());
    });
    expect(rel(pod?.end ?? start)).toBe(120);
  });

  it('EVT-PLAY1 — images and exact-class videos leave no gap; a spot never outgrows its slot', () => {
    const start = at('2027-06-10T18:00:00Z');
    const pod = eventPodTimeline('avant', start, at('2027-06-10T18:20:00Z'), [
      { campaignId: 'I', slotSeconds: 20, spotSeconds: 20 },
      { campaignId: 'X', slotSeconds: 15, spotSeconds: 99 },
    ]);
    const rel = (d: Date) => (d.getTime() - start.getTime()) / 1000;
    expect(pod?.slots.map((s) => [s.campaignId, rel(s.at), s.seconds])).toEqual([
      ['I', 0, 20],
      ['X', 20, 15],
      ['I', 35, 20],
      ['X', 55, 15],
      ['I', 70, 20],
      ['X', 90, 15],
      ['X', 105, 15],
    ]);
  });
});

describe('EVT-MIN1 — seats, dispatch and airing (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  const seedMatchEvent = async () => {
    const { events } = await import('../src/db/schema.js');
    const [event] = await db
      .insert(events)
      .values({
        name: 'EVT-MIN1 Match',
        type: 'sport',
        source: 'official',
        kickoffAt: MATCH_KICKOFF,
        endsAt: MATCH_ENDS,
      })
      .returning({ id: events.id });
    if (!event) throw new Error('no event');
    return { id: event.id, kickoffAt: MATCH_KICKOFF, endsAt: MATCH_ENDS };
  };

  const seedMinutesPositioning = async (
    eventId: string,
    minutes: number | null,
    spot: { type?: 'video' | 'photo'; seconds?: number } = {},
  ) => {
    const advertiserId = await seedApprovedOwner({ role: 'advertiser' });
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: spot.type ?? 'video',
        storageKey: `creatives/evt-min1/${crypto.randomUUID()}`,
        durationSeconds: spot.seconds ?? 23,
        validationStatus: 'approved',
      })
      .returning({ id: creatives.id });
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: `EVT-MIN1 ${minutes ?? 'legacy'}`,
        campaignType: 'event',
        status: 'draft',
        startDate: '2027-06-10',
        endDate: '2027-06-10',
        eventId,
        creativeId: creative?.id ?? null,
        eventMinutes: minutes,
        requestedBudget: '1000.00',
      })
      .returning();
    if (!c) throw new Error('no positioning');
    return c;
  };

  const dispatch = async (
    c: Awaited<ReturnType<typeof seedMinutesPositioning>>,
    event: Awaited<ReturnType<typeof seedMatchEvent>>,
  ) => {
    const outcome = await runEventDispatch(
      {
        id: c.id,
        name: c.name,
        advertiserId: c.advertiserId,
        requestedBudget: Number(c.requestedBudget),
        eventMinutes: c.eventMinutes,
      },
      event,
      CPM,
    );
    // Booked = the EVT-STOP « sold » set: its allocations now hold seats.
    await db.update(campaigns).set({ status: 'upcoming' }).where(eq(campaigns.id, c.id));
    return outcome;
  };

  const oneVenue = async () => {
    const id = await seedVenue('EVT-MIN1 Café', await eventSector());
    await seedInstalledScreen(id);
    return id;
  };

  it('the ceiling: one minute per bloc with a free seat; 5 seats fill a bloc; a legacy allocation fills all 5', async () => {
    await oneVenue();
    const event = await seedMatchEvent();
    const fresh = await computeEventCmax(event, CPM);
    expect(fresh.maxMinutes).toBe(6);
    expect(fresh.cMaxEvtTnd).toBe(36); // 6 × 15 × 100 × 4 / 1000

    // Five screencasters take one minute each: every one lands on the FIRST bloc (19:00 Tunis).
    for (let i = 0; i < 5; i += 1) {
      expect((await dispatch(await seedMinutesPositioning(event.id, 1), event)).status).toBe('OK');
    }
    const after5 = await computeEventCmax(event, CPM);
    expect(after5.maxMinutes).toBe(5);
    expect(after5.minutes[0]?.blocStart.toISOString()).toBe('2027-06-10T18:20:00.000Z');

    // A positioning from before the model (event_minutes NULL) holds its blocs WHOLE.
    expect((await dispatch(await seedMinutesPositioning(event.id, null), event)).status).toBe('OK');
    expect((await computeEventCmax(event, CPM)).maxMinutes).toBe(0);
  });

  it('dispatch takes the first N minutes; more than are free refuses and writes NOTHING', async () => {
    await oneVenue();
    const event = await seedMatchEvent();
    const c = await seedMinutesPositioning(event.id, 4);
    expect((await dispatch(c, event)).status).toBe('OK');
    const [placed] = await db
      .select()
      .from(eventAllocations)
      .where(eq(eventAllocations.campaignId, c.id));
    expect(placed?.statut).toBe('EN_ATTENTE');
    expect((placed?.blocs as { start: string }[]).map((b) => b.start)).toEqual([
      '2027-06-10T18:00:00.000Z',
      '2027-06-10T18:20:00.000Z',
      '2027-06-10T18:40:00.000Z',
      '2027-06-10T21:00:00.000Z',
    ]);
    expect(placed?.impressionsTotal).toBe(4 * 400);
    expect(Number(placed?.montantTnd)).toBe(24);

    const greedy = await seedMinutesPositioning(event.id, 7);
    expect(await dispatch(greedy, event)).toEqual({
      status: 'MINUTES_UNAVAILABLE',
      availableMinutes: 6,
    });
    expect(
      await db.select().from(eventAllocations).where(eq(eventAllocations.campaignId, greedy.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(hourReservations).where(eq(hourReservations.eventId, event.id)),
    ).not.toHaveLength(0);
  });

  it('airing: only inside the pod, at its exact slots; the whole bloc credits a proof', async () => {
    const venue = await oneVenue();
    const event = await seedMatchEvent();
    const a = await seedMinutesPositioning(event.id, 6, { seconds: 23 }); // 30 s class
    const b = await seedMinutesPositioning(event.id, 6, { seconds: 10 }); // 10 s class
    for (const c of [a, b]) {
      await dispatch(c, event);
      await db
        .update(eventAllocations)
        .set({ statut: 'ACCEPTE' })
        .where(eq(eventAllocations.campaignId, c.id));
      await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, c.id));
    }

    // Avant bloc 19:00 Tunis (18:00Z): the pod is 18:00–18:02Z, A booked first.
    const inPod = await activeEventSpots(venue, at('2027-06-10T18:00:30Z'));
    expect(inPod.map((s) => s.campaignId).sort()).toEqual([a.id, b.id].sort());
    const spotA = inPod.find((s) => s.campaignId === a.id);
    expect(spotA?.validUntil.toISOString()).toBe('2027-06-10T18:02:00.000Z');
    // EVT-PLAY1 — A opens each round (23 s), B closes it and owns the round's 7 s of Toodooh.
    expect(spotA?.slots?.map((s) => [s.at.toISOString().slice(14, 19), s.seconds])).toEqual([
      ['00:00', 23],
      ['00:40', 23],
    ]);
    expect(
      inPod
        .find((s) => s.campaignId === b.id)
        ?.slots?.map((s) => [s.at.toISOString().slice(14, 19), s.seconds]),
    ).toEqual([
      ['00:23', 17],
      ['01:03', 17],
      ['01:20', 10],
      ['01:30', 10],
      ['01:40', 10],
      ['01:50', 10],
    ]);
    expect(await activeEventSpots(venue, at('2027-06-10T18:05:00Z'))).toEqual([]);
    expect(
      (await activeEventSpots(venue, at('2027-06-10T18:05:00Z'), { wholeBloc: true })).length,
    ).toBe(2);

    // Après bloc 22:40 Tunis (21:40Z): the pod CLOSES the bloc — 21:58–22:00Z. EVT-PLAY1: the
    // playlist carries it EVENT_POD_LEAD_MS (2 min) before it opens, so the media is on the TV.
    expect(await activeEventSpots(venue, at('2027-06-10T21:55:59Z'))).toEqual([]);
    expect((await activeEventSpots(venue, at('2027-06-10T21:56:00Z'))).length).toBe(2);
    expect((await activeEventSpots(venue, at('2027-06-10T21:58:00Z'))).length).toBe(2);
    expect(await activeEventSpots(venue, at('2027-06-10T22:00:00Z'))).toEqual([]);

    // The wire: the slots and the server clock ride the event entries only.
    const playlist = await computeScreenPlaylist(venue, at('2027-06-10T18:00:30Z'));
    const entry = playlist.videos.find((v) => v.id === a.id);
    expect(entry?.slots).toEqual([
      { at: '2027-06-10T18:00:00.000Z', seconds: 23 },
      { at: '2027-06-10T18:00:40.000Z', seconds: 23 },
    ]);
    expect(playlist.server_time).toBe('2027-06-10T18:00:30.000Z');

    // The bloc pusher fires at the mid-bloc pod edges too — the après pod is ANNOUNCED 2 min
    // before it opens (EVT-PLAY1), and dropped when the avant pod closes.
    expect(await venuesAtBlocEdge(at('2027-06-10T18:01:30Z'), at('2027-06-10T18:02:00Z'))).toEqual([
      venue,
    ]);
    expect(await venuesAtBlocEdge(at('2027-06-10T21:55:30Z'), at('2027-06-10T21:56:00Z'))).toEqual([
      venue,
    ]);
    expect(await venuesAtBlocEdge(at('2027-06-10T18:05:00Z'), at('2027-06-10T18:06:00Z'))).toEqual(
      [],
    );
  });
});
