import { db } from '../../db/client.js';
import { dispatchConfig } from '../../db/schema.js';

import { DISPATCH_CONFIG_DEFAULTS } from './thresholds.js';

export interface ResolvedDispatchConfig {
  seuilDiffusable: number;
  gMois: number;
  joursActifs: number;
  rMinEfficace: number;
  fMaxSeconds: number;
  // Admin-editable CPM (TND/1000) — prices campaigns CREATED from now on (CPM-1): a new campaign
  // row captures both at insert; an existing one reads its own copy (campaignCpmRates).
  standardCpmTnd: number;
  eventCpmTnd: number;
  // E1 (VF) — the attention index T by spot-duration bucket (tForDuration reads these).
  t10s: number;
  t20s: number;
  t30s: number;
  // CF-D1 — the campaign start-date lead in working days (the calibratable J+2 floor).
  campaignLeadWorkingDays: number;
  // E7 (VF EPIC 5) — the reversement split percentages (50/44/3/3 canonical; Σ = 100 validated
  // by the rail at split time).
  pctSh: number;
  pctToodooh: number;
  pctAgentSh: number;
  pctAgentSc: number;
  // FCT1 — Toodooh's bank coordinates ('—' = not provisioned; SQL-settable, never code).
  bankRib: string;
  bankIban: string;
  bankBic: string;
  bankDomiciliation: string;
  // E4 — the SPS weights (Σ = 100, enforced at the admin config-edit path).
  spsWeightAcceptation: number;
  spsWeightRespectEvenements: number;
  spsWeightActivite: number;
  spsWeightRemplissage: number;
}

export interface CpmRates {
  standardCpmTnd: number;
  eventCpmTnd: number;
}

// The CPM (TND/1000) a campaign prices at: event campaigns at event_cpm_tnd, everything else at
// standard_cpm_tnd (operator ruling 15/30). ONE home (E5) — the activation derivation
// (lib/activation-service.ts) and the C_max ceiling (lib/campaign-cmax.ts) must price identically.
// CPM-1 — for a campaign that EXISTS, `cfg` is campaignCpmRates(row), never getDispatchConfig():
// the live config only prices what has not been created yet.
export const cpmForCampaign = (campaignType: string, cfg: CpmRates): number =>
  campaignType === 'event' ? cfg.eventCpmTnd : cfg.standardCpmTnd;

// CPM-1 (user rule, 2026-09-17) — THE read home for an existing campaign's CPMs: the rates in
// effect when the row was created (campaigns.standard_cpm_tnd / event_cpm_tnd, captured by the
// migration-0074 column default). An admin CPM change never reaches them. Numeric columns arrive
// as strings; a query that prices a campaign must SELECT both columns.
export const campaignCpmRates = (row: {
  standardCpmTnd: string;
  eventCpmTnd: string;
}): CpmRates => ({
  standardCpmTnd: Number(row.standardCpmTnd),
  eventCpmTnd: Number(row.eventCpmTnd),
});

// Read the singleton dispatch config (numeric columns come back as strings → coerce to numbers).
// Falls back to the V1 defaults when no row exists, so dispatch always has a coherent config.
export const getDispatchConfig = async (): Promise<ResolvedDispatchConfig> => {
  const [row] = await db.select().from(dispatchConfig).limit(1);
  const resolved: ResolvedDispatchConfig = row
    ? {
        seuilDiffusable: row.seuilDiffusable,
        gMois: Number(row.gMois),
        joursActifs: row.joursActifs,
        rMinEfficace: row.rMinEfficace,
        fMaxSeconds: row.fMaxSeconds,
        standardCpmTnd: Number(row.standardCpmTnd),
        eventCpmTnd: Number(row.eventCpmTnd),
        t10s: Number(row.t10s),
        t20s: Number(row.t20s),
        t30s: Number(row.t30s),
        campaignLeadWorkingDays: row.campaignLeadWorkingDays,
        pctSh: Number(row.pctSh),
        pctToodooh: Number(row.pctToodooh),
        pctAgentSh: Number(row.pctAgentSh),
        pctAgentSc: Number(row.pctAgentSc),
        bankRib: row.bankRib,
        bankIban: row.bankIban,
        bankBic: row.bankBic,
        bankDomiciliation: row.bankDomiciliation,
        spsWeightAcceptation: Number(row.spsWeightAcceptation),
        spsWeightRespectEvenements: Number(row.spsWeightRespectEvenements),
        spsWeightActivite: Number(row.spsWeightActivite),
        spsWeightRemplissage: Number(row.spsWeightRemplissage),
      }
    : { ...DISPATCH_CONFIG_DEFAULTS };
  // SUPERSEDED on the dispatch path (E3, Mariem 2026-07-15): the materiality divisor and no-crumb
  // floor are now the VALUE-based seuilImpressions(cpm). This value no longer feeds dispatch — it
  // stays validated for the admin config surface (removal banked).
  if (resolved.seuilDiffusable <= 0) {
    throw new Error('dispatch_config.seuil_diffusable must be > 0');
  }
  return resolved;
};
