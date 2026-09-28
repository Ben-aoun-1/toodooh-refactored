import { sectorDisplayName } from '@/features/advertiser/constants/sector-display-name';

import type { EventItemView } from '../services/events.api';

import { suggestEventsForCampaigns } from './event-positioning';

// SUGG-1 — the « Votre campagne a été ajoutée au panier » page (Figma « Lancer une campagne »,
// last frame; operator rulings 2026-09-28: Q3 A = events INSIDE the campaign's own period, no
// +7-day tail; P4 A = no event in the period → straight to the panier). ONE home for the page's
// rule and literals — the components only render these.

export const PERIOD_SUGGESTION_ADDED = 'Votre campagne a été ajoutée au panier';

export const PERIOD_SUGGESTION_HEADING =
  'Augmentez votre impact en diffusant votre spot lors d’événements prévus dans la même période';

export const PERIOD_SUGGESTION_NOTE =
  '(En incluant automatiquement toutes les catégories de commerces qui diffusent pendant le match)';

/** The card shows at most this many sector tags; the rest is counted (« +N »). */
export const PERIOD_SUGGESTION_MAX_TAGS = 2;

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
