import { db } from '../../db/client.js';
import { dispatchConfig } from '../../db/schema.js';

import { DISPATCH_CONFIG_DEFAULTS } from './thresholds.js';

export interface ResolvedDispatchConfig {
  seuilDiffusable: number;
  gMois: number;
  joursActifs: number;
  rMinEfficace: number;
  fMaxSeconds: number;
  // Admin-editable CPM (TND/1000) — the activation derivation picks one by campaign type.
  standardCpmTnd: number;
  eventCpmTnd: number;
  // E1 (VF) — the attention index T by spot-duration bucket (tForDuration reads these).
  t10s: number;
  t20s: number;
  t30s: number;
  // CF-D1 — the campaign start-date lead in working days (the calibratable J+2 floor).
  campaignLeadWorkingDays: number;
}

// The CPM (TND/1000) a campaign prices at: event campaigns at event_cpm_tnd, everything else at
// standard_cpm_tnd (operator ruling 15/30). ONE home (E5) — the activation derivation
// (routes/admin-campaigns.ts) and the C_max ceiling (lib/campaign-cmax.ts) must price identically.
export const cpmForCampaign = (
  campaignType: string,
  cfg: { standardCpmTnd: number; eventCpmTnd: number },
): number => (campaignType === 'event' ? cfg.eventCpmTnd : cfg.standardCpmTnd);

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
