import { db } from '../../db/client.js';
import { dispatchConfig } from '../../db/schema.js';

import { DISPATCH_CONFIG_DEFAULTS } from './thresholds.js';

export interface ResolvedDispatchConfig {
  seuilDiffusable: number;
  gMois: number;
  joursActifs: number;
  rMinEfficace: number;
  fMaxSeconds: number;
}

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
      }
    : { ...DISPATCH_CONFIG_DEFAULTS };
  // seuil_diffusable is the materiality divisor (N_max = ⌊I_cible/seuil⌋) and the no-crumb floor;
  // a non-positive value would silently disable both. Fail loud on misconfiguration.
  if (resolved.seuilDiffusable <= 0) {
    throw new Error('dispatch_config.seuil_diffusable must be > 0');
  }
  return resolved;
};
