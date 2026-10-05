import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { events } from '../db/schema.js';

import { eventMinutesPriceTnd } from './event-pricing/minutes.js';
import { computeEventCmax } from './event-pricing/pricing.js';

// EVT-MIN1 — ONE home for « can this positioning buy N minutes, and at what price »: the draft
// PATCH (which derives requested_budget from the minutes), the submit gate and the cart gate all
// read it, so the three can never disagree. The price is the first N minutes of the ordered list
// at the positioning's OWN event CPM (CPM-1/CPM-3).

export type EventMinutesVerdict =
  | { ok: true; priceTnd: number; maxMinutes: number }
  | { ok: false; reason: 'EVENT_ANNULE' }
  | { ok: false; reason: 'MINUTES_EXCEED_AVAILABLE'; maxMinutes: number; cMaxTnd: number };

export const checkEventMinutes = async (
  eventId: string,
  minutes: number,
  cpmEvtTnd: number,
): Promise<EventMinutesVerdict> => {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev || ev.annule) return { ok: false, reason: 'EVENT_ANNULE' };
  const cmax = await computeEventCmax(
    { id: ev.id, kickoffAt: ev.kickoffAt, endsAt: ev.endsAt },
    cpmEvtTnd,
  );
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
    priceTnd: eventMinutesPriceTnd(cmax.minutes, minutes),
    maxMinutes: cmax.maxMinutes,
  };
};
