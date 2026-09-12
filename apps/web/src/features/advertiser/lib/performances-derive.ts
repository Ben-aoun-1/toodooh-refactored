import { htTtcLabel, ttcParenthetical } from '@/lib/money';

import type { ClosedCampaignWire, ShareWire } from '../services/performances.service';

import type { NatureFilter } from './performances-period';

/**
 * SC-P — pure derivations behind « Mes performances » (Screencaster). Every threshold the spec
 * leaves as an Annexe A hypothesis lives HERE as one named constant, so CF-9 can move it in one
 * place: Q5 pagination (10/page), Q7 CSP display (≥ 12 %), the « peu couverte » zone flag (< 5 %),
 * US-1.2's 3-card fold. Copy for the waiting states (US-3.2 / 4.3 / 5.2 / 6.6) is pinned here too
 * — simulator B is the visual authority and its sentences are reproduced verbatim.
 */

/** Q5 (hypothesis) — history rows per page. */
export const HISTORY_PAGE_SIZE = 10;
/** Q7 (hypothesis, from the maquette) — a CSP class is a campaign characteristic at ≥ 12 %. */
export const CSP_CHARACTERISTIC_MIN_PCT = 12;
/** Section 04 (hypothesis) — a zone is « peu couverte » under 5 % of the analysed impressions. */
export const ZONE_LOW_COVERAGE_PCT = 5;
/** US-1.2 — cards shown before « Voir plus (n) ». */
export const LIVE_FOLD = 3;

// ── waiting-state copy (simulator B, verbatim) ───────────────────────────────────────────

export const WAITING_TITLE = 'En attente de la clôture de votre première campagne.';
export const WAITING_LAST_REPORT =
  "Dès la clôture de votre première campagne, son rapport d'impact apparaîtra ici : impressions générées, établissements diffuseurs et heures de diffusion.";
export const WAITING_HISTORY =
  'Chaque campagne clôturée apparaîtra ici, consultable et téléchargeable.';
export const WAITING_FOOTPRINT =
  'Votre impact cumulé (impressions générées et heures de diffusion) apparaîtra ici dès la clôture de votre première campagne.';
export const WAITING_ANALYSIS =
  "Le filtre de génération et les sections d'analyse (vue d'ensemble, catégories de lieu, profil d'audience, zones géographiques) seront disponibles dès la clôture de votre première campagne.";
export const LIVE_EMPTY = 'Aucune campagne en cours pour le moment.';
export const HISTORY_NO_MATCH = 'Aucune campagne ne correspond à votre recherche.';
export const SELECTOR_EMPTY = 'Aucune campagne clôturée.';
export const PERIOD_EMPTY = 'Aucune campagne clôturée ne correspond à ce périmètre.';
/** US-9.2 (hypothesis) — the opportunities intro marks the bloc as generic pistes. */
export const OPPORTUNITIES_INTRO =
  "Quelques pistes pour renforcer l'impact de vos prochaines campagnes. Ce bloc est le même pour tous les Screencasters et reste affiché quel que soit le filtre sélectionné plus haut.";

/** US-9.1 — exactly three cards, this order, hardcoded (no data model). */
export const OPPORTUNITY_CARDS: readonly { title: string; body: string }[] = [
  {
    title: 'Échelle de campagne',
    body: 'Augmenter les impressions prévues pour élargir la portée.',
  },
  {
    title: 'Mix premium',
    body: "Combiner les tiers pour renforcer la disponibilité d'inventaire.",
  },
  {
    title: 'Qualité créative',
    body: 'Rafraîchir les créas sur les campagnes longues, simplifier le message, ajouter un QR code, renforcer la visibilité du logo dès les premières secondes.',
  },
];

// ── money (RG-PERF-30 — HT with the TTC in parentheses, the money.ts home) ───────────────

export const budgetLabel = (budgetHt: number): string => htTtcLabel(budgetHt);
export const budgetTtcNote = (budgetHt: number): string => ttcParenthetical(budgetHt);

// ── epic 1 — live fold ──────────────────────────────────────────────────────────────────

export function liveFold<T>(
  items: readonly T[],
  expanded: boolean,
): { visible: T[]; hidden: number } {
  if (expanded || items.length <= LIVE_FOLD) return { visible: [...items], hidden: 0 };
  return { visible: items.slice(0, LIVE_FOLD), hidden: items.length - LIVE_FOLD };
}

export const voirPlusLabel = (hidden: number): string => `Voir plus (${hidden})`;

// ── epic 4 — history search / filter / pagination ───────────────────────────────────────

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** RG-PERF-10 — search by name (accent/case-insensitive) + nature filter. */
export function filterHistory<T extends Pick<ClosedCampaignWire, 'name' | 'nature'>>(
  rows: readonly T[],
  query: string,
  nature: NatureFilter,
): T[] {
  const q = fold(query);
  return rows.filter(
    (r) => (nature === 'all' || r.nature === nature) && (q === '' || fold(r.name).includes(q)),
  );
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
}

/** Q5 — 10 rows per page; `page` is 1-based and clamped into range. */
export function paginate<T>(rows: readonly T[], page: number, size = HISTORY_PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  return {
    rows: rows.slice((current - 1) * size, current * size),
    page: current,
    pageCount,
    total: rows.length,
  };
}

/** The page a given campaign sits on (Consulter must land on a visible row). */
export function pageOf<T extends { id: string }>(
  rows: readonly T[],
  id: string,
  size = HISTORY_PAGE_SIZE,
): number | null {
  const idx = rows.findIndex((r) => r.id === id);
  return idx === -1 ? null : Math.floor(idx / size) + 1;
}

// ── epic 7 — thresholds ─────────────────────────────────────────────────────────────────

/** Q7 — the CSP classes listed as a campaign's characteristics (≥ 12 % of its impressions). */
export const cspCharacteristics = (shares: readonly ShareWire[]): string[] =>
  shares.filter((s) => s.pct >= CSP_CHARACTERISTIC_MIN_PCT).map((s) => s.label);

/** Section 04 — « peu couverte » under 5 %. */
export const isLowCoverage = (pct: number): boolean => pct < ZONE_LOW_COVERAGE_PCT;

/** Bar width relative to the largest value of the set (the simulator's fill rule). */
export function barWidthPct(value: number, rows: readonly { value: number }[]): number {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return max > 0 ? Math.round((value / max) * 100) : 0;
}

/** « — » when the list is empty (a campaign with no impressions has no characteristics). */
export const listOrDash = (items: readonly string[]): string =>
  items.length > 0 ? items.join(', ') : '—';

// ── epic 6 — the "waiting" decision ─────────────────────────────────────────────────────

export type ReadsState = 'loading' | 'error' | 'ready';

/** INV-1 idiom: nothing renders as data until every read settled; one error card, one retry. */
export function readsState(reads: readonly { pending: boolean; error: boolean }[]): ReadsState {
  if (reads.some((r) => r.error)) return 'error';
  if (reads.some((r) => r.pending)) return 'loading';
  return 'ready';
}

/** US-3.2 / 4.3 / 5.2 / 6.6 — the pre-first-clôture state: no closed campaign at all. */
export const awaitingFirstClosure = (closedCount: number): boolean => closedCount === 0;
