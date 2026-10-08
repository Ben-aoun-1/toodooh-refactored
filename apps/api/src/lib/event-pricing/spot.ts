// EV2 — the event-spot length seam; EVT-MIN1 (ruling 7A, 2026-10-05) re-rules it, and EVT-PRICE2
// (2026-10-08) makes billing depend on it: a minute's impressions are A_max ÷ 3 × R, R = the
// spot's plays in its minute (positioningPlaysPerMinute below). The POD is cut into slots: an event
// VIDEO lasts 10–30 s and airs in the smallest slot dividing the minute (10/12/15/20/30 s — a
// 23 s spot fills a 30 s slot, the remaining 7 s show the Toodooh screen). An event IMAGE is shown
// for the 10, 20 or 30 s its screencaster chose (the upload already restricts photo durations to
// those three). Wired at the positioning ATTACH and at upload (?for_event=1).

import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { campaigns, creatives } from '../../db/schema.js';

import {
  EVENT_VIDEO_MAX_SECONDS,
  EVENT_VIDEO_MIN_SECONDS,
  eventSlotSeconds,
  eventSpotPlaysPerMinute,
} from './minutes.js';

/** Kept for the wire/tests vocabulary: the longest event video. */
export const EVENT_SPOT_MAX_SECONDS = EVENT_VIDEO_MAX_SECONDS;
export const EVENT_SPOT_MIN_SECONDS = EVENT_VIDEO_MIN_SECONDS;

export interface EventSpotCheck {
  creativeType: string;
  durationSeconds: number | null;
}

export type EventSpotVerdict = { ok: true; slotSeconds: number } | { ok: false; reason: string };

export function validateEventSpot(creative: EventSpotCheck): EventSpotVerdict {
  if (creative.durationSeconds === null || creative.durationSeconds <= 0) {
    return {
      ok: false,
      reason:
        creative.creativeType === 'video'
          ? 'La durée du spot vidéo est inconnue.'
          : 'La durée d’affichage de l’image est inconnue.',
    };
  }
  const slot = eventSlotSeconds(creative.creativeType, creative.durationSeconds);
  if (slot === null) {
    return {
      ok: false,
      reason:
        creative.creativeType === 'video'
          ? `Un spot vidéo événementiel dure entre ${EVENT_VIDEO_MIN_SECONDS} et ${EVENT_VIDEO_MAX_SECONDS} secondes.`
          : 'Une image événementielle s’affiche 10, 20 ou 30 secondes.',
    };
  }
  return { ok: true, slotSeconds: slot };
}

/**
 * EVT-PRICE2 — R for a positioning: its linked spot's plays per minute (eventSpotPlaysPerMinute).
 * null when no spot is linked, or the linked one cannot air in a pod — the caller decides (the
 * minutes gate refuses to price without a spot; the catalogue prices the audience, R = 1).
 */
export const positioningPlaysPerMinute = async (
  creativeId: string | null,
  executor: Pick<typeof db, 'select'> = db,
): Promise<number | null> => {
  if (creativeId === null) return null;
  const [row] = await executor
    .select({ creativeType: creatives.creativeType, durationSeconds: creatives.durationSeconds })
    .from(creatives)
    .where(eq(creatives.id, creativeId))
    .limit(1);
  return row ? eventSpotPlaysPerMinute(row.creativeType, row.durationSeconds) : null;
};

/**
 * EVT-PRICE2 — R for a positioning read by its id (the dispatch, cascade, booster and estimate
 * paths hold the positioning's id, not its creative). A positioning past the draft always has a
 * spot that fits a pod (the attach refuses any other); 1 — the audience alone — only guards a row
 * that somehow has none, never pricing it above what it can air.
 */
export const campaignPlaysPerMinute = async (
  campaignId: string,
  executor: Pick<typeof db, 'select'> = db,
): Promise<number> => {
  const [row] = await executor
    .select({ creativeType: creatives.creativeType, durationSeconds: creatives.durationSeconds })
    .from(campaigns)
    .innerJoin(creatives, eq(campaigns.creativeId, creatives.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return (row ? eventSpotPlaysPerMinute(row.creativeType, row.durationSeconds) : null) ?? 1;
};
