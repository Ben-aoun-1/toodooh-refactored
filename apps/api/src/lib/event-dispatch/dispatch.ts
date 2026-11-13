import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, eventAllocations, hourReservations, notifications } from '../../db/schema.js';
import { demoEventPlacements, demoEventStart, demoEventStartDate } from '../demo-event.js';
import { demoDelayMinutes, eventPoolDemoVenues } from '../demo.js';
import {
  EVENT_PROPOSAL_TITLE,
  type ShareOrigin,
  eventProposalBody,
  noticeNewEventShares,
} from '../event-host-notice.js';
import {
  type EventMinutePlacement,
  eventSeatModel,
  takeEventMinutes,
} from '../event-pricing/minutes.js';
import {
  REPS_PER_BLOC,
  type EventRef,
  blocCells,
  computeAmax,
  computeEventCmax,
  eventEligibleVenues,
} from '../event-pricing/pricing.js';
import { campaignPlaysPerMinute } from '../event-pricing/spot.js';

// EV4 — THE EVENT DISPATCH ENGINE (its own module, the D51 boundary: nothing here imports
// lib/dispatch or any campaign lib — the campaign engine and this one only ever meet at the
// hour_reservations table, where the campaign side reads a generic subtraction it has always
// been blind to).
//
// The rules (engine doc D1–D7):
//   D1 — eligibility per EV2: active venue, APPROVED owner (ELIG-2), INSTALLED screen (MAP-TV1),
//        EVENT SWITCH on (CAP-EVT1 — a « Capacité de diffusion » set), event-eligible sector,
//        per-bloc availability (opening hours ∩ E2 declarations ∩ OTHER events' reservations,
//        full-bloc-only) — ONE function, eventEligibleVenues (lib/event-pricing/pricing.ts).
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
//
// EVT-MIN1 (2026-10-05) — a positioning bought IN MINUTES (campaigns.event_minutes set) skips
// D3–D7: it takes the FIRST N minutes of computeEventCmax's ordered list (one seat per bloc per
// venue, lib/event-pricing/minutes.ts), under a per-event advisory lock so two validations can
// never sell the same last seat. Fewer free minutes than bought refuses (MINUTES_UNAVAILABLE) —
// never a silent partial. Positionings without event_minutes keep D1–D7 below (ruling A1).

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
 * D1/D2 — assemble the bloc pool: the event pool of eventEligibleVenues (lib/event-pricing — THE
 * one home, the same set the ceiling prices), each venue with its A_max, SPS desc (ancienneté asc,
 * id asc tiebreaks). `excludeScreenhostIds` keeps refused/already-allocated venues out of a cascade
 * re-fill.
 */
export const assembleEventPool = async (
  event: EventRef,
  excludeScreenhostIds: ReadonlySet<string> = new Set(),
): Promise<EventPoolVenue[]> => {
  const eligible = await eventEligibleVenues(event, excludeScreenhostIds);
  const pool: EventPoolVenue[] = [];
  for (const venue of eligible) {
    const amaxPph = await computeAmax(venue.id);
    pool.push({
      screenhostId: venue.id,
      ownerId: venue.ownerId,
      name: venue.name,
      sps: venue.sps,
      createdAtMs: venue.createdAtMs,
      amaxPph,
      blocs: venue.blocs.map((b) => ({ start: b.start, end: b.end })),
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

// §11.1 — the proposal copy lives with the rule that sends it (lib/event-host-notice); the alert
// copy is this module's own (French, ONE home each).
export { EVENT_PROPOSAL_TITLE, eventProposalBody };
export const EVENT_PARTIAL_TITLE = 'Placement partiel de votre positionnement';
export const eventPartialBody = (matchName: string): string =>
  `Votre positionnement « ${matchName} » n'a pas pu être placé en totalité — l'inventaire disponible sur la fenêtre est limité.`;

export interface EventDispatchOutcome {
  status:
    | 'OK'
    | 'ALREADY_DISPATCHED'
    | 'NMAX_EXCEEDED'
    | 'NO_POOL'
    | 'CPM_CHANGED'
    | 'MINUTES_UNAVAILABLE';
  nMax?: number;
  /** MINUTES_UNAVAILABLE — the free minutes left when the validation ran. */
  availableMinutes?: number;
  partial?: boolean;
  allocationIds?: string[];
}

/**
 * The persisted dispatch: assemble → fill → ONE transaction writing event_allocations
 * (EN_ATTENTE) + their hour_reservations (every Tunis hour a placed bloc touches — EV2's
 * conservative hour grain, one row per (venue, day, hour, event)). D7 refuses BEFORE any
 * write; a re-run over an already-dispatched positioning short-circuits (the SK1 resume
 * idiom — no re-fill, no duplicate rows, no duplicate notifications).
 *
 * CPM-3 — `cpmCheck` is OPT-IN (the activation paths pass it; built by the caller, so this module
 * keeps its D51 boundary): it re-checks cpmEvtTnd under the advertiser's lock as the write
 * transaction's FIRST statements; a CPM changed since the caller read it → CPM_CHANGED, nothing
 * written.
 */
export const runEventDispatch = async (
  positioning: {
    id: string;
    name: string;
    advertiserId: string;
    requestedBudget: number;
    /** EVT-MIN1 — set = the minutes model; null = EV4's whole-bloc fill (ruling A1). */
    eventMinutes: number | null;
  },
  event: EventRef,
  cpmEvtTnd: number,
  cpmCheck?: (tx: FreezeTx, freezeCpm: number) => Promise<boolean>,
): Promise<EventDispatchOutcome> => {
  const existing = await db
    .select({ id: eventAllocations.id })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, positioning.id))
    .limit(1);
  if (existing.length > 0) return { status: 'ALREADY_DISPATCHED' };
  if (positioning.eventMinutes !== null) {
    return runEventMinutesDispatch(
      { ...positioning, eventMinutes: positioning.eventMinutes },
      event,
      cpmEvtTnd,
      cpmCheck,
    );
  }

  const pool = await assembleEventPool(event);
  const fill = fillEventBlocs(pool, positioning.requestedBudget, cpmEvtTnd);
  if (fill.status === 'NMAX_EXCEEDED') return { status: 'NMAX_EXCEEDED', nMax: fill.nMax };
  if (fill.status === 'NO_POOL') return { status: 'NO_POOL' };

  // ONE transaction: allocations + reservations + owner proposals + the D6 alert are
  // all-or-nothing (the classic freeze-tx idiom).
  const allocationIds = await db.transaction(async (tx) => {
    if (cpmCheck && !(await cpmCheck(tx, cpmEvtTnd))) return null;
    const ids = await writeEventPlacements(tx, positioning, event, fill.placements, 'booking');
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
  if (allocationIds === null) return { status: 'CPM_CHANGED' };

  return { status: 'OK', partial: fill.partial, allocationIds };
};

type FreezeTx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type DbExecutor = typeof db | FreezeTx;

/**
 * EVT-MIN1 — serialise seat sales per event: the lock is held to the end of the caller's
 * transaction, and the minute list is read AFTER it, so it sees every committed sale.
 */
export const lockEventSeats = async (executor: DbExecutor, eventId: string): Promise<void> => {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`event-seats:${eventId}`}))`);
};

/**
 * Write placements (whole blocs or minute seats): allocations EN_ATTENTE + hour holds, then each
 * share's notice — Mariem 05/11 (lib/event-host-notice): it waits for the match's grouped
 * notice, is proposed alone, or is accepted on the owner's behalf. `origin` tells a booking from
 * a re-placement after a refusal.
 */
export const writeEventPlacements = async (
  executor: DbExecutor,
  positioning: { id: string; name: string },
  event: { id: string; kickoffAt: Date },
  placements: readonly (EventPlacement | EventMinutePlacement)[],
  origin: ShareOrigin,
): Promise<string[]> => {
  const shares: {
    allocationId: string;
    screenhostId: string;
    ownerId: string;
    montantTnd: number;
  }[] = [];
  for (const placement of placements) {
    const [row] = await executor
      .insert(eventAllocations)
      .values({
        campaignId: positioning.id,
        screenhostId: placement.screenhostId,
        blocs: placement.blocs,
        impressionsTotal: placement.impressionsTotal,
        montantTnd: placement.montantTnd.toFixed(3),
        statut: 'EN_ATTENTE',
        // Waiting for its notice until noticeNewEventShares (below) says otherwise.
        notice: null,
      })
      .returning({ id: eventAllocations.id });
    if (row) {
      shares.push({
        allocationId: row.id,
        screenhostId: placement.screenhostId,
        ownerId: placement.ownerId,
        montantTnd: placement.montantTnd,
      });
    }
    await reserveBlocHours(executor, event.id, placement.screenhostId, placement.blocs);
  }
  await noticeNewEventShares(executor, { positioning, event, shares, origin });
  return shares.map((s) => s.allocationId);
};

/**
 * DEMO-3 — a demo positioning's placements: moved onto the demo timeline (lib/demo-event.ts),
 * ACCEPTE on the owner's behalf with no proposal sent (DEMO-1 Q1 A), and no hour held (a demo pod
 * must not keep the venue's hours from the campaign engine). The positioning starts on the demo's
 * first day, so its launch makes it active.
 */
export const writeDemoMinutePlacements = async (
  executor: DbExecutor,
  positioningId: string,
  placements: readonly EventMinutePlacement[],
  now: Date = new Date(),
): Promise<string[]> => {
  const start = demoEventStart(now, await demoDelayMinutes(executor));
  const ids: string[] = [];
  for (const placement of demoEventPlacements(placements, start)) {
    const [row] = await executor
      .insert(eventAllocations)
      .values({
        campaignId: positioningId,
        screenhostId: placement.screenhostId,
        blocs: placement.blocs,
        impressionsTotal: placement.impressionsTotal,
        montantTnd: placement.montantTnd.toFixed(3),
        statut: 'ACCEPTE',
        decidedAt: now,
        notice: 'auto',
      })
      .returning({ id: eventAllocations.id });
    if (row) ids.push(row.id);
  }
  await executor
    .update(campaigns)
    .set({ startDate: demoEventStartDate(start) })
    .where(eq(campaigns.id, positioningId));
  return ids;
};

/** EVT-MIN1 — the minutes dispatch: the first N minutes of the ordered list, all or nothing. */
const runEventMinutesDispatch = async (
  positioning: { id: string; name: string; requestedBudget: number; eventMinutes: number },
  event: EventRef,
  cpmEvtTnd: number,
  cpmCheck?: (tx: FreezeTx, freezeCpm: number) => Promise<boolean>,
): Promise<EventDispatchOutcome> => {
  const outcome = await db.transaction(async (tx): Promise<EventDispatchOutcome> => {
    if (cpmCheck && !(await cpmCheck(tx, cpmEvtTnd))) return { status: 'CPM_CHANGED' };
    await lockEventSeats(tx, event.id);
    // DEMO-3 — a demo screencaster's minutes are taken on the demo venues.
    const demoVenues = await eventPoolDemoVenues(tx, positioning.id);
    const { minutes } = await computeEventCmax(
      event,
      cpmEvtTnd,
      new Set(),
      await campaignPlaysPerMinute(positioning.id, tx),
      demoVenues,
    );
    if (minutes.length === 0) return { status: 'NO_POOL' };
    const take = takeEventMinutes(
      minutes,
      positioning.eventMinutes,
      positioning.requestedBudget,
      eventSeatModel(event.seatMinutes),
    );
    if (take.status === 'NOT_ENOUGH') {
      return { status: 'MINUTES_UNAVAILABLE', availableMinutes: take.available };
    }
    const allocationIds =
      demoVenues === null
        ? await writeEventPlacements(tx, positioning, event, take.placements, 'booking')
        : await writeDemoMinutePlacements(tx, positioning.id, take.placements);
    return { status: 'OK', partial: false, allocationIds };
  });
  return outcome;
};

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

/**
 * Mariem 05/11 — a positioning a superadmin stopped no longer airs: each of its venues drops the
 * match's holds, unless another live positioning still holds a share there (its blocs still air).
 */
export const releaseIdleBlocHours = async (
  executor: DbExecutor,
  eventId: string,
  screenhostIds: readonly string[],
): Promise<void> => {
  for (const screenhostId of new Set(screenhostIds)) {
    const [live] = await executor
      .select({ id: eventAllocations.id })
      .from(eventAllocations)
      .innerJoin(campaigns, eq(eventAllocations.campaignId, campaigns.id))
      .where(
        and(
          eq(campaigns.eventId, eventId),
          eq(eventAllocations.screenhostId, screenhostId),
          ne(eventAllocations.statut, 'REFUSE'),
          inArray(campaigns.status, ['pending', 'upcoming', 'active']),
        ),
      )
      .limit(1);
    if (!live) await releaseBlocHours(executor, eventId, screenhostId);
  }
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
  positioning: { id: string; name: string; eventMinutes: number | null },
  event: EventRef,
  /** `seats` = the refused allocation's placed blocs (one seat each, of the match's model). */
  refused: { screenhostId: string; impressionsTotal: number; seats: number; montantTnd: number },
  cpmEvtTnd: number,
): Promise<EventCascadeOutcome> => {
  const held = await executor
    .select({ screenhostId: eventAllocations.screenhostId })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, positioning.id));
  const exclude = new Set<string>(held.map((h) => h.screenhostId));
  exclude.add(refused.screenhostId);

  // EVT-MIN1 — a minutes positioning re-places the refused SEATS on the next free seats of the
  // ordered list (held + refused venues out), charged up to the refused value. A repair, not a
  // purchase: fewer free seats than refused places what exists (PARTIAL), the rest is refunded
  // at settlement (REFUSE carries no money).
  if (positioning.eventMinutes !== null) {
    await lockEventSeats(executor, event.id);
    const { minutes } = await computeEventCmax(
      event,
      cpmEvtTnd,
      exclude,
      await campaignPlaysPerMinute(positioning.id, executor),
    );
    const model = eventSeatModel(event.seatMinutes);
    const count = Math.min(refused.seats, minutes.length);
    if (count === 0) return { status: 'NO_POOL', allocationIds: [] };
    const take = takeEventMinutes(minutes, count * model.seatMinutes, refused.montantTnd, model);
    if (take.status === 'NOT_ENOUGH') return { status: 'NO_POOL', allocationIds: [] };
    const ids = await writeEventPlacements(
      executor,
      positioning,
      event,
      take.placements,
      'redispatch',
    );
    return { status: count < refused.seats ? 'PARTIAL' : 'REPLACED', allocationIds: ids };
  }

  const pool = await assembleEventPool(event, exclude);
  const refusedValueTnd = Math.round(refused.impressionsTotal * cpmEvtTnd) / 1000;
  // N_max is a VALIDATION gate, not a repair gate: the cascade re-places with no venue cap
  // (blocking a refusal over N_max would wedge the owner's decision).
  const fill = fillEventBlocs(pool, refusedValueTnd, cpmEvtTnd, {
    nMax: Number.POSITIVE_INFINITY,
  });
  if (fill.status === 'NMAX_EXCEEDED' || fill.status === 'NO_POOL')
    return { status: 'NO_POOL', allocationIds: [] };

  const ids = await writeEventPlacements(
    executor,
    positioning,
    event,
    fill.placements,
    'redispatch',
  );
  return { status: fill.partial ? 'PARTIAL' : 'REPLACED', allocationIds: ids };
};
