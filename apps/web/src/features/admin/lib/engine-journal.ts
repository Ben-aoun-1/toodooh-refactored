import { tndLabel } from '@/lib/money';

// LOG1 — the « Journal du moteur » pure display model (node-env tests; no render harness).
// ONE French label map for every event the api emits; the coverage test pins the emitted set so a
// new emitter without a label fails CI, not the operator.

export interface EngineJournalEvent {
  event_type: string;
  screenhost_id: string | null;
  screenhost_name: string | null;
  payload: Record<string, unknown>;
}

export interface EngineJournalRun {
  run_id: string;
  phase: 'dispatch' | 'cascade' | 'redispatch' | 'settlement' | 'boost';
  outcome: 'committed' | 'rolled_back' | null;
  started_at: string;
  summary: Record<string, unknown>;
  events: EngineJournalEvent[];
}

export interface EngineJournal {
  campaign_id: string;
  total_runs: number;
  runs: EngineJournalRun[];
}

export type EnginePhaseFilter = EngineJournalRun['phase'] | 'all';

/** The api's emitted event set — grow this WITH the api (the coverage test pins it). */
export const EMITTED_EVENT_TYPES = [
  'venue_excluded',
  'pool_assembled',
  'allocation_placed',
  'reliquat_stored',
  'partial_coverage',
  'refusal_received',
  'replacement_placed',
  'manquement_detected',
  'redispatch_valued',
  'rattrapage_placed',
  'reliquat_consumed',
  'split_recorded',
  'refund_issued',
  'residue_kept',
  'perimeter_added',
  'prelaunch_frozen',
  'prelaunch_topup',
] as const;

export const EVENT_LABELS: Record<string, string> = {
  venue_excluded: 'Établissement exclu',
  pool_assembled: 'Pool assemblé',
  allocation_placed: 'Allocation placée',
  reliquat_stored: 'Reliquat stocké',
  partial_coverage: 'Couverture partielle',
  refusal_received: 'Refus reçu',
  replacement_placed: 'Replacement placé',
  manquement_detected: 'Manquement détecté',
  redispatch_valued: 'Manquements valorisés',
  rattrapage_placed: 'Rattrapage placé',
  reliquat_consumed: 'Reliquat consommé',
  split_recorded: 'Reversement enregistré',
  refund_issued: 'Remboursement émis',
  residue_kept: 'Résidu conservé (plateforme)',
  perimeter_added: 'Périmètre étendu',
  prelaunch_frozen: 'Lancement figé (prix final)',
  prelaunch_topup: 'Acceptation : reliquat replacé',
};

export const EXCLUSION_REASON_LABELS: Record<string, string> = {
  inactive: 'établissement inactif',
  // CAP-EVT1 (operator ruling 2026-09-22) — the pool no longer emits it (the capacity became the
  // event-only switch); kept so the journal rows written before still render.
  capacity_missing: 'capacité manquante',
  hours_missing: 'horaires manquants',
  targeting_mismatch: 'hors ciblage',
  zone_mismatch: 'hors zone',
  excluded: 'exclu de ce calcul',
  no_available_days: 'aucun jour disponible',
  no_residual_capacity: 'aucune capacité résiduelle',
  // ELIG-2 (operator ruling 2026-09-16) — the pool's first reason: the owner is not validated.
  owner_not_approved: 'propriétaire non validé',
  // MAP-TV1 (operator ruling 2026-09-21) — right after the owner: the venue has no installed TV.
  no_installed_screen: 'aucun écran installé',
  // TW-SNAP (operator ruling Q2 B, 2026-09-25) — absent from the week frozen at cart add.
  not_in_frozen_week: 'absent de la semaine type gelée',
  // DEMO-1 (operator ruling Q2 A, 2026-10-12) — a demo campaign airs only on the demo venues.
  not_demo_venue: 'hors des établissements de démo',
};

/** The refusal reasons a rolled-back run can carry (fallback: the raw reason). */
export const RUN_REASON_LABELS: Record<string, string> = {
  TOO_THIN: 'plan trop mince (N_min > N_max)',
  NO_ELIGIBLE: 'aucun établissement éligible',
  ERROR: 'erreur interne',
  INVALID_SPLIT_CONFIG: 'configuration de répartition invalide',
  NOT_FOUND: 'campagne introuvable',
  NOT_BOOSTABLE: 'campagne non boostable',
  NO_PLAN: 'aucun plan de diffusion',
  NO_FUTURE_WINDOW: 'aucune fenêtre future',
  BUDGET_BELOW_MINIMUM: 'budget sous le minimum',
  BUDGET_EXCEEDS_CMAX: 'budget au-delà du C_max',
  INSUFFICIENT_BALANCE: 'solde insuffisant',
};

export const PHASE_LABELS: Record<EngineJournalRun['phase'], string> = {
  dispatch: 'Dispatch',
  cascade: 'Cascade',
  redispatch: 'Redispatching',
  settlement: 'Règlement',
  boost: 'Boost',
};

export const ENGINE_JOURNAL_EMPTY_STATE = 'Aucune exécution du moteur pour cette campagne.';

/** The event's French label; venue_excluded composes its reason. Unknown types fall back raw. */
export const eventLabel = (event: EngineJournalEvent): string => {
  const base = EVENT_LABELS[event.event_type] ?? event.event_type;
  // Mariem 16/11 — a silence is not a refusal: the pre-launch withdrawals say so.
  if (event.event_type === 'refusal_received' && event.payload['noAnswer'] === true) {
    return event.payload['step'] === 'freeze'
      ? 'Sans réponse à H − 5 min : proposition retirée'
      : 'Sans réponse à H − 6 h : proposition retirée';
  }
  if (event.event_type === 'venue_excluded') {
    const reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : '';
    const reasonLabel = EXCLUSION_REASON_LABELS[reason] ?? reason;
    return reasonLabel ? `${base} — ${reasonLabel}` : base;
  }
  return base;
};

/** « Exécuté » / « Annulé — <raison> » — the run outcome chip. */
export const outcomeChip = (run: {
  outcome: string | null;
  summary: Record<string, unknown>;
}): string => {
  if (run.outcome === 'committed') return 'Exécuté';
  const reason = typeof run.summary['reason'] === 'string' ? run.summary['reason'] : '';
  const label = RUN_REASON_LABELS[reason] ?? reason;
  return label ? `Annulé — ${label}` : 'Annulé';
};

/**
 * The event's key payload figures as compact French text: impressions (fr-FR), plain montants
 * via the ONE money home. Only known keys render; internals (seq…) never do.
 */
export const eventDetail = (event: EngineJournalEvent): string => {
  const p = event.payload;
  const parts: string[] = [];
  if (typeof p['impressions'] === 'number') {
    parts.push(`${p['impressions'].toLocaleString('fr-FR')} imp.`);
  }
  const money = (key: string, prefix?: string): void => {
    if (typeof p[key] === 'number') {
      parts.push(`${prefix ? `${prefix} ` : ''}${tndLabel(p[key])}`);
    }
  };
  money('valueTnd');
  money('amountTnd');
  money('baseTnd', 'base');
  money('shTnd', 'part établissement');
  money('totalValueTnd', 'valeur');
  if (typeof p['poolSize'] === 'number') parts.push(`${p['poolSize']} établissement(s)`);
  if (typeof p['couvert'] === 'number' && typeof p['iCible'] === 'number') {
    parts.push(
      `${p['couvert'].toLocaleString('fr-FR')} / ${p['iCible'].toLocaleString('fr-FR')} imp.`,
    );
  }
  if (typeof p['slots'] === 'number') parts.push(`${p['slots']} créneau(x)`);
  if (typeof p['shortfall'] === 'number') {
    parts.push(`${Math.round(p['shortfall']).toLocaleString('fr-FR')} imp. non replacées`);
  }
  if (typeof p['venues'] === 'number') parts.push(`${p['venues']} établissement(s) au lancement`);
  return parts.join(' · ');
};

/** The run's chip: a pre-launch pass reads « Avant lancement », not « Cascade ». */
export const runLabel = (run: Pick<EngineJournalRun, 'phase' | 'summary'>): string =>
  run.phase === 'cascade' && run.summary['reason'] === 'prelaunch'
    ? 'Avant lancement'
    : PHASE_LABELS[run.phase];

/**
 * Mariem 16/11 — the hourly redispatch check that found nothing to re-place (nothing missed)
 * is not an action: hidden, so the journal shows only what the engine did.
 */
export const isIdleRun = (run: Pick<EngineJournalRun, 'phase' | 'summary'>): boolean =>
  run.phase === 'redispatch' &&
  run.summary['result'] === 'BELOW_THRESHOLD' &&
  run.summary['totalValueTnd'] === 0;

/** Horodatage in Africa/Tunis, fr-FR — independent of the operator's browser zone. */
export const formatTunis = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
