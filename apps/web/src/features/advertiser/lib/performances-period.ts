import {
  formatDateFr,
  monthLabelFr,
  tunisTodayIso,
} from '@/features/screenhost/lib/performance-period';

import type { CampaignNature, ClosedCampaignWire } from '../services/performances.service';

/**
 * SC-P epic 6 — the generation filter's period model (RG-PERF-15..19). Pure: the page derives
 * everything from the URL (`?campaign=` | `?periode=&du=&au=&nature=`) so Consulter, the bell's
 * deep link (US-2.1) and the filter-bar selector (US-6.4) all drive the SAME mechanism.
 *
 * Membership (RG-PERF-16) is decided api-side on the clôture date; this module only turns a pill
 * into a [from, to] window and words the context band (US-6.5).
 */

export type PeriodKey = '30d' | '90d' | '12m' | 'all' | 'custom';
export type NatureFilter = 'all' | CampaignNature;

export const PERIOD_PILLS: { key: PeriodKey; label: string }[] = [
  { key: '30d', label: '30 jours' },
  { key: '90d', label: '90 jours' },
  { key: '12m', label: '12 mois' },
  { key: 'all', label: 'Depuis le début' },
  { key: 'custom', label: 'Personnalisé' },
];

export const NATURE_PILLS: { key: NatureFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'normal', label: 'Normales' },
  { key: 'event', label: 'Événements' },
];

/** The default period once the user leaves Campaign mode (the simulator's 90 days). */
export const DEFAULT_PERIOD: PeriodKey = '90d';

export const CAMPAIGN_PARAM = 'campaign';
export const PERIOD_PARAM = 'periode';
export const FROM_PARAM = 'du';
export const TO_PARAM = 'au';
export const NATURE_PARAM = 'nature';

export type Scope =
  | { mode: 'campaign'; campaignId: string }
  | {
      mode: 'period';
      period: PeriodKey;
      nature: NatureFilter;
      custom: { from: string | null; to: string | null };
    };

const PERIOD_KEYS = new Set<string>(PERIOD_PILLS.map((p) => p.key));
const NATURE_KEYS = new Set<string>(NATURE_PILLS.map((p) => p.key));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const isoOrNull = (v: string | null): string | null => (v && ISO.test(v) ? v : null);

/**
 * Read the scope from the URL. No params at all → null: the page then applies the retained
 * hypothesis (« initialisées sur la dernière campagne clôturée »).
 */
export function parseScope(params: URLSearchParams): Scope | null {
  const campaign = params.get(CAMPAIGN_PARAM);
  if (campaign) return { mode: 'campaign', campaignId: campaign };
  const period = params.get(PERIOD_PARAM);
  if (!period) return null;
  const nature = params.get(NATURE_PARAM) ?? 'all';
  return {
    mode: 'period',
    period: PERIOD_KEYS.has(period) ? (period as PeriodKey) : DEFAULT_PERIOD,
    nature: NATURE_KEYS.has(nature) ? (nature as NatureFilter) : 'all',
    custom: { from: isoOrNull(params.get(FROM_PARAM)), to: isoOrNull(params.get(TO_PARAM)) },
  };
}

/** Write a scope back to the URL (keeps unrelated params). */
export function writeScope(params: URLSearchParams, scope: Scope): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of [CAMPAIGN_PARAM, PERIOD_PARAM, FROM_PARAM, TO_PARAM, NATURE_PARAM])
    next.delete(k);
  if (scope.mode === 'campaign') {
    next.set(CAMPAIGN_PARAM, scope.campaignId);
    return next;
  }
  next.set(PERIOD_PARAM, scope.period);
  if (scope.nature !== 'all') next.set(NATURE_PARAM, scope.nature);
  if (scope.period === 'custom') {
    if (scope.custom.from) next.set(FROM_PARAM, scope.custom.from);
    if (scope.custom.to) next.set(TO_PARAM, scope.custom.to);
  }
  return next;
}

/** The default scope on page load: Campaign mode on the newest clôture (retained hypothesis). */
export function defaultScope(closed: readonly { id: string }[]): Scope {
  const latest = closed[0];
  return latest
    ? { mode: 'campaign', campaignId: latest.id }
    : { mode: 'period', period: DEFAULT_PERIOD, nature: 'all', custom: { from: null, to: null } };
}

const minusDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const minusMonths = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

export interface ResolvedRange {
  from: string | null;
  to: string | null;
  /** A custom pill with an incomplete pair — nothing to analyse yet. */
  incomplete: boolean;
}

/** Turn a period pill into the api's [from, to] window (inclusive, Tunis dates). */
export function resolveRange(
  scope: Extract<Scope, { mode: 'period' }>,
  todayIso: string = tunisTodayIso(),
): ResolvedRange {
  switch (scope.period) {
    case '30d':
      return { from: minusDays(todayIso, 30), to: todayIso, incomplete: false };
    case '90d':
      return { from: minusDays(todayIso, 90), to: todayIso, incomplete: false };
    case '12m':
      return { from: minusMonths(todayIso, 12), to: todayIso, incomplete: false };
    case 'all':
      return { from: null, to: null, incomplete: false };
    case 'custom': {
      const { from, to } = scope.custom;
      return from && to && from <= to
        ? { from, to, incomplete: false }
        : { from: null, to: null, incomplete: true };
    }
  }
}

/** US-6.5 — the context band's period wording (Period mode). */
export function periodLabel(scope: Extract<Scope, { mode: 'period' }>): string {
  let p: string;
  switch (scope.period) {
    case '30d':
      p = 'les 30 derniers jours';
      break;
    case '90d':
      p = 'les 90 derniers jours';
      break;
    case '12m':
      p = 'les 12 derniers mois';
      break;
    case 'all':
      p = 'depuis le début';
      break;
    case 'custom': {
      const { from, to } = scope.custom;
      p = `du ${from ? formatDateFr(from) : '…'} au ${to ? formatDateFr(to) : '…'}`;
      break;
    }
  }
  const nature =
    scope.nature === 'normal' ? ' · normales' : scope.nature === 'event' ? ' · événements' : '';
  return `la période : ${p}${nature}`;
}

/** « 3 campagnes » / « 1 campagne » / « 0 campagne ». */
export const campaignCountLabel = (n: number): string => `${n} campagne${n > 1 ? 's' : ''}`;

/** The clôture month for a campaign label — « Soldes d'été · Juillet 2026 ». */
export const campaignScopeLabel = (c: Pick<ClosedCampaignWire, 'name' | 'closed_on'>): string =>
  `${c.name} · ${monthLabelFr(c.closed_on.slice(0, 7))}`;

export const natureLabel = (nature: CampaignNature): string =>
  nature === 'event' ? 'Événement' : 'Normale';

export const natureBadge = (nature: CampaignNature): string =>
  nature === 'event' ? 'Campagne événement' : 'Campagne normale';
