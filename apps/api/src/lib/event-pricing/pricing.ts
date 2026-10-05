import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  businessSectors,
  campaigns,
  eventAllocations,
  hourReservations,
  screenhostAffluence,
  screenhostAffluenceHourly,
  screenhostAmax,
  screenhostUnavailability,
  screenhosts,
} from '../../db/schema.js';
import { env } from '../../env.js';
import { ownerApprovedSql } from '../approved-owner.js';
import { type BlocDiffusion, fenetreDiffusion } from '../fenetre-diffusion.js';
import { collapseHalvesSql, inEffectSql } from '../half-hour-slots.js';
import { venueHasInstalledScreenSql } from '../installed-screen.js';
import { isOpenAt, isOpenSlot } from '../opening-hours.js';

import { eventSwitchOnSql } from './event-switch.js';
import {
  EVENT_MINUTE_REPS,
  EVENT_SEATS_PER_BLOC,
  type EventMinute,
  orderedEventMinutes,
} from './minutes.js';

// EV2 — the EVENT pricing engine (D51: its OWN module). The campaign engine is untouched and
// UNIMPORTED — no lib/dispatch, no campaign-* libs (boundary-pinned like E7's rail). The event
// economics deliberately have NO attention coefficient: facturable = brut.
//
//   A_max            = the highest hourly affluence EVER known for the venue (ratchet store
//                      screenhost_amax: up on read, never down; 50 pers/h fallback, unpersisted);
//   impressions_bloc = A_max × 20   (300 s of antenne per 20-min bloc ÷ S_ref 15 s — the spot's
//                      real length NEVER changes billing);
//   I_max            = Σ eligible venues (available_blocs × A_max × 20);
//   C_max_evt        = ⌊CPM_evt × I_max ÷ 1000⌋  (CPM_evt admin-editable, 15 by default).
//
// EVT-MIN1 (2026-10-05) — the SELLING unit is now the MINUTE (./minutes.ts): a bloc's 5-minute pod
// holds five one-minute seats, priced CPM_evt × A_max × 4 ÷ 1000 each; computeEventCmax returns the
// ordered minute list and prices the ceiling from it. The A_max ratchet, the eligibility and the
// availability rules below are unchanged. ANTENNE_SECONDS_PER_BLOC / REPS_PER_BLOC survive for the
// positionings dispatched before the minutes model (ruling A1 — they keep their EV4 rules).
//
// Eligibility (D1), PER BLOC on the bloc's OWN Tunis date (late kickoffs cross midnight):
// the venue is open for the FULL 20 minutes, the date is not owner-declared unavailable (E2),
// and no OTHER event holds a reservation on any hour the bloc touches. A venue with ≥ 1
// available bloc, an event-eligible sector, is_active and an APPROVED owner participates (ELIG-2,
// operator ruling 2026-09-16 — the shared predicate lives in lib/approved-owner.ts, outside
// dispatch/ so this boundary stays clean) — and only with an INSTALLED screen (MAP-TV1, operator
// ruling 2026-09-21: a screens row ever paired or ever seen, lib/installed-screen.ts) and its
// EVENT SWITCH on (CAP-EVT1, operator ruling 2026-09-22: « Capacité de diffusion » set,
// ./event-switch.ts). All of it lives in ONE function, eventEligibleVenues below.

export const AMAX_FALLBACK_PPH = 50;
export const ANTENNE_SECONDS_PER_BLOC = 300;
export const S_REF_SECONDS = 15;
export const REPS_PER_BLOC = ANTENNE_SECONDS_PER_BLOC / S_REF_SECONDS; // 20

// Tunis calendar mapping (UTC+1, no DST since 2008) — local formatters, deliberately not
// imported from campaign-date code (the module boundary stays clean).
const TUNIS_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' });
const TUNIS_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Tunis',
  hour: '2-digit',
  hourCycle: 'h23',
});

interface TunisCell {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
}

const cellOf = (instant: Date): TunisCell => ({
  date: TUNIS_DATE.format(instant),
  hour: Number(TUNIS_HOUR.format(instant)) % 24,
});

/** The distinct Tunis (date, hour) cells a [start, end) bloc touches (a 20-min bloc: 1 or 2). */
export const blocCells = (start: Date, end: Date): TunisCell[] => {
  const first = cellOf(start);
  const last = cellOf(new Date(end.getTime() - 1));
  if (first.date === last.date && first.hour === last.hour) return [first];
  return [first, last];
};

/** The typical-week candidate (flag OFF — today's A_max, unchanged): the grid's busiest hour. */
const gridAmaxPph = async (screenhostId: string): Promise<number> => {
  // ⚠️ THIS COLLAPSE IS PERMANENT — do NOT "finish the half-hour migration" by deleting it.
  //
  // You are looking at a GROUP BY on `hour` over a table keyed by `slot`, and it looks like a
  // leftover from slice B. It is not. A_max is the busiest HOUR by definition, and the ratchet
  // never writes downward — `max(halves)` would inflate it PERMANENTLY on one busy half-hour.
  // The half-hour grid is the storage; an hour is what THIS consumer means. `round(avg(halves))`
  // is its correct input, and it returns the old value exactly whenever the halves agree.
  // (Slice C removed the collapse from the READ paths that went slot-shaped — period-audience and
  // the /affluence wire. This one, event-pricing's A_max and monthly-audience stay by design.)
  const grid = await db
    .select({ v: collapseHalvesSql(screenhostAffluence.estimatedImpressions) })
    .from(screenhostAffluence)
    // OFF-1 — a suspended manual cell is ABSENT for A_max. Filtered before the collapse: the
    // ratchet never writes downward, so a suspended half leaking into the mean would be permanent.
    .where(
      and(
        eq(screenhostAffluence.screenhostId, screenhostId),
        inEffectSql(screenhostAffluence.inEffect),
      ),
    )
    .groupBy(screenhostAffluence.dayOfWeek, screenhostAffluence.hour);
  return grid.reduce((m, r) => Math.max(m, r.v), 0);
};

/**
 * LEARN-1 F1 (spec §9, operator-approved) — the venue's busiest HOUR ever MEASURED inside its
 * opening hours: « le plus haut niveau de fréquentation (personnes/heure) jamais mesuré pour ce
 * lieu, tous événements confondus ». An hour is the mean of the measured half-hours it has, rounded
 * — `collapseHalvesSql`, the SAME rule as the grid path (a lone half IS the hour; the permanent-
 * collapse note on gridAmaxPph applies here too). Only `value` counts: an estimate, a typed cell or
 * the typical week never does. All history; the venue's CURRENT hours apply to all of it
 * (`isOpenSlot` — no hours = open all day). 0 = nothing measured (the caller falls back to 50).
 */
export const measuredAmaxPph = async (screenhostId: string): Promise<number> => {
  const [venue] = await db
    .select({ openingHour: screenhosts.openingHour, closingHour: screenhosts.closingHour })
    .from(screenhosts)
    .where(eq(screenhosts.id, screenhostId))
    .limit(1);
  if (!venue) return 0;
  const openHours = Array.from({ length: 24 }, (_, hour) => hour).filter((hour) =>
    isOpenSlot(hour * 2, venue.openingHour, venue.closingHour),
  );
  if (openHours.length === 0) return 0; // a zero-width window (refused by every writer)
  const hourValue = collapseHalvesSql(screenhostAffluenceHourly.value);
  const [peak] = await db
    .select({ v: hourValue })
    .from(screenhostAffluenceHourly)
    .where(
      and(
        eq(screenhostAffluenceHourly.screenhostId, screenhostId),
        isNotNull(screenhostAffluenceHourly.value),
        inArray(screenhostAffluenceHourly.hour, openHours),
      ),
    )
    .groupBy(screenhostAffluenceHourly.date, screenhostAffluenceHourly.hour)
    .orderBy(desc(hourValue))
    .limit(1);
  return peak?.v ?? 0;
};

export interface AmaxOptions {
  /** LEARN-1 F1 — defaults to env.LEARNED_AFFLUENCE_ENABLED, THE switch; tests pin either side. */
  learnedAffluence?: boolean;
}

/**
 * The A_max ratchet, per venue: MAX(candidate, stored) — growth persists, shrinkage never writes.
 * The candidate is the typical-week grid's busiest hour (flag OFF, unchanged) or, under
 * LEARNED_AFFLUENCE_ENABLED (F1), the busiest hour ever MEASURED inside opening hours.
 * Returns the effective A_max, or the 50 fallback (UNPERSISTED) when nothing is known.
 */
export const computeAmax = async (
  screenhostId: string,
  opts: AmaxOptions = {},
): Promise<number> => {
  const learned = opts.learnedAffluence ?? env.LEARNED_AFFLUENCE_ENABLED;
  const candidate = learned ? await measuredAmaxPph(screenhostId) : await gridAmaxPph(screenhostId);
  const [stored] = await db
    .select({ amaxPph: screenhostAmax.amaxPph })
    .from(screenhostAmax)
    .where(eq(screenhostAmax.screenhostId, screenhostId))
    .limit(1);
  const storedMax = stored?.amaxPph ?? 0;
  if (candidate > storedMax) {
    await db
      .insert(screenhostAmax)
      .values({ screenhostId, amaxPph: candidate })
      .onConflictDoUpdate({
        target: screenhostAmax.screenhostId,
        set: { amaxPph: candidate, updatedAt: new Date() },
      });
  }
  const effective = Math.max(candidate, storedMax);
  return effective > 0 ? effective : AMAX_FALLBACK_PPH;
};

export interface EventRef {
  id: string;
  kickoffAt: Date;
  endsAt: Date;
}

interface VenueHours {
  id: string;
  openingHour: number | null;
  closingHour: number | null;
}

interface AvailabilityContext {
  /** E2 — the venue's owner-declared unavailable dates (YYYY-MM-DD). */
  unavailableDates: ReadonlySet<string>;
  /** EV1 — (date:hour) cells held by OTHER events. */
  foreignReservedCells: ReadonlySet<string>;
}

/**
 * D1, per bloc: available iff EVERY Tunis (date, hour) cell the bloc touches is inside the
 * venue's opening hours ([opening, closing) — a bloc half-outside is OUT), on a date the owner
 * has not declared unavailable, and on an hour no OTHER event has reserved.
 * EV4 — the IDENTITY variant: the dispatch engine needs WHICH blocs, not how many. The counter
 * below derives from this list, so EV2's availability pins hold both byte-for-byte.
 */
export const availableBlocs = (
  event: EventRef,
  venue: VenueHours,
  ctx: AvailabilityContext,
): BlocDiffusion[] => {
  if (venue.openingHour === null || venue.closingHour === null) return [];
  const { openingHour, closingHour } = venue;
  const { blocs } = fenetreDiffusion(event.kickoffAt, event.endsAt);
  // HOURS-X1 — the window may wrap past midnight; isOpenAt handles both shapes.
  return blocs.filter((bloc) =>
    blocCells(bloc.start, bloc.end).every(
      (c) =>
        isOpenAt(c.hour, openingHour, closingHour) &&
        !ctx.unavailableDates.has(c.date) &&
        !ctx.foreignReservedCells.has(`${c.date}:${c.hour}`),
    ),
  );
};

export const blocAvailability = (
  event: EventRef,
  venue: VenueHours,
  ctx: AvailabilityContext,
): number => availableBlocs(event, venue, ctx).length;

export interface EventVenuePricing {
  screenhostId: string;
  name: string;
  amaxPph: number;
  /** EVT-MIN1 — the venue's blocs with a free pod seat = the minutes it can still sell. */
  blocsDisponibles: number;
  /** blocsDisponibles × A_max × 4 (one minute = four S_ref reps). */
  impressions: number;
}

export interface EventCmaxResult {
  /** EVT-MIN1 — the price of EVERY buyable minute (Σ minute prices, to the centime). */
  cMaxEvtTnd: number;
  iMax: number;
  eligibleCount: number;
  cpmEvtTnd: number;
  venues: EventVenuePricing[];
  /** SUGG-1 — the DISTINCT business sectors of the event pool, sorted (the card's tags). */
  sectors: string[];
  /** EVT-MIN1 — the slider's max: one minute per (venue, bloc) with a free seat. */
  maxMinutes: number;
  /** EVT-MIN1 — the ORDERED minute list (SPS desc venues, chronological blocs). */
  minutes: EventMinute[];
}

export interface EventEligibleVenue {
  id: string;
  ownerId: string;
  name: string;
  sps: number;
  /** Ancienneté tiebreak anchor (venue created_at, ms). */
  createdAtMs: number;
  /** The venue's AVAILABLE blocs for this match (D1) — never empty. */
  blocs: BlocDiffusion[];
  /** SUGG-1 — the venue's business sector name (stored name; display labels live in the web). */
  sectorName: string;
}

/**
 * EVT-MIN1 — the seats already held in this event's blocs, per venue and bloc start (ISO). A live
 * allocation (EN_ATTENTE holds, ACCEPTE airs; a REFUSE released) of a booked positioning (upcoming
 * or active — the EVT-STOP « sold » set) holds ONE seat per placed bloc under the minutes model,
 * and ALL FIVE when it predates it (event_minutes NULL — EV4 placed it on the whole antenne).
 */
export const eventSeatsHeld = async (
  eventId: string,
  screenhostIds: readonly string[],
): Promise<Map<string, Map<string, number>>> => {
  const held = new Map<string, Map<string, number>>();
  if (screenhostIds.length === 0) return held;
  const rows = await db
    .select({
      screenhostId: eventAllocations.screenhostId,
      blocs: eventAllocations.blocs,
      eventMinutes: campaigns.eventMinutes,
    })
    .from(eventAllocations)
    .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.eventId, eventId),
        inArray(campaigns.status, ['upcoming', 'active']),
        inArray(eventAllocations.statut, ['EN_ATTENTE', 'ACCEPTE']),
        inArray(eventAllocations.screenhostId, [...screenhostIds]),
      ),
    );
  for (const row of rows) {
    const seats = row.eventMinutes === null ? EVENT_SEATS_PER_BLOC : 1;
    const byBloc = held.get(row.screenhostId) ?? new Map<string, number>();
    for (const bloc of Array.isArray(row.blocs) ? (row.blocs as unknown[]) : []) {
      if (typeof bloc !== 'object' || bloc === null) continue;
      const start = (bloc as Record<string, unknown>)['start'];
      if (typeof start !== 'string') continue;
      const key = new Date(start).toISOString();
      byBloc.set(key, (byBloc.get(key) ?? 0) + seats);
    }
    held.set(row.screenhostId, byBloc);
  }
  return held;
};

/**
 * THE EVENT POOL — ONE home for which venues can take this match (CAP-EVT1 made it one function;
 * the ceiling and the bloc pool used to hold a copy each). A venue is in iff it is active, its
 * owner is APPROVED (ELIG-2), it has an INSTALLED screen (MAP-TV1), its EVENT SWITCH is on
 * (CAP-EVT1 — a « Capacité de diffusion » is set) and its sector is event-eligible, and it has
 * ≥ 1 available bloc of the match (D1: opening hours ∩ E2 declarations ∩ OTHER events'
 * reservations, full-bloc-only) — EVT-MIN1: a bloc whose five pod seats are all held by this
 * event's booked positionings is no longer available (eventSeatsHeld). NOT read: audience (A_max falls back to 50/h), zones (the event
 * booster's axis only), category × class, coordinates.
 *
 * Read-only: A_max is NOT computed here (its ratchet writes), so a preview can call this safely.
 * Consumers: computeEventCmax (and through it the event booster's ceiling and « Hosts éligibles »),
 * assembleEventPool (event dispatch, the event refusal cascade, the event booster's perimeter) and
 * the event page's coverage map (GET /api/campaigns/:id/coverage on a positioning draft).
 * `excludeScreenhostIds` keeps refused/already-allocated venues out of a cascade re-fill.
 */
export const eventEligibleVenues = async (
  event: EventRef,
  excludeScreenhostIds: ReadonlySet<string> = new Set(),
): Promise<EventEligibleVenue[]> => {
  const candidates = await db
    .select({
      id: screenhosts.id,
      ownerId: screenhosts.ownerId,
      name: screenhosts.name,
      sps: screenhosts.sps,
      createdAt: screenhosts.createdAt,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      sectorName: businessSectors.name,
    })
    .from(screenhosts)
    .innerJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .where(
      and(
        eq(screenhosts.isActive, true),
        ownerApprovedSql(),
        venueHasInstalledScreenSql(),
        eventSwitchOnSql(),
        eq(businessSectors.eventEligible, true),
      ),
    );
  // An ownerless venue can never decide a proposal (§11.1). The approved-owner clause above
  // already implies an owner; the check stays as the type narrowing for ownerId.
  const eligible = candidates.flatMap((c) =>
    c.ownerId !== null && !excludeScreenhostIds.has(c.id) ? [{ ...c, ownerId: c.ownerId }] : [],
  );
  const ids = eligible.map((c) => c.id);
  if (ids.length === 0) return [];

  // The window's Tunis dates bound both context reads (a two-day span at most in practice —
  // derived from the blocs themselves so a midnight-crossing window reads both dates).
  const { blocs } = fenetreDiffusion(event.kickoffAt, event.endsAt);
  const windowDates = new Set<string>();
  for (const b of blocs) for (const c of blocCells(b.start, b.end)) windowDates.add(c.date);
  const dateList = [...windowDates];

  const unavailabilityRows = await db
    .select({
      screenhostId: screenhostUnavailability.screenhostId,
      day: screenhostUnavailability.day,
    })
    .from(screenhostUnavailability)
    .where(
      and(
        inArray(screenhostUnavailability.screenhostId, ids),
        inArray(screenhostUnavailability.day, dateList),
      ),
    );
  const reservationRows = await db
    .select({
      screenhostId: hourReservations.screenhostId,
      day: hourReservations.day,
      hour: hourReservations.hour,
      eventId: hourReservations.eventId,
    })
    .from(hourReservations)
    .where(
      and(inArray(hourReservations.screenhostId, ids), inArray(hourReservations.day, dateList)),
    );

  const unavailableBySh = new Map<string, Set<string>>();
  for (const u of unavailabilityRows) {
    const set = unavailableBySh.get(u.screenhostId) ?? new Set<string>();
    set.add(u.day);
    unavailableBySh.set(u.screenhostId, set);
  }
  const foreignReservedBySh = new Map<string, Set<string>>();
  for (const r of reservationRows) {
    if (r.eventId === event.id) continue; // our own hold never blocks our own pricing/placement
    const set = foreignReservedBySh.get(r.screenhostId) ?? new Set<string>();
    set.add(`${r.day}:${r.hour}`);
    foreignReservedBySh.set(r.screenhostId, set);
  }

  const seatsHeld = await eventSeatsHeld(event.id, ids);

  const EMPTY: ReadonlySet<string> = new Set();
  const NO_SEATS: ReadonlyMap<string, number> = new Map();
  const venues: EventEligibleVenue[] = [];
  for (const venue of eligible) {
    const held = seatsHeld.get(venue.id) ?? NO_SEATS;
    const available = availableBlocs(event, venue, {
      unavailableDates: unavailableBySh.get(venue.id) ?? EMPTY,
      foreignReservedCells: foreignReservedBySh.get(venue.id) ?? EMPTY,
    }).filter((bloc) => (held.get(bloc.start.toISOString()) ?? 0) < EVENT_SEATS_PER_BLOC);
    if (available.length === 0) continue;
    venues.push({
      id: venue.id,
      ownerId: venue.ownerId,
      name: venue.name,
      sps: Number(venue.sps),
      createdAtMs: venue.createdAt.getTime(),
      blocs: available,
      sectorName: venue.sectorName,
    });
  }
  return venues;
};

/** EV4's D2 order — SPS desc, then ancienneté asc, then id asc (deterministic). */
export const compareEventVenues = (
  a: { sps: number; createdAtMs: number; id: string },
  b: { sps: number; createdAtMs: number; id: string },
): number => {
  if (b.sps !== a.sps) return b.sps - a.sps;
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The event ceiling, EVT-MIN1: the ORDERED minute list over the event pool (eventEligibleVenues,
 * D2 order) — one minute per (venue, bloc) with a free seat, priced CPM_evt × A_max × 4 ÷ 1000.
 * Its length is the slider's max, its total the ceiling. CPM_evt arrives resolved from the caller
 * (the config read stays out of this module — D51). `excludeScreenhostIds` narrows the pool (the
 * booster's « already held » venues).
 */
export const computeEventCmax = async (
  event: EventRef,
  cpmEvtTnd: number,
  excludeScreenhostIds: ReadonlySet<string> = new Set(),
): Promise<EventCmaxResult> => {
  const pool = await eventEligibleVenues(event, excludeScreenhostIds);
  const priced: (EventEligibleVenue & { amaxPph: number })[] = [];
  for (const venue of pool) priced.push({ ...venue, amaxPph: await computeAmax(venue.id) });
  priced.sort(compareEventVenues);
  const minutes = orderedEventMinutes(
    priced.map((v) => ({
      screenhostId: v.id,
      ownerId: v.ownerId,
      amaxPph: v.amaxPph,
      blocs: v.blocs.map((b) => ({ start: b.start, end: b.end })),
    })),
    cpmEvtTnd,
  );
  const venues: EventVenuePricing[] = priced.map((v) => ({
    screenhostId: v.id,
    name: v.name,
    amaxPph: v.amaxPph,
    blocsDisponibles: v.blocs.length,
    impressions: v.blocs.length * v.amaxPph * EVENT_MINUTE_REPS,
  }));
  return {
    cMaxEvtTnd: Math.round(minutes.reduce((sum, m) => sum + m.priceTnd, 0) * 100) / 100,
    iMax: minutes.reduce((sum, m) => sum + m.impressions, 0),
    eligibleCount: venues.length,
    cpmEvtTnd,
    venues,
    sectors: [...new Set(pool.map((v) => v.sectorName))].sort((x, y) => x.localeCompare(y, 'fr')),
    maxMinutes: minutes.length,
    minutes,
  };
};
