import { formatImpressions } from '@/features/campaigns/lib/campaign-impressions';
import type { CampaignStatusId } from '@/features/campaigns/lib/campaign-status';
import type {
  ImpressionsEstimateRead,
  ImpressionsEstimateStatus,
} from '@/features/campaigns/services/campaigns.api';

// IMP-EST1 (ruled 2026-09-22, Q1 A · Q2 A · Q3 A) — « Impressions estimées » is the server's
// read-only DRY-RUN of the real dispatch over the live semaine type (GET /:id/impressions-estimate:
// PHYSICAL impressions, what « prédites » would read if the campaign were dispatched now). The
// retired ⌊budget × 1000 ÷ CPM⌋ is gone. The ONE view rule every surface renders:
//   • loading (incl. the cursor still moving) → « … »
//   • a number                               → the fr grouped integer
//   • no estimate                            → « — » WITH its reason — never a fake 0.

export const ESTIMATE_LOADING_TEXT = '…';
export const ESTIMATE_NONE_TEXT = '—';

/** Why there is no estimate, one French line per server status. */
export const ESTIMATE_REASONS: Record<Exclude<ImpressionsEstimateStatus, 'ok'>, string> = {
  no_dates: 'Dates de diffusion à renseigner.',
  no_budget: 'Budget à renseigner.',
  budget_too_low: 'Budget trop faible pour une estimation.',
  no_creative: 'Spot à associer (sa durée compte dans l’estimation).',
  no_eligible: 'Aucun établissement éligible pour ce ciblage.',
  saturated: 'Inventaire saturé sur cette période.',
  too_thin: 'Inventaire trop mince pour diffuser ce budget.',
  event_cancelled: 'Cet événement est annulé.',
};
export const ESTIMATE_ERROR_REASON = 'Estimation indisponible pour le moment.';
/** A plan-less campaign that will never be dispatched as it stands (refusée, terminée…). */
export const ESTIMATE_NO_DISPATCH_REASON = 'Aucun plan de diffusion pour cette campagne.';

/**
 * The statuses a dry-run is asked for: the PRE-DISPATCH ones. A plan is frozen at activation
 * (api lib/activation-service), so every later status either carries its plan — the surface then
 * renders that, never an estimate — or never will (rejected). Two reasons to gate here and not
 * merely on « no plan yet »:
 *   • truth — « as if dispatched now » is a forecast, and a refused or closed campaign has no
 *     future to forecast; it renders « — » + the reason instead of a live number;
 *   • cost — each estimate is a full read-only assemblePool on the server (the /cmax class), and
 *     the list surfaces render one per row.
 */
export const PRE_DISPATCH_STATUSES: readonly CampaignStatusId[] = ['draft', 'pending', 'upcoming'];

export const isEstimableStatus = (status: string | null | undefined): boolean =>
  status !== null &&
  status !== undefined &&
  (PRE_DISPATCH_STATUSES as readonly string[]).includes(status);

export type EstimateView =
  | { kind: 'loading'; text: string; reason: null }
  | { kind: 'value'; text: string; reason: null; impressions: number }
  | { kind: 'none'; text: string; reason: string };

export interface EstimateQueryState {
  /** The campaign is past the dispatch (or refused): no dry-run is asked, and none would mean
   *  anything — « — » + the reason, never an « as if dispatched now » figure. */
  notEstimable?: boolean;
  /** The cursor holds no budget yet (the wizard's untouched budget): nothing to ask. */
  budgetUnset: boolean;
  /** No answer yet for the CURRENT inputs — the request in flight or the cursor still moving. */
  pending: boolean;
  isError: boolean;
  data: ImpressionsEstimateRead | undefined;
}

const none = (reason: string): EstimateView => ({ kind: 'none', text: ESTIMATE_NONE_TEXT, reason });

export const estimateView = (state: EstimateQueryState): EstimateView => {
  if (state.notEstimable === true) return none(ESTIMATE_NO_DISPATCH_REASON);
  if (state.budgetUnset) return none(ESTIMATE_REASONS.no_budget);
  if (state.pending) return { kind: 'loading', text: ESTIMATE_LOADING_TEXT, reason: null };
  const data = state.data;
  if (state.isError || data === undefined) return none(ESTIMATE_ERROR_REASON);
  if (data.status !== 'ok') return none(ESTIMATE_REASONS[data.status]);
  if (data.impressions === null) return none(ESTIMATE_ERROR_REASON);
  return {
    kind: 'value',
    text: formatImpressions(data.impressions),
    reason: null,
    impressions: data.impressions,
  };
};

/** What moves the estimate server-side — the query key carries its signature. */
export interface EstimateInputs {
  startDate?: string | null;
  endDate?: string | null;
  /** One entry per targeting line (any stable per-line string). */
  targeting?: readonly string[];
  /** The selected zones (ids or names). */
  zones?: readonly string[];
  creativeId?: string | null;
  creativeDurationSeconds?: number | null;
  /** The stored budget when the estimate is sized on it (no cursor). */
  storedBudget?: number | null;
  /** Anything else (e.g. the positioned event). */
  extra?: string | null;
}

/** A stable signature: line and zone ORDER never changes it, any value does. */
export const estimateInputsKey = (inputs: EstimateInputs): string =>
  JSON.stringify([
    inputs.startDate ?? null,
    inputs.endDate ?? null,
    [...(inputs.targeting ?? [])].sort(),
    [...(inputs.zones ?? [])].sort(),
    inputs.creativeId ?? null,
    inputs.creativeDurationSeconds ?? null,
    inputs.storedBudget ?? null,
    inputs.extra ?? null,
  ]);
