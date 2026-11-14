import { eq } from 'drizzle-orm';

import { campaigns } from '../../../db/schema.js';
import { type DbExecutor } from '../pool.js';

import { type OrdreRedistribution } from './redistribuer.js';

/**
 * Mariem 13/11 — the order a refused share is re-placed in, from the campaign's moment: during
 * the campaign (active) R14's order; before its start, new Hosts first — unless the start − 5 min
 * freeze has passed, after which only the Hosts that accepted take it (no new one could answer).
 */
export const prelaunchOrdre = async (
  tx: DbExecutor,
  campaignId: string,
): Promise<OrdreRedistribution> => {
  const [row] = await tx
    .select({ status: campaigns.status, frozenAt: campaigns.prelaunchFrozenAt })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row || row.status === 'active' || row.status === 'completed') return 'engages_dabord';
  return row.frozenAt !== null ? 'engages_seuls' : 'nouveaux_dabord';
};
