import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { businessSectors, events, screenhosts } from '../../db/schema.js';

import { eventEligibleVenues } from './pricing.js';

// CAP-EVT1 (operator-accepted default, 2026-09-22) — the EVENT page's map. The positioning parcours
// reuses the classic StepZones, so it plots GET /api/campaigns/:id/coverage on the positioning
// draft; for such a draft that endpoint answers with EXACTLY the event pool of its match —
// eventEligibleVenues, the one function event pricing, event dispatch, the event cascade and the
// event booster read (no re-implementation here): active, approved owner, installed screen, event
// switch on, event-eligible sector, ≥ 1 available bloc. No audience, zone or category × class
// rule. This file only adds what a map needs to draw each venue.
//
// A read: eventEligibleVenues computes no A_max (its ratchet writes), so opening the map writes
// nothing.

/** One venue as the coverage map needs it (coordinates are numeric strings, NULL = unplottable). */
export interface CoverageVenue {
  id: string;
  name: string;
  latitude: string | null;
  longitude: string | null;
  sectorName: string | null;
}

/** The event pool of `eventId`'s match, with what the map draws. Unknown event → nothing. */
export const eventCoverageVenues = async (eventId: string): Promise<CoverageVenue[]> => {
  const [event] = await db
    .select({ id: events.id, kickoffAt: events.kickoffAt, endsAt: events.endsAt })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return [];
  const pool = await eventEligibleVenues(event);
  if (pool.length === 0) return [];
  return db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      latitude: screenhosts.latitude,
      longitude: screenhosts.longitude,
      sectorName: businessSectors.name,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(screenhosts.businessSectorId, businessSectors.id))
    .where(
      inArray(
        screenhosts.id,
        pool.map((v) => v.id),
      ),
    );
};
