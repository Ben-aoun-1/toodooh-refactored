// EV2 — the event-spot length seam; EVT-MIN1 (ruling 7A, 2026-10-05) re-rules it. Billing never
// depends on the spot's length (pricing.ts / minutes.ts), but the POD is cut into slots: an event
// VIDEO lasts 10–30 s and airs in the smallest slot dividing the minute (10/12/15/20/30 s — a
// 23 s spot fills a 30 s slot, the remaining 7 s show the Toodooh screen). An event IMAGE is shown
// for the 10, 20 or 30 s its screencaster chose (the upload already restricts photo durations to
// those three). Wired at the positioning ATTACH and at upload (?for_event=1).

import { EVENT_VIDEO_MAX_SECONDS, EVENT_VIDEO_MIN_SECONDS, eventSlotSeconds } from './minutes.js';

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
