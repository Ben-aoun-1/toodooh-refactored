// E7 — the admin settlement breakdown's pure display model (node-env tests; no render harness).
// Labels are the charter-pinned French strings; the row order is the split order.

export interface AdminReversementLine {
  screenhost_id: string;
  screenhost_name: string;
  source: string;
  base_value_tnd: number;
  sh_amount_tnd: number;
  toodooh_amount_tnd: number;
  agent_sh_amount_tnd: number;
  agent_sc_amount_tnd: number;
  agent_sh_id: string | null;
  agent_sc_id: string | null;
  settled_at: string;
}

export interface AdminReversementTotals {
  base_value_tnd: number;
  sh_amount_tnd: number;
  toodooh_amount_tnd: number;
  agent_sh_amount_tnd: number;
  agent_sc_amount_tnd: number;
}

export interface AdminCampaignReversements {
  campaign_id: string;
  lines: AdminReversementLine[];
  totals: AdminReversementTotals;
}

export const REVERSEMENT_ROW_LABELS = {
  sh: 'Part établissement (50 %)',
  toodooh: 'Part Toodooh (44 %)',
  agentSh: 'Agent établissement (3 %)',
  agentSc: 'Agent commercial (3 %)',
} as const;

export interface ReversementDisplayRow {
  key: keyof typeof REVERSEMENT_ROW_LABELS;
  label: string;
  amountTnd: number;
}

/** The totals block's rows, in split order — Σ amounts ≡ the base (exact-sum by construction). */
export const reversementDisplayRows = (totals: AdminReversementTotals): ReversementDisplayRow[] => [
  { key: 'sh', label: REVERSEMENT_ROW_LABELS.sh, amountTnd: totals.sh_amount_tnd },
  { key: 'toodooh', label: REVERSEMENT_ROW_LABELS.toodooh, amountTnd: totals.toodooh_amount_tnd },
  {
    key: 'agentSh',
    label: REVERSEMENT_ROW_LABELS.agentSh,
    amountTnd: totals.agent_sh_amount_tnd,
  },
  {
    key: 'agentSc',
    label: REVERSEMENT_ROW_LABELS.agentSc,
    amountTnd: totals.agent_sc_amount_tnd,
  },
];
