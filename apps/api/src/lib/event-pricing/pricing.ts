import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  businessSectors,
  hourReservations,
  screenhostAffluence,
  screenhostAmax,
  screenhostUnavailability,
  screenhosts,
} from '../../db/schema.js';
import { type BlocDiffusion, fenetreDiffusion } from '../fenetre-diffusion.js';

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
// Eligibility (D1), PER BLOC on the bloc's OWN Tunis date (late kickoffs cross midnight):
// the venue is open for the FULL 20 minutes, the date is not owner-declared unavailable (E2),
// and no OTHER event holds a reservation on any hour the bloc touches. A venue with ≥ 1
// available bloc, an event-eligible sector and is_active participates.

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

/**
 * The A_max ratchet, per venue: MAX(grid, stored) — growth persists, shrinkage never writes.
 * Returns the effective A_max, or the 50 fallback (UNPERSISTED) when nothing is known.
 */
export const computeAmax = async (screenhostId: string): Promise<number> => {
  const grid = await db
    .select({ v: screenhostAffluence.estimatedImpressions })
    .from(screenhostAffluence)
    .where(eq(screenhostAffluence.screenhostId, screenhostId));
  const gridMax = grid.reduce((m, r) => Math.max(m, r.v), 0);
  const [stored] = await db
    .select({ amaxPph: screenhostAmax.amaxPph })
    .from(screenhostAmax)
    .where(eq(screenhostAmax.screenhostId, screenhostId))
    .limit(1);
  const storedMax = stored?.amaxPph ?? 0;
  if (gridMax > storedMax) {
    await db
      .insert(screenhostAmax)
      .values({ screenhostId, amaxPph: gridMax })
      .onConflictDoUpdate({
        target: screenhostAmax.screenhostId,
        set: { amaxPph: gridMax, updatedAt: new Date() },
      });
  }
  const effective = Math.max(gridMax, storedMax);
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
  return blocs.filter((bloc) =>
    blocCells(bloc.start, bloc.end).every(
      (c) =>
        c.hour >= openingHour &&
        c.hour < closingHour &&
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
  blocsDisponibles: number;
  impressions: number;
}

export interface EventCmaxResult {
  cMaxEvtTnd: number;
  iMax: number;
  eligibleCount: number;
  cpmEvtTnd: number;
  venues: EventVenuePricing[];
}

/**
 * The event ceiling: every active venue of an event-eligible sector with ≥ 1 available bloc
 * contributes blocs × A_max × 20. CPM_evt arrives resolved from the caller (the config read
 * stays out of this module — D51).
 */
export const computeEventCmax = async (
  event: EventRef,
  cpmEvtTnd: number,
): Promise<EventCmaxResult> => {
  const candidates = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      eventEligible: businessSectors.eventEligible,
    })
    .from(screenhosts)
    .innerJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .where(eq(screenhosts.isActive, true));
  const eligibleSector = candidates.filter((c) => c.eventEligible);
  const ids = eligibleSector.map((c) => c.id);

  // The window's Tunis dates bound both context reads (a two-day span at most in practice —
  // derived from the blocs themselves so a midnight-crossing window reads both dates).
  const { blocs } = fenetreDiffusion(event.kickoffAt, event.endsAt);
  const windowDates = new Set<string>();
  for (const b of blocs) for (const c of blocCells(b.start, b.end)) windowDates.add(c.date);
  const dateList = [...windowDates];

  const unavailabilityRows = ids.length
    ? await db
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
        )
    : [];
  const reservationRows = ids.length
    ? await db
        .select({
          screenhostId: hourReservations.screenhostId,
          day: hourReservations.day,
          hour: hourReservations.hour,
          eventId: hourReservations.eventId,
        })
        .from(hourReservations)
        .where(
          and(inArray(hourReservations.screenhostId, ids), inArray(hourReservations.day, dateList)),
        )
    : [];

  const unavailableBySh = new Map<string, Set<string>>();
  for (const u of unavailabilityRows) {
    const set = unavailableBySh.get(u.screenhostId) ?? new Set<string>();
    set.add(u.day);
    unavailableBySh.set(u.screenhostId, set);
  }
  const foreignReservedBySh = new Map<string, Set<string>>();
  for (const r of reservationRows) {
    if (r.eventId === event.id) continue; // our own hold never blocks our own pricing
    const set = foreignReservedBySh.get(r.screenhostId) ?? new Set<string>();
    set.add(`${r.day}:${r.hour}`);
    foreignReservedBySh.set(r.screenhostId, set);
  }

  const venues: EventVenuePricing[] = [];
  const EMPTY: ReadonlySet<string> = new Set();
  for (const venue of eligibleSector) {
    const blocsDisponibles = blocAvailability(event, venue, {
      unavailableDates: unavailableBySh.get(venue.id) ?? EMPTY,
      foreignReservedCells: foreignReservedBySh.get(venue.id) ?? EMPTY,
    });
    if (blocsDisponibles === 0) continue;
    const amaxPph = await computeAmax(venue.id);
    venues.push({
      screenhostId: venue.id,
      name: venue.name,
      amaxPph,
      blocsDisponibles,
      impressions: blocsDisponibles * amaxPph * REPS_PER_BLOC,
    });
  }
  const iMax = venues.reduce((s, v) => s + v.impressions, 0);
  return {
    cMaxEvtTnd: Math.floor((cpmEvtTnd * iMax) / 1000),
    iMax,
    eligibleCount: venues.length,
    cpmEvtTnd,
    venues,
  };
};
