// EVT-MIN1 (operator rulings 2026-10-05) — THE EVENT MINUTES MODEL, one home for its rules.
//
// A 20-minute bloc carries a 5-minute advertising POD shared by at most FIVE screencasters, each
// owning exactly ONE minute of it (a « seat »). What a screencaster buys is a number of minutes:
// one minute = one seat in one bloc at one venue. Their minutes are taken from an ORDERED list —
// venues best-SPS first (EV4's D2 order), each venue's blocs in chronological order — so lowering
// the slider gives up the LAST venue's LATEST bloc first (ruling 3A).
//
//   price(minute)       = CPM_evt × A_max × 4 ÷ 1000, to the centime (ruling 1A: one minute =
//                         four S_ref 15 s reps; the spot's real length never changes the price)
//   impressions(minute) = A_max × 4
//   min purchase        = 1 minute (ruling 4A — the 100 TND floor, N_max, the 20 TND miette and
//                         partial placement are retired for this model)
//
// The pod (ruling 5B + 5C): spots ROTATE (A, B, C, A, B, C …) and the pod lasts exactly
// (seats sold × 1 min) — avant blocs open with it, après blocs close with it. The rest of the
// bloc stays blacked out (ruling 6B) and shows the TV's Toodooh screen.
//
// Lengths (ruling 7A): an event video lasts 10–30 s and airs in the smallest slot class that
// divides the minute — 10, 12, 15, 20 or 30 s (23 s → 30 s: 23 s of spot + 7 s of Toodooh screen,
// twice in its minute). An image's display length is chosen by the screencaster: 10, 20 or 30 s.
//
// Positionings dispatched before this model (campaigns.event_minutes NULL) keep their EV4 rules
// to the end (ruling A1): their allocation fills a bloc's whole antenne, i.e. all five seats.

export const EVENT_SEATS_PER_BLOC = 5;
export const EVENT_SEAT_SECONDS = 60;
/** One minute = four reference 15 s reps (S_REF_SECONDS in ./pricing.ts). */
export const EVENT_MINUTE_REPS = 4;

export const EVENT_VIDEO_MIN_SECONDS = 10;
export const EVENT_VIDEO_MAX_SECONDS = 30;
/** The slot classes: every length in [10, 30] that divides a minute. */
export const EVENT_SLOT_CLASSES = [10, 12, 15, 20, 30] as const;
/** The display lengths a screencaster may choose for an event IMAGE. */
export const EVENT_IMAGE_SECONDS = [10, 20, 30] as const;

export const eventMinuteImpressions = (amaxPph: number): number => amaxPph * EVENT_MINUTE_REPS;

/** CPM_evt × A_max × 4 ÷ 1000, rounded to the centime (requested_budget is numeric(12,2)). */
export const eventMinutePriceTnd = (amaxPph: number, cpmEvtTnd: number): number =>
  Math.round((cpmEvtTnd * eventMinuteImpressions(amaxPph)) / 10) / 100;

export type EventSpotKind = 'video' | 'photo';

/**
 * The slot a spot airs in: the smallest class ≥ its length for a video (10–30 s), the chosen
 * length for an image (10, 20 or 30 s). null = the spot cannot air in an event pod.
 */
export const eventSlotSeconds = (
  creativeType: string,
  durationSeconds: number | null,
): number | null => {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) return null;
  if (creativeType === 'video') {
    if (durationSeconds < EVENT_VIDEO_MIN_SECONDS || durationSeconds > EVENT_VIDEO_MAX_SECONDS) {
      return null;
    }
    return EVENT_SLOT_CLASSES.find((c) => c >= durationSeconds) ?? null;
  }
  return (EVENT_IMAGE_SECONDS as readonly number[]).includes(durationSeconds)
    ? durationSeconds
    : null;
};

/** How many times a spot airs in its minute: 60 ÷ slot. */
export const eventPlaysPerMinute = (slotSeconds: number): number =>
  Math.floor(EVENT_SEAT_SECONDS / slotSeconds);

export interface EventMinuteVenue {
  screenhostId: string;
  ownerId: string;
  amaxPph: number;
  /** The venue's blocs that still have a free seat, chronological. */
  blocs: { start: Date; end: Date }[];
}

/** One buyable minute: a seat in one bloc at one venue. */
export interface EventMinute {
  screenhostId: string;
  ownerId: string;
  blocStart: Date;
  blocEnd: Date;
  impressions: number;
  priceTnd: number;
}

/**
 * The ORDERED minute list over an SPS-ordered pool (the caller owns the venue order — EV4's
 * assembleEventPool already sorts SPS desc, ancienneté asc, id asc). Each venue contributes one
 * minute per bloc with a free seat, its blocs in chronological order. Pure.
 */
export const orderedEventMinutes = (
  pool: readonly EventMinuteVenue[],
  cpmEvtTnd: number,
): EventMinute[] =>
  pool.flatMap((venue) =>
    [...venue.blocs]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((bloc) => ({
        screenhostId: venue.screenhostId,
        ownerId: venue.ownerId,
        blocStart: bloc.start,
        blocEnd: bloc.end,
        impressions: eventMinuteImpressions(venue.amaxPph),
        priceTnd: eventMinutePriceTnd(venue.amaxPph, cpmEvtTnd),
      })),
  );

const roundCentimes = (tnd: number): number => Math.round(tnd * 100) / 100;

/** The price of the first `minutes` minutes of an ordered list (what the slider shows). */
export const eventMinutesPriceTnd = (list: readonly EventMinute[], minutes: number): number =>
  roundCentimes(list.slice(0, Math.max(0, minutes)).reduce((sum, m) => sum + m.priceTnd, 0));

export interface EventMinutePlacement {
  screenhostId: string;
  ownerId: string;
  blocs: { start: string; end: string; impressions: number }[];
  impressionsTotal: number;
  /** The CHARGED value: Σ minute prices, capped so Σ placements never exceeds the budget. */
  montantTnd: number;
}

export type EventMinutesTake =
  | { status: 'OK'; placements: EventMinutePlacement[]; impressions: number; chargedTnd: number }
  | { status: 'NOT_ENOUGH'; available: number };

/**
 * Take the first `minutes` minutes of the ordered list, grouped per venue (list order kept).
 * EV4's charge-cap invariant holds: if prices rose since the budget was set (A_max only ratchets
 * up), the overshoot is free delivery — Σ montants never exceeds `budgetTnd`. Fewer minutes than
 * asked is NOT_ENOUGH: a purchase is never silently shortened. Pure.
 */
export const takeEventMinutes = (
  list: readonly EventMinute[],
  minutes: number,
  budgetTnd: number,
): EventMinutesTake => {
  if (minutes < 1 || list.length < minutes) return { status: 'NOT_ENOUGH', available: list.length };
  const byVenue = new Map<string, EventMinutePlacement>();
  let budgetLeft = budgetTnd;
  let impressions = 0;
  let charged = 0;
  for (const minute of list.slice(0, minutes)) {
    let placement = byVenue.get(minute.screenhostId);
    if (!placement) {
      placement = {
        screenhostId: minute.screenhostId,
        ownerId: minute.ownerId,
        blocs: [],
        impressionsTotal: 0,
        montantTnd: 0,
      };
      byVenue.set(minute.screenhostId, placement);
    }
    const charge = roundCentimes(Math.max(0, Math.min(minute.priceTnd, budgetLeft)));
    budgetLeft = roundCentimes(budgetLeft - charge);
    placement.blocs.push({
      start: minute.blocStart.toISOString(),
      end: minute.blocEnd.toISOString(),
      impressions: minute.impressions,
    });
    placement.impressionsTotal += minute.impressions;
    placement.montantTnd = roundCentimes(placement.montantTnd + charge);
    impressions += minute.impressions;
    charged = roundCentimes(charged + charge);
  }
  return { status: 'OK', placements: [...byVenue.values()], impressions, chargedTnd: charged };
};

// ─── The pod ────────────────────────────────────────────────────────────────────────────────

export interface PodSeat {
  campaignId: string;
  slotSeconds: number;
}

export interface PodSlot {
  campaignId: string;
  /** Slot start (the spot starts here; the rest of the slot is the Toodooh screen). */
  at: Date;
  slotSeconds: number;
}

export interface EventPod {
  start: Date;
  end: Date;
  slots: PodSlot[];
}

/**
 * The pod window inside a bloc: avant blocs open with the pod, après blocs close with it; it
 * lasts one minute per seat aired. Zero seats = no pod.
 */
export const eventPodWindow = (
  phase: 'avant' | 'apres',
  blocStart: Date,
  blocEnd: Date,
  seats: number,
): { start: Date; end: Date } | null => {
  if (seats <= 0) return null;
  const lengthMs = Math.min(seats, EVENT_SEATS_PER_BLOC) * EVENT_SEAT_SECONDS * 1000;
  return phase === 'avant'
    ? { start: blocStart, end: new Date(blocStart.getTime() + lengthMs) }
    : { start: new Date(blocEnd.getTime() - lengthMs), end: blocEnd };
};

/**
 * The pod timeline (ruling 5B): seats in the given order (the caller passes first-booked first),
 * each owning 60 ÷ slot plays; one play per seat per ROUND, rounds repeat until every seat has
 * aired its minute. Slots are back to back from the pod start, so the timeline lasts exactly
 * seats × 60 s. Pure.
 */
export const eventPodTimeline = (
  phase: 'avant' | 'apres',
  blocStart: Date,
  blocEnd: Date,
  seats: readonly PodSeat[],
): EventPod | null => {
  const aired = seats.slice(0, EVENT_SEATS_PER_BLOC);
  const window = eventPodWindow(phase, blocStart, blocEnd, aired.length);
  if (!window) return null;
  const left = aired.map((s) => eventPlaysPerMinute(s.slotSeconds));
  const slots: PodSlot[] = [];
  let cursor = window.start.getTime();
  while (left.some((n) => n > 0)) {
    aired.forEach((seat, i) => {
      if ((left[i] ?? 0) <= 0) return;
      slots.push({
        campaignId: seat.campaignId,
        at: new Date(cursor),
        slotSeconds: seat.slotSeconds,
      });
      cursor += seat.slotSeconds * 1000;
      left[i] = (left[i] ?? 0) - 1;
    });
  }
  return { start: window.start, end: window.end, slots };
};
