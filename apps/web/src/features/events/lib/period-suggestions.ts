import { sectorDisplayName } from '@/features/advertiser/constants/sector-display-name';

import type { EventItemView } from '../services/events.api';

import { suggestEventsForCampaigns } from './event-positioning';

// SUGG-1 — the « Votre campagne a été ajoutée au panier » page (Figma « Lancer une campagne »,
// last frame; operator rulings 2026-09-28: Q3 A = events INSIDE the campaign's own period, no
// +7-day tail). Operator 2026-10-09 (Q5A) supersedes P4 A: with no event in the period the page
// still shows (PERIOD_SUGGESTION_EMPTY) instead of jumping to the panier. ONE home for the
// page's rule and literals — the components only render these.

export const PERIOD_SUGGESTION_ADDED = 'Votre campagne a été ajoutée au panier';

export const PERIOD_SUGGESTION_HEADING =
  'Augmentez votre impact en diffusant votre spot lors d’événements prévus dans la même période';

/** Operator ruling 2026-10-09 (Q5A) — no event in the period: the page still shows, and says so. */
export const PERIOD_SUGGESTION_EMPTY =
  'Aucun événement n’est prévu pendant votre campagne pour le moment. Découvrez tous les événements à venir.';

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

/** The page's events: kickoff INSIDE the period, upcoming, not the advertiser's own, top 3. */
export const suggestEventsForPeriod = (
  campaign: CampaignPeriod,
  events: EventItemView[],
  now: Date = new Date(),
  ownPositionedEventIds: ReadonlySet<string> = new Set(),
): EventItemView[] => suggestEventsForCampaigns([campaign], events, now, ownPositionedEventIds, 0);

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
