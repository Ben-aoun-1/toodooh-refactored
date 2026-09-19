// SPS observations — what the SPS RESTS ON: its windows, the loaders that read its four sources,
// and the evidence counts (SpsObservations) per venue. The SCORE itself lives in sps-score.ts.
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  eventAllocations,
  eventAttestations,
} from '../db/schema.js';

import { plusCalendarDays } from './campaign-dates.js';
import { isElapsed, tunisNowSlot } from './dispatch/redispatch.js';
import { PLAYOUT_TZ } from './reconcile/delivered-slots.js';

export const ACCEPTATION_WINDOW_DAYS = 90;
export const ACTIVITE_WINDOW_DAYS = 30;

/** The attestation window — the acceptation variable's 90 d, mirrored. */
export const RESPECT_WINDOW_DAYS = 90;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The Tunis calendar date (YYYY-MM-DD) of `instant`. */
export const tunisDateOf = (instant: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PLAYOUT_TZ }).format(instant);

/** The Monday (YYYY-MM-DD, Tunis) of the week containing `now`. */
export const tunisWeekStart = (now: Date): string => {
  // Tunis is UTC+1 (no DST since 2008): shift, then walk back to Monday in UTC space.
  const shifted = new Date(now.getTime() + 60 * 60 * 1000);
  const dow = shifted.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // days since Monday
  const monday = new Date(shifted.getTime() - back * DAY_MS);
  return monday.toISOString().slice(0, 10);
};

/**
 * MEJ-14b / SPS-D1 — what each variable actually RESTS ON, so a caller can tell a measured score
 * from a score made of defaults. Counts only; nothing here feeds the score itself.
 */
export interface SpsObservations {
  /** Decided allocations (campaign + event) in the acceptation window. */
  decided: number;
  /** Event attestations in the respect window. */
  attested: number;
  /** Elapsed scheduled créneaux in the activité window. */
  scheduledElapsed: number;
  /** Engaged broadcast seconds in the current Tunis week. */
  engagedSeconds: number;
}

/**
 * A created_at window: [since, until). `until` is absent for the score's TRAILING windows (as
 * before); ADM-OBS2's période sets it — the same predicate, closed on the right.
 */
interface CreatedWindow {
  since: Date;
  until?: Date;
}

/**
 * The venue's DECIDED allocations created in `w`. EV4 — EVENT decisions count too (a decision is
 * a decision, whichever engine proposed it): the union keeps ONE rule, anchored on created_at both
 * sides (the E4 ruling — decided_at exists on the event rows and waits for the EV5-era re-anchor).
 */
export const loadDecided = async (screenhostId: string, w: CreatedWindow) => {
  const decided = await db
    .select({ statut: campaignDispatchAllocation.statutAcceptation })
    .from(campaignDispatchAllocation)
    .where(
      and(
        eq(campaignDispatchAllocation.screenhostId, screenhostId),
        ne(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
        gte(campaignDispatchAllocation.createdAt, w.since),
        w.until === undefined ? undefined : lt(campaignDispatchAllocation.createdAt, w.until),
      ),
    );
  const decidedEvent = await db
    .select({ statut: eventAllocations.statut })
    .from(eventAllocations)
    .where(
      and(
        eq(eventAllocations.screenhostId, screenhostId),
        ne(eventAllocations.statut, 'EN_ATTENTE'),
        gte(eventAllocations.createdAt, w.since),
        w.until === undefined ? undefined : lt(eventAllocations.createdAt, w.until),
      ),
    );
  return [...decided, ...decidedEvent.map((d) => ({ statut: d.statut }))];
};

/** The venue's ACCEPTE allocations + their plans (activité + remplissage). */
export const loadAcceptedAllocations = (screenhostId: string) =>
  db
    .select({
      creneaux: campaignDispatchAllocation.creneaux,
      campaignId: campaignDispatchPlan.campaignId,
      sSpotSeconds: campaignDispatchPlan.sSpotSeconds,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .where(
      and(
        eq(campaignDispatchAllocation.screenhostId, screenhostId),
        eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
      ),
    );

/** The venue's event attestations created in `w` (EV5), anchored on created_at. */
export const loadAttested = (screenhostId: string, w: CreatedWindow) =>
  db
    .select({ respecte: eventAttestations.respecte })
    .from(eventAttestations)
    .where(
      and(
        eq(eventAttestations.screenhostId, screenhostId),
        gte(eventAttestations.createdAt, w.since),
        w.until === undefined ? undefined : lt(eventAttestations.createdAt, w.until),
      ),
    );

/** 00:00 of a Tunis calendar day, as an instant (UTC+1, no DST since 2008 — tunisWeekStart). */
const tunisDayStart = (isoDay: string): Date => new Date(`${isoDay}T00:00:00+01:00`);

/**
 * ADM-OBS2 (Mejri 19/09, ruling R10) — the four `observations` over a CALENDAR période [from, to]
 * (Tunis days, both inclusive) instead of the score's trailing windows: the admin « Tests » page
 * shows the evidence of the période it is filtered on. The SCORE never reads this — computeSps and
 * its fixed windows stay what dispatch uses (R9).
 *
 * Same sources and predicates as computeSps, only the window moves: decisions and attestations by
 * the Tunis day of their created_at; elapsed créneaux (isElapsed at `now`) and reserved air time
 * (reps × the plan's S) of the ACCEPTE allocations by the créneau's date.
 */
export const spsObservationsInRange = async (
  screenhostId: string,
  from: string,
  to: string,
  now = new Date(),
): Promise<SpsObservations> => {
  const window: CreatedWindow = {
    since: tunisDayStart(from),
    until: tunisDayStart(plusCalendarDays(to, 1)),
  };
  const [decided, attested, allocations] = await Promise.all([
    loadDecided(screenhostId, window),
    loadAttested(screenhostId, window),
    loadAcceptedAllocations(screenhostId),
  ]);
  const nowSlot = tunisNowSlot(now);
  let scheduledElapsed = 0;
  let engagedSeconds = 0;
  for (const a of allocations) {
    for (const c of a.creneaux) {
      if (c.date < from || c.date > to) continue;
      if (isElapsed(c, nowSlot)) scheduledElapsed += 1;
      engagedSeconds += c.reps * a.sSpotSeconds;
    }
  }
  return { decided: decided.length, attested: attested.length, scheduledElapsed, engagedSeconds };
};

/**
 * SPS-DISPATCH1 — `observations` for MANY venues in a fixed number of queries.
 *
 * Dispatch needs to know which candidates have a computable score, and calling `computeSps` per
 * candidate would be six queries per venue on the hot path. This reads the same four sources over
 * the whole set instead.
 *
 * IT MUST AGREE WITH `computeSps` EXACTLY — a venue that reads « À venir » to its owner and ranks
 * on its defaults-90 in dispatch (or the reverse) is the divergence this whole lane exists to
 * remove. `e4-sps.test.ts` pins the agreement venue by venue against `computeSps` itself, across
 * every observation kind, so a change to one window that misses the other fails loudly.
 */
export const spsObservationsFor = async (
  screenhostIds: readonly string[],
  now = new Date(),
): Promise<Map<string, SpsObservations>> => {
  const result = new Map<string, SpsObservations>();
  if (screenhostIds.length === 0) return result;
  const ids = [...screenhostIds];
  for (const id of ids) {
    result.set(id, { decided: 0, attested: 0, scheduledElapsed: 0, engagedSeconds: 0 });
  }
  const decidedSince = new Date(now.getTime() - ACCEPTATION_WINDOW_DAYS * DAY_MS);
  const attestedSince = new Date(now.getTime() - RESPECT_WINDOW_DAYS * DAY_MS);

  const [campaignDecisions, eventDecisions, attestations, allocations] = await Promise.all([
    db
      .select({ screenhostId: campaignDispatchAllocation.screenhostId })
      .from(campaignDispatchAllocation)
      .where(
        and(
          inArray(campaignDispatchAllocation.screenhostId, ids),
          ne(campaignDispatchAllocation.statutAcceptation, 'EN_ATTENTE'),
          gte(campaignDispatchAllocation.createdAt, decidedSince),
        ),
      ),
    db
      .select({ screenhostId: eventAllocations.screenhostId })
      .from(eventAllocations)
      .where(
        and(
          inArray(eventAllocations.screenhostId, ids),
          ne(eventAllocations.statut, 'EN_ATTENTE'),
          gte(eventAllocations.createdAt, decidedSince),
        ),
      ),
    db
      .select({ screenhostId: eventAttestations.screenhostId })
      .from(eventAttestations)
      .where(
        and(
          inArray(eventAttestations.screenhostId, ids),
          gte(eventAttestations.createdAt, attestedSince),
        ),
      ),
    db
      .select({
        screenhostId: campaignDispatchAllocation.screenhostId,
        creneaux: campaignDispatchAllocation.creneaux,
        sSpotSeconds: campaignDispatchPlan.sSpotSeconds,
      })
      .from(campaignDispatchAllocation)
      .innerJoin(
        campaignDispatchPlan,
        eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
      )
      .where(
        and(
          inArray(campaignDispatchAllocation.screenhostId, ids),
          eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
        ),
      ),
  ]);

  for (const row of [...campaignDecisions, ...eventDecisions]) {
    const o = result.get(row.screenhostId);
    if (o) o.decided += 1;
  }
  for (const row of attestations) {
    const o = result.get(row.screenhostId);
    if (o) o.attested += 1;
  }

  // activité + remplissage share the ACCEPTE allocations, exactly as computeSps does.
  const nowSlot = tunisNowSlot(now);
  const activiteSinceDate = tunisDateOf(new Date(now.getTime() - ACTIVITE_WINDOW_DAYS * DAY_MS));
  const weekStart = tunisWeekStart(now);
  const weekEnd = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  for (const a of allocations) {
    const o = result.get(a.screenhostId);
    if (!o) continue;
    for (const c of a.creneaux) {
      if (c.date >= activiteSinceDate && isElapsed(c, nowSlot)) o.scheduledElapsed += 1;
      if (c.date >= weekStart && c.date < weekEnd) o.engagedSeconds += c.reps * a.sSpotSeconds;
    }
  }
  return result;
};
