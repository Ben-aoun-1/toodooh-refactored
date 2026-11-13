import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { events } from '../db/schema.js';

import { eventMinutesPriceTnd, eventSeatModel, eventSeatsFor } from './event-pricing/minutes.js';
import { computeEventCmax } from './event-pricing/pricing.js';

// EVT-MIN1 — ONE home for « can this positioning buy N minutes, and at what price »: the draft
// PATCH (which derives requested_budget from the minutes), the submit gate and the cart gate all
// read it, so the three can never disagree. The price is the first N minutes of the ordered list
// at the positioning's OWN event CPM (CPM-1/CPM-3) and, since EVT-PRICE2, its spot's R (the plays
// per minute — lib/event-pricing/spot.ts positioningPlaysPerMinute): no spot, no price.

export type EventMinutesVerdict =
  | { ok: true; priceTnd: number; maxMinutes: number }
  | { ok: false; reason: 'EVENT_ANNULE' }
  | { ok: false; reason: 'SPOT_REQUIRED' }
  /** Mariem 04/11 — minutes come in whole seats of the match (2 minutes; 1 under EVT-MIN1). */
  | { ok: false; reason: 'MINUTES_STEP'; seatMinutes: number }
  | { ok: false; reason: 'MINUTES_EXCEED_AVAILABLE'; maxMinutes: number; cMaxTnd: number };

export const checkEventMinutes = async (
  eventId: string,
  minutes: number,
  cpmEvtTnd: number,
  playsPerMinute: number | null,
  /** DEMO-3 — a demo screencaster's pool (lib/demo.ts eventPoolDemoVenues); null = the network. */
  demoVenues: ReadonlySet<string> | null = null,
): Promise<EventMinutesVerdict> => {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev || ev.annule) return { ok: false, reason: 'EVENT_ANNULE' };
  if (playsPerMinute === null) return { ok: false, reason: 'SPOT_REQUIRED' };
  const cmax = await computeEventCmax(
    { id: ev.id, kickoffAt: ev.kickoffAt, endsAt: ev.endsAt, seatMinutes: ev.seatMinutes },
    cpmEvtTnd,
    new Set(),
    playsPerMinute,
    demoVenues,
  );
  const model = eventSeatModel(ev.seatMinutes);
  if (eventSeatsFor(minutes, model) === null) {
    return { ok: false, reason: 'MINUTES_STEP', seatMinutes: model.seatMinutes };
  }
  if (minutes > cmax.maxMinutes) {
    return {
      ok: false,
      reason: 'MINUTES_EXCEED_AVAILABLE',
      maxMinutes: cmax.maxMinutes,
      cMaxTnd: cmax.cMaxEvtTnd,
    };
  }
  return {
    ok: true,
    priceTnd: eventMinutesPriceTnd(cmax.minutes, minutes, model),
    maxMinutes: cmax.maxMinutes,
  };
};
