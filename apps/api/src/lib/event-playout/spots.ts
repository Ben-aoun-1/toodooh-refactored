import { and, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, creatives, eventAllocations, events, screenhosts } from '../../db/schema.js';
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
}

/**
 * The venue's event spots airable RIGHT NOW (usually zero or one — a venue can hold allocations
 * for several events, but EV2's placement-time foreign-reservation exclusion guarantees no two
 * events own the same venue-hour, so overlapping blocs cannot occur).
 */
export const activeEventSpots = async (
  screenhostId: string,
  now: Date,
): Promise<ActiveEventSpot[]> => {
  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      creativeId: creatives.id,
      storageKey: creatives.storageKey,
      durationSeconds: creatives.durationSeconds,
      creativeType: creatives.creativeType,
      blocs: eventAllocations.blocs,
      annule: events.annule,
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

  const spots: ActiveEventSpot[] = [];
  for (const row of rows) {
    if (!parseBlocs(row.blocs).some((bloc) => blocCoversInstant(bloc, now))) continue;
    spots.push({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      creativeId: row.creativeId,
      storageKey: row.storageKey,
      durationSeconds: row.durationSeconds,
      creativeType: row.creativeType,
      repsPerHour: eventRepsPerHour(row.durationSeconds ?? 0),
    });
  }
  return spots;
};

/**
 * Every venue holding an ACCEPTE allocation whose bloc EDGE (start or end) falls in
 * (since, until] — the bloc pusher's scan. A start edge makes the spot appear, an end edge makes
 * it disappear; both need the same UPDATE_PLAYLIST re-push.
 */
export const venuesAtBlocEdge = async (since: Date, until: Date): Promise<string[]> => {
  const rows = await db
    .select({ screenhostId: eventAllocations.screenhostId, blocs: eventAllocations.blocs })
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
  for (const row of rows) {
    for (const bloc of parseBlocs(row.blocs)) {
      for (const edge of [new Date(bloc.start).getTime(), new Date(bloc.end).getTime()]) {
        if (edge > sinceMs && edge <= untilMs) edged.add(row.screenhostId);
      }
    }
  }
  return [...edged];
};
