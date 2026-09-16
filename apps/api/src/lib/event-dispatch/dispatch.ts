import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  businessSectors,
  eventAllocations,
  hourReservations,
  notifications,
  screenhostUnavailability,
  screenhosts,
} from '../../db/schema.js';
import { ownerApprovedSql } from '../approved-owner.js';
import {
  REPS_PER_BLOC,
  type EventRef,
  availableBlocs,
  blocCells,
  computeAmax,
} from '../event-pricing/pricing.js';
import { fenetreDiffusion } from '../fenetre-diffusion.js';

// EV4 — THE EVENT DISPATCH ENGINE (its own module, the D51 boundary: nothing here imports
// lib/dispatch or any campaign lib — the campaign engine and this one only ever meet at the
// hour_reservations table, where the campaign side reads a generic subtraction it has always
// been blind to).
//
// The rules (engine doc D1–D7):
//   D1 — eligibility per EV2: active venue, APPROVED owner (ELIG-2), event-eligible sector,
//        per-bloc availability (opening hours ∩ E2 declarations ∩ OTHER events' reservations,
//        full-bloc-only).
//   D2 — processing order: SPS desc; ancienneté asc then id asc as deterministic tiebreaks
//        (the classic queue's tiebreak idiom WITHOUT its dignity partition — G_jour/activeToday
//        are campaign-engine concepts).
//   D3 — greedy concentration to I_cible_evt = ⌊budget × 1000 ÷ CPM_evt⌋, whole blocs only
//        (a bloc carries A_max × 20 impressions, frozen at placement).
//   D4 — anti-miette: a REMAINDER worth under 20 TND at CPM_evt is DROPPED — no storage, no
//        reliquat push-back (divergent from the campaign engine BY SPEC). A remainder worth
//        ≥ 20 TND books one more whole bloc (the grid airs whole blocs; slight over-delivery
//        is the advertiser's gain, never a debt).
//   D5/D7 — N_max = ⌊C_cible × 50 % ÷ 20⌋ venues; needing MORE venues than N_max to reach
//        I_cible BLOCKS the validation atomically (nothing persisted).
//   D6 — pool exhaustion below I_cible: PARTIAL placement accepted + an alert.

/** D4 — the anti-miette line: a remainder worth under this many TND is dropped. */
export const EVENT_MIETTE_TND = 20;

/** D5 — the concentration cap's per-venue divisor (TND). */
export const NMAX_DIVISOR_TND = 20;

/** N_max = ⌊C_cible × 50 % ÷ 20⌋ — the maximum venue count for one positioning. */
export const eventNmax = (budgetTnd: number): number =>
  Math.floor((budgetTnd * 0.5) / NMAX_DIVISOR_TND);

/** I_cible_evt = ⌊budget × 1000 ÷ CPM_evt⌋. */
export const eventICible = (budgetTnd: number, cpmEvtTnd: number): number =>
  cpmEvtTnd > 0 ? Math.floor((budgetTnd * 1000) / cpmEvtTnd) : 0;

export interface EventPoolVenue {
  screenhostId: string;
  ownerId: string;
  name: string;
  sps: number;
  /** Ancienneté tiebreak anchor (venue created_at, ms). */
  createdAtMs: number;
  amaxPph: number;
  /** The venue's AVAILABLE blocs (D1), each worth amaxPph × 20 impressions. */
  blocs: { start: Date; end: Date }[];
}

/** One placed bloc, frozen at placement. */
export interface PlacedBloc {
  start: string;
  end: string;
  impressions: number;
}

export interface EventPlacement {
  screenhostId: string;
  ownerId: string;
  blocs: PlacedBloc[];
  impressionsTotal: number;
  montantTnd: number;
}

export type EventFillResult =
  | {
      status: 'FILLED';
      placements: EventPlacement[];
      placedImpressions: number;
      /** D4 — the dropped miette (impressions), 0 when the fill landed exactly or overshot. */
      droppedImpressions: number;
      partial: false;
    }
  | {
      status: 'PARTIAL';
      placements: EventPlacement[];
      placedImpressions: number;
      droppedImpressions: number;
      partial: true;
    }
  | { status: 'NMAX_EXCEEDED'; nMax: number }
  | { status: 'NO_POOL' };

/**
 * D1/D2 — assemble the bloc pool: every active event-eligible venue of an approved owner with
 * ≥ 1 available bloc, SPS desc (ancienneté asc, id asc tiebreaks). `excludeScreenhostIds` keeps
 * refused/already-allocated venues out of a cascade re-fill.
 */
export const assembleEventPool = async (
  event: EventRef,
  excludeScreenhostIds: ReadonlySet<string> = new Set(),
): Promise<EventPoolVenue[]> => {
  const candidates = await db
    .select({
      id: screenhosts.id,
      ownerId: screenhosts.ownerId,
      name: screenhosts.name,
      sps: screenhosts.sps,
      createdAt: screenhosts.createdAt,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
      eventEligible: businessSectors.eventEligible,
    })
    .from(screenhosts)
    .innerJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    // ELIG-2 — only an APPROVED owner's venue is placeable (the shared predicate, the same one
    // computeEventCmax prices with, so the ceiling and the pool agree).
    .where(and(eq(screenhosts.isActive, true), ownerApprovedSql()));
  // An ownerless venue can never decide a proposal (§11.1) — out of the pool. (The approved-owner
  // clause above already implies an owner; the check stays as the type narrowing for ownerId.)
  const eligible = candidates.filter(
    (c) => c.eventEligible && c.ownerId !== null && !excludeScreenhostIds.has(c.id),
  );
  const ids = eligible.map((c) => c.id);
  if (ids.length === 0) return [];

  // The window's Tunis dates bound both context reads (the EV2 idiom — a midnight-crossing
  // window reads both dates through the blocs' own cells).
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
    if (r.eventId === event.id) continue; // our own holds never block our own placement
    const set = foreignReservedBySh.get(r.screenhostId) ?? new Set<string>();
    set.add(`${r.day}:${r.hour}`);
    foreignReservedBySh.set(r.screenhostId, set);
  }

  const EMPTY: ReadonlySet<string> = new Set();
  const pool: EventPoolVenue[] = [];
  for (const venue of eligible) {
    const blocsDisponibles = availableBlocs(event, venue, {
      unavailableDates: unavailableBySh.get(venue.id) ?? EMPTY,
      foreignReservedCells: foreignReservedBySh.get(venue.id) ?? EMPTY,
    });
    if (blocsDisponibles.length === 0) continue;
    const amaxPph = await computeAmax(venue.id);
    pool.push({
      screenhostId: venue.id,
      ownerId: venue.ownerId as string,
      name: venue.name,
      sps: Number(venue.sps),
      createdAtMs: venue.createdAt.getTime(),
      amaxPph,
      blocs: blocsDisponibles.map((b) => ({ start: b.start, end: b.end })),
    });
  }
  // D2 — SPS desc; ancienneté asc then id asc as the deterministic tiebreaks.
  pool.sort((a, b) => {
    if (b.sps !== a.sps) return b.sps - a.sps;
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return a.screenhostId < b.screenhostId ? -1 : a.screenhostId > b.screenhostId ? 1 : 0;
  });
  return pool;
};

/**
 * D3–D7 — the deterministic greedy fill over an ORDERED pool. Pure: no I/O, no clock.
 * Montants are exact millimes (3 decimals) at CPM_evt per placed impression.
 */
export const fillEventBlocs = (
  pool: readonly EventPoolVenue[],
  budgetTnd: number,
  cpmEvtTnd: number,
  opts: { nMax?: number } = {},
): EventFillResult => {
  const iCible = eventICible(budgetTnd, cpmEvtTnd);
  const nMax = opts.nMax ?? eventNmax(budgetTnd);
  if (pool.length === 0) return { status: 'NO_POOL' };
  // The FIRST chargeable remainder: ceil puts the 20-TND line exactly where D4 draws it —
  // a remainder worth 19.995 TND drops, one worth 20.010 TND books a bloc (both sides pinned).
  const mietteImpressions = Math.ceil((EVENT_MIETTE_TND * 1000) / cpmEvtTnd);

  // D2 — the fill OWNS its order (SPS desc, ancienneté asc, id asc): a caller-shuffled pool
  // can never change the outcome.
  const ordered = [...pool].sort((a, b) => {
    if (b.sps !== a.sps) return b.sps - a.sps;
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return a.screenhostId < b.screenhostId ? -1 : a.screenhostId > b.screenhostId ? 1 : 0;
  });

  const placements: EventPlacement[] = [];
  let remaining = iCible;
  let placed = 0;

  for (const venue of ordered) {
    if (remaining <= 0 || remaining < mietteImpressions) break;
    // D5/D7 — opening one more venue past N_max blocks the whole validation.
    if (placements.length >= nMax) {
      return { status: 'NMAX_EXCEEDED', nMax };
    }
    const blocImpressions = venue.amaxPph * REPS_PER_BLOC;
    const taken: PlacedBloc[] = [];
    let chargeable = 0;
    for (const bloc of venue.blocs) {
      if (remaining <= 0 || remaining < mietteImpressions) break;
      // D4 — a remainder still worth ≥ 20 TND books one more WHOLE bloc (over-delivery is the
      // advertiser's gain, never a charge); a sub-miette remainder never reaches here.
      taken.push({
        start: bloc.start.toISOString(),
        end: bloc.end.toISOString(),
        impressions: blocImpressions,
      });
      // The CHARGEABLE share of this bloc: the overshoot past I_cible is free delivery, so
      // Σ montants can never exceed the budget (money stays engaged-bounded).
      chargeable += Math.min(blocImpressions, remaining);
      remaining -= blocImpressions;
      placed += blocImpressions;
    }
    if (taken.length > 0) {
      placements.push({
        screenhostId: venue.screenhostId,
        ownerId: venue.ownerId,
        blocs: taken,
        impressionsTotal: taken.length * blocImpressions,
        // Millimes-exact on the chargeable impressions.
        montantTnd: Math.round(chargeable * cpmEvtTnd) / 1000,
      });
    }
  }

  const droppedImpressions = remaining > 0 ? remaining : 0;
  if (placements.length === 0) return { status: 'NO_POOL' };
  // D4 — a leftover worth < 20 TND is DROPPED (no storage): the fill counts as complete.
  if (droppedImpressions > 0 && droppedImpressions >= mietteImpressions) {
    // Pool exhausted with a still-chargeable need → D6 PARTIAL (accepted, alerted upstream).
    return {
      status: 'PARTIAL',
      placements,
      placedImpressions: placed,
      droppedImpressions,
      partial: true,
    };
  }
  return {
    status: 'FILLED',
    placements,
    placedImpressions: placed,
    droppedImpressions,
    partial: false,
  };
};

// §11.1 — the proposal + alert copies (French, ONE home).
export const EVENT_PROPOSAL_TITLE = 'Événement en attente de votre acceptation';
export const eventProposalBody = (matchName: string): string =>
  `Le positionnement « ${matchName} » attend votre acceptation.`;
export const EVENT_PARTIAL_TITLE = 'Placement partiel de votre positionnement';
export const eventPartialBody = (matchName: string): string =>
  `Votre positionnement « ${matchName} » n'a pas pu être placé en totalité — l'inventaire disponible sur la fenêtre est limité.`;

export interface EventDispatchOutcome {
  status: 'OK' | 'ALREADY_DISPATCHED' | 'NMAX_EXCEEDED' | 'NO_POOL';
  nMax?: number;
  partial?: boolean;
  allocationIds?: string[];
}

/**
 * The persisted dispatch: assemble → fill → ONE transaction writing event_allocations
 * (EN_ATTENTE) + their hour_reservations (every Tunis hour a placed bloc touches — EV2's
 * conservative hour grain, one row per (venue, day, hour, event)). D7 refuses BEFORE any
 * write; a re-run over an already-dispatched positioning short-circuits (the SK1 resume
 * idiom — no re-fill, no duplicate rows, no duplicate notifications).
 */
export const runEventDispatch = async (
  positioning: { id: string; name: string; advertiserId: string; requestedBudget: number },
  event: EventRef,
  cpmEvtTnd: number,
): Promise<EventDispatchOutcome> => {
  const existing = await db
    .select({ id: eventAllocations.id })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, positioning.id))
    .limit(1);
  if (existing.length > 0) return { status: 'ALREADY_DISPATCHED' };

  const pool = await assembleEventPool(event);
  const fill = fillEventBlocs(pool, positioning.requestedBudget, cpmEvtTnd);
  if (fill.status === 'NMAX_EXCEEDED') return { status: 'NMAX_EXCEEDED', nMax: fill.nMax };
  if (fill.status === 'NO_POOL') return { status: 'NO_POOL' };

  // ONE transaction: allocations + reservations + owner proposals + the D6 alert are
  // all-or-nothing (the classic freeze-tx idiom).
  const allocationIds = await db.transaction(async (tx) => {
    const ids: string[] = [];
    const owners = new Set<string>();
    for (const placement of fill.placements) {
      const [row] = await tx
        .insert(eventAllocations)
        .values({
          campaignId: positioning.id,
          screenhostId: placement.screenhostId,
          blocs: placement.blocs,
          impressionsTotal: placement.impressionsTotal,
          montantTnd: placement.montantTnd.toFixed(3),
          statut: 'EN_ATTENTE',
        })
        .returning({ id: eventAllocations.id });
      if (row) ids.push(row.id);
      await reserveBlocHours(tx, event.id, placement.screenhostId, placement.blocs);
      owners.add(placement.ownerId);
    }
    if (owners.size > 0) {
      await tx.insert(notifications).values(
        [...owners].map((ownerId) => ({
          userId: ownerId,
          type: 'dispatch_pending_acceptance',
          title: EVENT_PROPOSAL_TITLE,
          body: eventProposalBody(positioning.name),
          campaignId: positioning.id,
        })),
      );
    }
    if (fill.partial) {
      // D6 — the alert: the advertiser learns the placement is partial.
      await tx.insert(notifications).values({
        userId: positioning.advertiserId,
        type: 'event_dispatch_partial',
        title: EVENT_PARTIAL_TITLE,
        body: eventPartialBody(positioning.name),
        campaignId: positioning.id,
      });
    }
    return ids;
  });

  return { status: 'OK', partial: fill.partial, allocationIds };
};

type DbExecutor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** Reserve every Tunis (day, hour) cell the placed blocs touch — idempotent per cell. */
export const reserveBlocHours = async (
  executor: DbExecutor,
  eventId: string,
  screenhostId: string,
  blocs: readonly PlacedBloc[],
): Promise<void> => {
  const cells = new Map<string, { day: string; hour: number }>();
  for (const bloc of blocs) {
    for (const c of blocCells(new Date(bloc.start), new Date(bloc.end))) {
      cells.set(`${c.date}:${c.hour}`, { day: c.date, hour: c.hour });
    }
  }
  if (cells.size === 0) return;
  await executor
    .insert(hourReservations)
    .values([...cells.values()].map(({ day, hour }) => ({ screenhostId, day, hour, eventId })))
    .onConflictDoNothing();
};

/** Release a venue's holds for this event (the REFUSE path — its blocs will never air). */
export const releaseBlocHours = async (
  executor: DbExecutor,
  eventId: string,
  screenhostId: string,
): Promise<void> => {
  await executor
    .delete(hourReservations)
    .where(
      and(eq(hourReservations.eventId, eventId), eq(hourReservations.screenhostId, screenhostId)),
    );
};

export interface EventCascadeOutcome {
  status: 'REPLACED' | 'PARTIAL' | 'NO_POOL';
  allocationIds: string[];
}

/**
 * §11.1 — the refusal cascade: re-run the fill for the REFUSED impressions over the remaining
 * pool (venues already holding ANY allocation for this positioning — whatever their statut —
 * and the refused venue itself are out). The re-fill budget is the refused share's VALUE; D6
 * partial is accepted if the remaining pool is thin. Runs on the CALLER's transaction so the
 * decision flip and the re-placement land atomically.
 */
export const runEventRefusalCascade = async (
  executor: DbExecutor,
  positioning: { id: string; name: string },
  event: EventRef,
  refused: { screenhostId: string; impressionsTotal: number },
  cpmEvtTnd: number,
): Promise<EventCascadeOutcome> => {
  const held = await executor
    .select({ screenhostId: eventAllocations.screenhostId })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, positioning.id));
  const exclude = new Set<string>(held.map((h) => h.screenhostId));
  exclude.add(refused.screenhostId);

  const pool = await assembleEventPool(event, exclude);
  const refusedValueTnd = Math.round(refused.impressionsTotal * cpmEvtTnd) / 1000;
  // N_max is a VALIDATION gate, not a repair gate: the cascade re-places with no venue cap
  // (blocking a refusal over N_max would wedge the owner's decision).
  const fill = fillEventBlocs(pool, refusedValueTnd, cpmEvtTnd, {
    nMax: Number.POSITIVE_INFINITY,
  });
  if (fill.status === 'NMAX_EXCEEDED' || fill.status === 'NO_POOL')
    return { status: 'NO_POOL', allocationIds: [] };

  const ids: string[] = [];
  const owners = new Set<string>();
  for (const placement of fill.placements) {
    const [row] = await executor
      .insert(eventAllocations)
      .values({
        campaignId: positioning.id,
        screenhostId: placement.screenhostId,
        blocs: placement.blocs,
        impressionsTotal: placement.impressionsTotal,
        montantTnd: placement.montantTnd.toFixed(3),
        statut: 'EN_ATTENTE',
      })
      .returning({ id: eventAllocations.id });
    if (row) ids.push(row.id);
    await reserveBlocHours(executor, event.id, placement.screenhostId, placement.blocs);
    owners.add(placement.ownerId);
  }
  if (owners.size > 0) {
    await executor.insert(notifications).values(
      [...owners].map((ownerId) => ({
        userId: ownerId,
        type: 'dispatch_pending_acceptance',
        title: EVENT_PROPOSAL_TITLE,
        body: eventProposalBody(positioning.name),
        campaignId: positioning.id,
      })),
    );
  }
  return { status: fill.partial ? 'PARTIAL' : 'REPLACED', allocationIds: ids };
};
