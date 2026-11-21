import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, creatives, eventAllocations, events, screenhosts } from '../../db/schema.js';
import {
  type EventPod,
  type EventSeatModel,
  eventPodTimeline,
  eventPodWindow,
  eventSeatModel,
  eventSlotSeconds,
} from '../event-pricing/minutes.js';
import { ANTENNE_SECONDS_PER_BLOC } from '../event-pricing/pricing.js';
import { BLOC_MINUTES } from '../fenetre-diffusion.js';
import { airedCreativeTypeSql, airedStorageKeySql, ctaAirableSql } from '../spot-cta.js';

// EV5 — THE EVENT AIRABILITY GATE. An event spot airs on a venue iff ALL hold:
//   • the venue has an ACCEPTE event_allocation for the positioning (the owner said yes),
//   • the positioning is status 'active' (the lifecycle flipped it on its window day),
//   • its event is NOT annulé,
//   • its linked creative is validation_status 'approved' (the content gate — same rule as
//     campaigns; a positioning can only carry an approved spot by EV3's cart gate, but the
//     defense-in-depth read matches activeAllocationsForScreenhost's posture),
//   • and NOW falls inside one of THAT allocation's placed blocs.
//
// The last clause is what makes event playout different from campaign playout: a campaign airs
// all day inside its window, an event airs ONLY during its six 20-minute blocs (and never during
// the match itself — fenetreDiffusion places no bloc there). The bloc pusher (job.ts) re-pushes
// each venue at every bloc edge so the entry appears and disappears on time.
//
// D51 posture: this module reads event tables + the shared creatives/campaigns rows; it does NOT
// import the campaign dispatch engine. computeScreenPlaylist composes both sources.

/**
 * The antenne cadence, per the event grid: 300 broadcast seconds per 20-minute bloc = 900 s/hour,
 * so reps_per_hour = 900 ÷ S. At the reference 15 s spot that is the ruled 60 reps/hour (20 per
 * bloc). Floored to a whole rep and never below 1 — a 30 s legacy spot still airs.
 */
export const EVENT_ANTENNE_SECONDS_PER_HOUR = (ANTENNE_SECONDS_PER_BLOC * 60) / BLOC_MINUTES; // 300 × 3 = 900

export const eventRepsPerHour = (spotSeconds: number): number =>
  spotSeconds > 0 ? Math.max(1, Math.floor(EVENT_ANTENNE_SECONDS_PER_HOUR / spotSeconds)) : 0;

/**
 * EVT-PLAY1 (ruling A, 2026-10-08) — a pod reaches the player this long BEFORE it opens, so the
 * media is downloaded and the slots fire on the player's own clock, to the second. A player that
 * ignores `slots` (≤ 1.4.4) cadences the entry as soon as it arrives — accepted until the fleet
 * runs 1.5.2.
 */
export const EVENT_POD_LEAD_MS = 2 * 60 * 1000;

/** A placed bloc as stored on event_allocations.blocs (EV4's jsonb shape). */
interface StoredBloc {
  start: string;
  end: string;
  impressions: number;
}

const isStoredBloc = (value: unknown): value is StoredBloc => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['start'] === 'string' && typeof v['end'] === 'string';
};

/** Parse the jsonb blocs column defensively (unknown → []). */
export const parseBlocs = (value: unknown): StoredBloc[] =>
  Array.isArray(value) ? value.filter(isStoredBloc) : [];

/** now ∈ [start, end) — the bloc is half-open, so back-to-back blocs never double-air. */
export const blocCoversInstant = (bloc: StoredBloc, now: Date): boolean => {
  const t = now.getTime();
  return t >= new Date(bloc.start).getTime() && t < new Date(bloc.end).getTime();
};

export interface ActiveEventSpot {
  campaignId: string;
  campaignName: string;
  creativeId: string;
  storageKey: string;
  durationSeconds: number | null;
  creativeType: string;
  repsPerHour: number;
  /** FRESH-1 — the end of the bloc (EVT-MIN1: of the POD) airing now: airable until there. */
  validUntil: Date;
  /**
   * EVT-MIN1 — the exact instants this spot starts inside the pod, each owning `seconds` until
   * the next slot (EVT-PLAY1: the spot, plus the round's Toodooh screen on a round's last spot).
   * Absent on positionings dispatched before the minutes model (they keep EV5's spread cadence).
   */
  slots?: { at: Date; seconds: number }[];
}

interface AiringRow {
  screenhostId: string;
  campaignId: string;
  campaignName: string;
  creativeId: string;
  storageKey: string;
  durationSeconds: number | null;
  creativeType: string;
  blocs: unknown;
  eventMinutes: number | null;
  kickoffAt: Date;
  /** events.seat_minutes — the match's seat model (lib/event-pricing/minutes.ts). */
  seatMinutes: number | null;
  allocationCreatedAt: Date;
  status: string;
  campaignUpdatedAt: Date;
}

/** The phase of a bloc: avant blocs end at (or before) kickoff, après blocs start after the match. */
const blocPhase = (bloc: StoredBloc, kickoffAt: Date): 'avant' | 'apres' =>
  new Date(bloc.end).getTime() <= kickoffAt.getTime() ? 'avant' : 'apres';

/**
 * EVT-MIN1 — the pod of one bloc at one venue, from its ACCEPTE minutes seats: first-booked seat
 * first (allocation created_at, then campaign id), each at its spot's slot class.
 */
const podOf = (
  bloc: StoredBloc,
  kickoffAt: Date,
  seatRows: readonly AiringRow[],
  model: EventSeatModel,
): EventPod | null => {
  const ordered = [...seatRows].sort((a, b) => {
    const t = a.allocationCreatedAt.getTime() - b.allocationCreatedAt.getTime();
    return t !== 0 ? t : a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0;
  });
  return eventPodTimeline(
    blocPhase(bloc, kickoffAt),
    new Date(bloc.start),
    new Date(bloc.end),
    ordered.map((r) => {
      // A spot validated before EVT-MIN1 may sit outside the classes: it airs in a 30 s slot.
      const slotSeconds = eventSlotSeconds(r.creativeType, r.durationSeconds) ?? 30;
      // An image shows for its whole chosen length; a video plays its own length.
      const spotSeconds =
        r.creativeType === 'video' && r.durationSeconds !== null ? r.durationSeconds : slotSeconds;
      return { campaignId: r.campaignId, slotSeconds, spotSeconds };
    }),
    model,
  );
};

/** The minutes positionings of ONE venue that hold a seat in the bloc starting at `bloc.start`. */
const seatsOfBloc = (rows: readonly AiringRow[], bloc: StoredBloc): AiringRow[] =>
  rows.filter(
    (r) =>
      r.eventMinutes !== null &&
      parseBlocs(r.blocs).some(
        (b) => new Date(b.start).getTime() === new Date(bloc.start).getTime(),
      ),
  );

const airingRows = async (
  screenhostIds: readonly string[],
  opts: { settled?: boolean } = {},
): Promise<AiringRow[]> =>
  db
    .select({
      screenhostId: eventAllocations.screenhostId,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      creativeId: creatives.id,
      // Mariem 04/11 (Foot point 1) — the QR copy when the positioning has one (a photo's copy
      // is a video of the photo's own length: the pod slots it the same way).
      storageKey: airedStorageKeySql(),
      durationSeconds: creatives.durationSeconds,
      creativeType: airedCreativeTypeSql(),
      blocs: eventAllocations.blocs,
      eventMinutes: campaigns.eventMinutes,
      kickoffAt: events.kickoffAt,
      seatMinutes: events.seatMinutes,
      allocationCreatedAt: eventAllocations.createdAt,
      status: campaigns.status,
      campaignUpdatedAt: campaigns.updatedAt,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(
      and(
        inArray(eventAllocations.screenhostId, [...screenhostIds]),
        eq(eventAllocations.statut, 'ACCEPTE'),
        opts.settled
          ? inArray(campaigns.status, ['active', 'completed'])
          : eq(campaigns.status, 'active'),
        eq(events.annule, false),
        eq(creatives.validationStatus, 'approved'),
        // A positioning with a call to action airs only once its QR copy is ready.
        ctaAirableSql(),
      ),
    );

/**
 * The venue's event spots airable RIGHT NOW. A positioning dispatched before EVT-MIN1 airs for its
 * whole bloc at EV5's spread cadence (900 ÷ S). A minutes positioning airs only inside its bloc's
 * POD (ruling 6B: the rest of the bloc stays dark), at its exact slots — and EVT-PLAY1 hands the
 * pod to the player {@link EVENT_POD_LEAD_MS} before it opens.
 *
 * `opts.wholeBloc` widens the minutes gate to the whole bloc — proof INGEST uses it, so a
 * VIDEO_ENDED received just after the pod closes (network latency) is still credited to its bloc,
 * exactly what settlement measures.
 */
export const activeEventSpots = async (
  screenhostId: string,
  now: Date,
  opts: { wholeBloc?: boolean } = {},
): Promise<ActiveEventSpot[]> => {
  const rows = await airingRows([screenhostId]);

  const spots: ActiveEventSpot[] = [];
  const t = now.getTime();
  for (const row of rows) {
    const base = {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      creativeId: row.creativeId,
      storageKey: row.storageKey,
      durationSeconds: row.durationSeconds,
      creativeType: row.creativeType,
    };
    if (row.eventMinutes === null) {
      const airing = parseBlocs(row.blocs).find((bloc) => blocCoversInstant(bloc, now));
      if (!airing) continue;
      spots.push({
        ...base,
        repsPerHour: eventRepsPerHour(row.durationSeconds ?? 0),
        validUntil: new Date(airing.end),
      });
      continue;
    }
    // A minutes spot: the bloc covering now (proof ingest, wholeBloc), or the bloc whose POD is
    // airing or opens within the lead (the playlist).
    for (const bloc of parseBlocs(row.blocs)) {
      if (opts.wholeBloc && !blocCoversInstant(bloc, now)) continue;
      // The seats of THIS bloc at this venue: every minutes positioning with an ACCEPTE
      // allocation covering the same bloc start.
      const seatRows = seatsOfBloc(rows, bloc);
      const pod = podOf(bloc, row.kickoffAt, seatRows, eventSeatModel(row.seatMinutes));
      if (!pod) continue;
      // The announce edge is INCLUDED: the pusher fires exactly at pod start − lead.
      if (
        !opts.wholeBloc &&
        (pod.end.getTime() <= t || pod.start.getTime() > t + EVENT_POD_LEAD_MS)
      )
        continue;
      const own = pod.slots.filter((slot) => slot.campaignId === row.campaignId);
      const podSeconds = (pod.end.getTime() - pod.start.getTime()) / 1000;
      spots.push({
        ...base,
        // Older players space by reps/hour: own plays spread over the pod's length.
        repsPerHour: podSeconds > 0 ? Math.max(1, Math.round((own.length * 3600) / podSeconds)) : 0,
        validUntil: pod.end,
        slots: own.map((slot) => ({ at: slot.at, seconds: slot.seconds })),
      });
      break;
    }
  }
  return spots;
};

/** One ad page (pod) of a venue: its window and every pass in it, in airing order. */
export interface VenuePod {
  start: Date;
  end: Date;
  slots: { at: Date; campaignId: string; campaignName: string }[];
}

/** The pods of ONE venue's airable rows: one per bloc (a pre-minutes positioning: its whole bloc). */
const podsOfVenue = (rows: readonly AiringRow[]): VenuePod[] => {
  const pods: VenuePod[] = [];
  const seen = new Set<number>();
  // A venue whose positionings are ALL closed (settled after the match, or stopped) aired its
  // pages up to that moment only: a page planned after it never reached the TVs.
  const airedUntil = rows.some((r) => r.status === 'active')
    ? Number.POSITIVE_INFINITY
    : Math.max(...rows.map((r) => r.campaignUpdatedAt.getTime()));
  for (const row of rows) {
    for (const bloc of parseBlocs(row.blocs)) {
      const start = new Date(bloc.start);
      const end = new Date(bloc.end);
      if (row.eventMinutes === null) {
        // EV5's spread cadence: 900 ÷ S passes an hour, evenly over the bloc.
        const lengthMs = end.getTime() - start.getTime();
        const n = Math.max(
          1,
          Math.round((eventRepsPerHour(row.durationSeconds ?? 0) * lengthMs) / 3_600_000),
        );
        pods.push({
          start,
          end,
          slots: Array.from({ length: n }, (_, i) => ({
            at: new Date(start.getTime() + (i * lengthMs) / n),
            campaignId: row.campaignId,
            campaignName: row.campaignName,
          })),
        });
        continue;
      }
      if (seen.has(start.getTime())) continue;
      seen.add(start.getTime());
      const seatRows = seatsOfBloc(rows, bloc);
      const pod = podOf(bloc, row.kickoffAt, seatRows, eventSeatModel(row.seatMinutes));
      if (!pod) continue;
      const names = new Map(seatRows.map((r) => [r.campaignId, r.campaignName]));
      pods.push({
        start: pod.start,
        end: pod.end,
        slots: pod.slots.map((slot) => ({
          at: slot.at,
          campaignId: slot.campaignId,
          campaignName: names.get(slot.campaignId) ?? '',
        })),
      });
    }
  }
  return pods
    .filter((p) => p.end.getTime() <= airedUntil)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
};

/**
 * FLEET-3 — every ad page (pod) the given venues air inside [from, to), through the SAME gate and
 * the SAME timeline as the playlist ({@link activeEventSpots}), so the « Parc d'écrans » expects
 * exactly what the TVs were handed — and keeps the pages of a match already settled, so the day's
 * count does not lose them. Venues without a positioning are absent.
 */
export const venueEventPods = async (
  screenhostIds: readonly string[],
  from: Date,
  to: Date,
): Promise<Map<string, VenuePod[]>> => {
  const out = new Map<string, VenuePod[]>();
  if (screenhostIds.length === 0) return out;
  const byVenue = new Map<string, AiringRow[]>();
  // The day's pages stay in the read once their match is settled (status « completed »).
  for (const row of await airingRows(screenhostIds, { settled: true })) {
    const list = byVenue.get(row.screenhostId) ?? [];
    list.push(row);
    byVenue.set(row.screenhostId, list);
  }
  for (const [venueId, rows] of byVenue) {
    const pods = podsOfVenue(rows).filter(
      (p) => p.end.getTime() > from.getTime() && p.start.getTime() < to.getTime(),
    );
    if (pods.length > 0) out.set(venueId, pods);
  }
  return out;
};

/**
 * Every venue holding an ACCEPTE allocation whose bloc EDGE — or, EVT-MIN1, POD edge — falls in
 * (since, until] — the bloc pusher's scan. A start edge makes the spot appear, an end edge makes
 * it disappear; both need the same UPDATE_PLAYLIST re-push. An après pod opens mid-bloc and an
 * avant pod closes mid-bloc, so those instants are edges too.
 */
export const venuesAtBlocEdge = async (since: Date, until: Date): Promise<string[]> => {
  const rows = await db
    .select({
      screenhostId: eventAllocations.screenhostId,
      blocs: eventAllocations.blocs,
      eventMinutes: campaigns.eventMinutes,
      kickoffAt: events.kickoffAt,
      seatMinutes: events.seatMinutes,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .innerJoin(screenhosts, eq(eventAllocations.screenhostId, screenhosts.id))
    .where(
      and(
        eq(eventAllocations.statut, 'ACCEPTE'),
        eq(campaigns.status, 'active'),
        eq(events.annule, false),
      ),
    );
  const sinceMs = since.getTime();
  const untilMs = until.getTime();
  const edged = new Set<string>();
  // EVT-MIN1 — seats per (venue, bloc) of minutes positionings, to size each pod.
  const seats = new Map<
    string,
    { venue: string; bloc: StoredBloc; kickoffAt: Date; model: EventSeatModel; n: number }
  >();
  for (const row of rows) {
    for (const bloc of parseBlocs(row.blocs)) {
      for (const edge of [new Date(bloc.start).getTime(), new Date(bloc.end).getTime()]) {
        if (edge > sinceMs && edge <= untilMs) edged.add(row.screenhostId);
      }
      if (row.eventMinutes !== null) {
        const key = `${row.screenhostId}|${new Date(bloc.start).toISOString()}`;
        const cell = seats.get(key) ?? {
          venue: row.screenhostId,
          bloc,
          kickoffAt: row.kickoffAt,
          model: eventSeatModel(row.seatMinutes),
          n: 0,
        };
        cell.n += 1;
        seats.set(key, cell);
      }
    }
  }
  for (const cell of seats.values()) {
    const pod = eventPodWindow(
      blocPhase(cell.bloc, cell.kickoffAt),
      new Date(cell.bloc.start),
      new Date(cell.bloc.end),
      cell.n,
      cell.model,
    );
    if (!pod) continue;
    // EVT-PLAY1 — the pod is announced EVENT_POD_LEAD_MS before it opens, dropped when it closes.
    for (const edge of [pod.start.getTime() - EVENT_POD_LEAD_MS, pod.end.getTime()]) {
      if (edge > sinceMs && edge <= untilMs) edged.add(cell.venue);
    }
  }
  return [...edged];
};
