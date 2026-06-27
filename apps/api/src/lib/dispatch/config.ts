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
  if (!row) return { ...DISPATCH_CONFIG_DEFAULTS };
  return {
    seuilDiffusable: row.seuilDiffusable,
    gMois: Number(row.gMois),
    joursActifs: row.joursActifs,
    rMinEfficace: row.rMinEfficace,
    fMaxSeconds: row.fMaxSeconds,
  };
};
