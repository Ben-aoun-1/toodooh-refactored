// SIM-6 phase 2 — the simulator's campaign inspector: the wire shape of
// GET /api/admin/simulations/:id/campaigns/:campaignId/inspect and the pure French renderings the
// page shows (no render harness in apps/web: the rules live here, the TSX only lays them out).

export interface InspectionAllocation {
  allocation_id: string;
  venue: string;
  screenhost_id: string;
  statut: string;
  r_i: number;
  share: number;
  revenu_tnd: number | null;
  creneaux: number;
  first: string | null;
  last: string | null;
  delivered_slots: number;
}

export interface InspectionEventPlacement {
  allocation_id: string;
  venue: string;
  screenhost_id: string;
  statut: string;
  blocs: { start: string; end: string }[];
  impressions: number;
  montant_tnd: number;
}

export interface InspectionRun {
  run_id: string;
  phase: string;
  outcome: string | null;
  started_at: string;
  summary: Record<string, unknown>;
  events: {
    event_type: string;
    screenhost_id: string | null;
    screenhost_name: string | null;
    payload: Record<string, unknown>;
  }[];
}

export interface CampaignInspection {
  campaign: {
    id: string;
    name: string;
    status: string;
    kind: 'standard' | 'event';
    start_date: string | null;
    end_date: string | null;
    budget_tnd: number | null;
    spot_seconds: number | null;
  };
  pricing: {
    c_max_tnd: number | null;
    objectif: number | null;
    estimate: {
      status: string;
      impressions?: number;
      objectif?: number | null;
      venuesCount?: number;
    };
    campaign_rates: {
      standard_cpm_tnd: number;
      event_cpm_tnd: number;
      t10s: number;
      t20s: number;
      t30s: number;
    };
    config: {
      f_max_seconds: number;
      r_min_efficace: number;
      seuil_diffusable: number;
      g_mois: number;
      jours_actifs: number;
    };
  };
  plan: {
    i_cible: number;
    cpm: number;
    s: number;
    t: number;
    f_max_seconds: number;
    seuil: number;
    couvert: number;
    n_min: number;
    n_max: number;
    n_retenus: number;
    reliquat_stocke: number;
    is_partial: boolean;
    is_too_thin: boolean;
    dispatched_at: string;
    allocations: InspectionAllocation[];
  } | null;
  event_placement: InspectionEventPlacement[] | null;
  redispatch: {
    at: string;
    missed_fact: number;
    placed_fact: number;
    reliquat_consumed_fact: number;
    residual_fact: number;
  }[];
  journal: InspectionRun[];
  settlement: {
    status: string;
    spend_tnd: number;
    refund_tnd: number;
    expected_imp: number;
    delivered_imp: number;
    settled_at: string;
    payouts: { venue: string; expected_imp: number; delivered_imp: number; earnings_tnd: number }[];
    reversement: {
      venue: string;
      base_tnd: number;
      sh_tnd: number;
      toodooh_tnd: number;
      agent_sh_tnd: number;
      agent_sc_tnd: number;
    }[];
    event_delivery:
      | {
          venue: string;
          blocs_delivered: number;
          delivered_tnd: number;
          refund_tnd: number;
          attestation_negated: boolean;
        }[]
      | null;
  } | null;
}

export const PHASE_LABEL: Record<string, string> = {
  dispatch: 'Dispatch',
  cascade: 'Cascade (refus)',
  redispatch: 'Rattrapage',
  settlement: 'Règlement',
  boost: 'Boost',
};

const tnd = (n: number): string => `${n.toLocaleString('fr-FR')} TND`;

/** The engine's own verdicts, in words (unknown codes fall through verbatim). */
const RESULT_LABEL: Record<string, string> = {
  BELOW_THRESHOLD: 'sous le seuil de 20 TND',
  NOTHING_PLACEABLE: 'aucun établissement ne peut reprendre le volume',
  PLACED: 'volume replacé',
  NO_FUTURE_WINDOW: 'plus de fenêtre à venir',
  OK: 'réussi',
};

/** One line per engine run: its phase and what it decided. */
export const runLine = (run: InspectionRun): string => {
  const phase = PHASE_LABEL[run.phase] ?? run.phase;
  const result =
    (typeof run.summary['result'] === 'string' && run.summary['result']) ||
    (typeof run.summary['status'] === 'string' && run.summary['status']) ||
    run.outcome ||
    '';
  const words = RESULT_LABEL[result] ?? result;
  const loss = run.summary['totalValueTnd'];
  const lossText = typeof loss === 'number' && loss > 0 ? ` (perte ${tnd(loss)})` : '';
  return words ? `${phase} — ${words}${lossText}` : phase;
};

/** The settlement headline: what was debited, what was refunded. */
export const settlementLine = (s: NonNullable<CampaignInspection['settlement']>): string =>
  s.refund_tnd > 0
    ? `Débité ${tnd(s.spend_tnd)} · remboursé ${tnd(s.refund_tnd)}`
    : `Débité ${tnd(s.spend_tnd)} · diffusion intégralement assurée`;
