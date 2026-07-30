import type { CreativeView } from '@/features/campaigns/services/creatives.api';

import type { EventItemView } from '../services/events.api';

// EV3 — the positioning parcours' pure rules, ONE home (the page, the panier sections, the
// suggestions block and the tests all read these — no duplicated literals in components).

/** The antenne grid: an event VIDEO over 15 s can never air in a bloc (EV2's seam, mirrored). */
export const EVENT_SPOT_MAX_SECONDS = 15;

/** The French refusal the api sends for a too-long video — mirrored for client-side pre-checks. */
export const EVENT_SPOT_TOO_LONG_MESSAGE = `Un spot vidéo événementiel ne peut pas dépasser ${EVENT_SPOT_MAX_SECONDS} secondes.`;

/**
 * The bibliothèque filter of the Vidéo step: videos must fit the 15 s grid; photos always pass
 * (their duration is a display cadence, not a media length — the api rule, mirrored).
 */
export const eventSpotSelectable = (creative: {
  creative_type: string;
  duration_seconds: number | null;
}): boolean =>
  creative.creative_type !== 'video' ||
  (creative.duration_seconds !== null &&
    creative.duration_seconds > 0 &&
    creative.duration_seconds <= EVENT_SPOT_MAX_SECONDS);

export const filterEventSpots = (creatives: CreativeView[]): CreativeView[] =>
  creatives.filter(eventSpotSelectable);

/** The panier's two sections: an item with an event BINDING files under Événements. */
export function splitCartSections<T extends { event_id: string | null }>(
  items: T[],
): { campagnes: T[]; evenements: T[] } {
  const campagnes: T[] = [];
  const evenements: T[] = [];
  for (const item of items) (item.event_id === null ? campagnes : evenements).push(item);
  return { campagnes, evenements };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Voie 3 — how long after a campaign's end a kickoff still counts as « proche ». */
export const SUGGESTION_AFTER_END_DAYS = 7;

/** The block's size — « top 3 by proximity ». */
export const SUGGESTION_MAX = 3;

interface CampaignWindow {
  start_date: string | null;
  end_date: string | null;
}

/**
 * Voie 3 (cart-add confirmation) — an event is suggested against a CLASSIC campaign when its
 * kickoff falls INSIDE the campaign's window, or within 7 days AFTER its end. Windows are Tunis
 * calendar dates; the kickoff instant is compared against the day bounds in +01:00 (no DST).
 */
export const eventSuggestedForWindow = (kickoffIso: string, window: CampaignWindow): boolean => {
  if (!window.start_date || !window.end_date) return false;
  const kickoff = new Date(kickoffIso).getTime();
  const windowStart = new Date(`${window.start_date}T00:00:00+01:00`).getTime();
  const windowEnd = new Date(`${window.end_date}T00:00:00+01:00`).getTime() + DAY_MS;
  return kickoff >= windowStart && kickoff < windowEnd + SUGGESTION_AFTER_END_DAYS * DAY_MS;
};

/**
 * The « Suggestions d'événements » block: every catalogue event whose kickoff sits inside (or
 * ≤ 7 days after) ANY of the classic windows, still positionable (à venir, not annulé — the
 * catalogue only serves live rows), deduplicated, TOP 3 by proximity (soonest kickoff first).
 * EV3 amendment (ratified): events the REQUESTING advertiser already positioned on are
 * EXCLUDED — any non-deleted positioning, any status, carted included (a match never suggests
 * itself to someone already on it). The set derives from the advertiser's OWN campaign list,
 * so another advertiser's positioning never hides a match from you.
 */
export function suggestEventsForCampaigns(
  campaigns: CampaignWindow[],
  events: EventItemView[],
  now: Date = new Date(),
  ownPositionedEventIds: ReadonlySet<string> = new Set(),
): EventItemView[] {
  const nowMs = now.getTime();
  return events
    .filter((e) => e.statut === 'a_venir')
    .filter((e) => !ownPositionedEventIds.has(e.id))
    .filter((e) => campaigns.some((c) => eventSuggestedForWindow(e.kickoff_at, c)))
    .sort(
      (a, b) =>
        Math.abs(new Date(a.kickoff_at).getTime() - nowMs) -
        Math.abs(new Date(b.kickoff_at).getTime() - nowMs),
    )
    .slice(0, SUGGESTION_MAX);
}
