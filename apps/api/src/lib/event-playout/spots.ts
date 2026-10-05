import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, creatives, eventAllocations, events, screenhosts } from '../../db/schema.js';
import {
  type EventPod,
  eventPodTimeline,
  eventPodWindow,
  eventSlotSeconds,
} from '../event-pricing/minutes.js';
import { ANTENNE_SECONDS_PER_BLOC } from '../event-pricing/pricing.js';
import { BLOC_MINUTES } from '../fenetre-diffusion.js';

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
   * EVT-MIN1 — the exact instants this spot starts inside the pod, each owning `slotSeconds`
   * (the spot, then the Toodooh screen until the slot ends). Absent on positionings dispatched
   * before the minutes model (they keep EV5's spread cadence).
   */
  slots?: { at: Date; seconds: number }[];
}

interface AiringRow {
  campaignId: string;
  campaignName: string;
  creativeId: string;
  storageKey: string;
  durationSeconds: number | null;
  creativeType: string;
  blocs: unknown;
  eventMinutes: number | null;
  kickoffAt: Date;
  allocationCreatedAt: Date;
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
): EventPod | null => {
  const ordered = [...seatRows].sort((a, b) => {
    const t = a.allocationCreatedAt.getTime() - b.allocationCreatedAt.getTime();
    return t !== 0 ? t : a.campaignId < b.campaignId ? -1 : a.campaignId > b.campaignId ? 1 : 0;
  });
  return eventPodTimeline(
    blocPhase(bloc, kickoffAt),
    new Date(bloc.start),
    new Date(bloc.end),
    ordered.map((r) => ({
      campaignId: r.campaignId,
      // A spot validated before EVT-MIN1 may sit outside the classes: it airs in a 30 s slot.
      slotSeconds: eventSlotSeconds(r.creativeType, r.durationSeconds) ?? 30,
    })),
  );
};

const airingRows = async (screenhostId: string): Promise<AiringRow[]> =>
  db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      creativeId: creatives.id,
      storageKey: creatives.storageKey,
      durationSeconds: creatives.durationSeconds,
      creativeType: creatives.creativeType,
      blocs: eventAllocations.blocs,
      eventMinutes: campaigns.eventMinutes,
      kickoffAt: events.kickoffAt,
      allocationCreatedAt: eventAllocations.createdAt,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(
      and(
        eq(eventAllocations.screenhostId, screenhostId),
        eq(eventAllocations.statut, 'ACCEPTE'),
        eq(campaigns.status, 'active'),
        eq(events.annule, false),
        eq(creatives.validationStatus, 'approved'),
      ),
    );

/**
 * The venue's event spots airable RIGHT NOW. A positioning dispatched before EVT-MIN1 airs for its
 * whole bloc at EV5's spread cadence (900 ÷ S). A minutes positioning airs only inside its bloc's
 * POD (ruling 6B: the rest of the bloc stays dark), at its exact slots.
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
  const rows = await airingRows(screenhostId);

  const spots: ActiveEventSpot[] = [];
  for (const row of rows) {
    const airing = parseBlocs(row.blocs).find((bloc) => blocCoversInstant(bloc, now));
    if (!airing) continue;
    const base = {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      creativeId: row.creativeId,
      storageKey: row.storageKey,
      durationSeconds: row.durationSeconds,
      creativeType: row.creativeType,
    };
    if (row.eventMinutes === null) {
      spots.push({
        ...base,
        repsPerHour: eventRepsPerHour(row.durationSeconds ?? 0),
        validUntil: new Date(airing.end),
      });
      continue;
    }
    // The seats of THIS bloc at this venue: every minutes positioning with an ACCEPTE allocation
    // covering the same bloc start.
    const seatRows = rows.filter(
      (r) =>
        r.eventMinutes !== null &&
        parseBlocs(r.blocs).some(
          (b) => new Date(b.start).getTime() === new Date(airing.start).getTime(),
        ),
    );
    const pod = podOf(airing, row.kickoffAt, seatRows);
    if (!pod) continue;
    const t = now.getTime();
    if (!opts.wholeBloc && (t < pod.start.getTime() || t >= pod.end.getTime())) continue;
    const own = pod.slots.filter((slot) => slot.campaignId === row.campaignId);
    const podSeconds = (pod.end.getTime() - pod.start.getTime()) / 1000;
    spots.push({
      ...base,
      // Older players space by reps/hour: own plays spread over the pod's length.
      repsPerHour: podSeconds > 0 ? Math.max(1, Math.round((own.length * 3600) / podSeconds)) : 0,
      validUntil: pod.end,
      slots: own.map((slot) => ({ at: slot.at, seconds: slot.slotSeconds })),
    });
  }
  return spots;
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
  const seats = new Map<string, { venue: string; bloc: StoredBloc; kickoffAt: Date; n: number }>();
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
    );
    if (!pod) continue;
    for (const edge of [pod.start.getTime(), pod.end.getTime()]) {
      if (edge > sinceMs && edge <= untilMs) edged.add(cell.venue);
    }
  }
  return [...edged];
};
