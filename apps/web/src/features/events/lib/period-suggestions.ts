import { sectorDisplayName } from '@/features/advertiser/constants/sector-display-name';

import type { EventItemView } from '../services/events.api';

import { eventSuggestedForWindow } from './event-positioning';

// SUGG-1 — the « Votre campagne a été ajoutée au panier » page (Figma « Lancer une campagne »,
// last frame). Operator 2026-10-13 supersedes Q3 A (period only, top 3): the page lists EVERY
// event the screencaster can position on — first those during the campaign, then the « à la
// une » ones, then the rest, soonest first — each with « Je me positionne », nothing more.
// Operator 2026-10-09 (Q5A) still holds: with no event at all the page shows
// PERIOD_SUGGESTION_EMPTY instead of jumping to the panier. ONE home for the page's rule and
// literals — the components only render these.

export const PERIOD_SUGGESTION_ADDED = 'Votre campagne a été ajoutée au panier';

export const PERIOD_SUGGESTION_HEADING =
  'Augmentez votre impact en diffusant votre spot lors des prochains événements';

/** Operator ruling 2026-10-09 (Q5A) — no event to offer: the page still shows, and says so. */
export const PERIOD_SUGGESTION_EMPTY = 'Aucun événement n’est prévu pour le moment.';

export const PERIOD_SUGGESTION_NOTE =
  '(En incluant automatiquement toutes les catégories de commerces qui diffusent pendant le match)';

/** The card shows at most this many sector tags; the rest is counted (« +N »). */
export const PERIOD_SUGGESTION_MAX_TAGS = 2;

/**
 * What the page renders for its campaign id. The list it reads is React Query's CACHED
 * GET /campaigns/mine: a draft created inside the wizard is not in a list cached earlier (the
 * Dashboard reads it), and that cache was not refetched while nothing observed it — so « not in
 * the list » only means « missing » once no read is in flight. Before this, the stale list
 * forwarded every NEW campaign to the panier and the page never showed.
 */
export type AddedPageState = 'loading' | 'missing' | 'ready';

export const addedPageState = (input: {
  found: boolean;
  loading: boolean;
  fetching: boolean;
}): AddedPageState => {
  if (input.found) return 'ready';
  return input.loading || input.fetching ? 'loading' : 'missing';
};

interface CampaignPeriod {
  start_date: string | null;
  end_date: string | null;
}

const isFeatured = (e: EventItemView): boolean => e.featured === 'hero' || e.featured === 'pinned';

const kickoffMs = (e: EventItemView): number => new Date(e.kickoff_at).getTime();

/**
 * The page's events (operator 2026-10-13): every upcoming event the screencaster can position on
 * (« Je me positionne » works: not « à confirmer », not already theirs), in three bands —
 * 1. kickoff during the campaign, 2. « à la une » (hero / pinned), 3. all the others — each band
 * soonest first. No cap.
 */
export const suggestEventsForPeriod = (
  campaign: CampaignPeriod,
  events: EventItemView[],
  ownPositionedEventIds: ReadonlySet<string> = new Set(),
): EventItemView[] => {
  const band = (e: EventItemView): number =>
    eventSuggestedForWindow(e.kickoff_at, campaign, 0) ? 0 : isFeatured(e) ? 1 : 2;
  return events
    .filter((e) => e.statut === 'a_venir' && e.positionable !== false)
    .filter((e) => !ownPositionedEventIds.has(e.id))
    .sort((a, b) => band(a) - band(b) || kickoffMs(a) - kickoffMs(b));
};

/** « ~ 184 500 impressions » — the event's I_max, French grouping. */
export const formatApproxImpressions = (n: number): string =>
  `~ ${Math.round(n).toLocaleString('fr-FR')} impressions`;

/** The card's sector tags: display labels (UI-1), the first two shown, the rest counted. */
export const sectorTags = (
  sectors: string[],
  max: number = PERIOD_SUGGESTION_MAX_TAGS,
): { shown: string[]; extra: number } => ({
  shown: sectors.slice(0, max).map(sectorDisplayName),
  extra: Math.max(0, sectors.length - max),
});
