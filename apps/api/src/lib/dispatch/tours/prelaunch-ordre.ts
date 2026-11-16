import { eq } from 'drizzle-orm';

import { campaigns } from '../../../db/schema.js';
import { plusCalendarDays, tunisDateOf } from '../../campaign-dates.js';
import { type DbExecutor } from '../pool.js';

import { type OrdreRedistribution } from './redistribuer.js';

/**
 * The order a REFUSED share is re-placed in. Until the campaign's pre-launch is over
 * (prelaunch_frozen_at: every Host's answer fixed, lib/campaign-prelaunch.ts) — Mariem 16/11 —
 * the Hosts that accepted take it first, new Hosts the rest; each Host's own deadlines are
 * applied by the placer (./host-start.ts). Once it is over, R14's order (« comportement actuel
 * conservé »).
 */
export const prelaunchOrdre = async (
  tx: DbExecutor,
  campaignId: string,
  now: Date = new Date(),
): Promise<OrdreRedistribution> => {
  const [row] = await tx
    .select({
      status: campaigns.status,
      startDate: campaigns.startDate,
      frozenAt: campaigns.prelaunchFrozenAt,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!row || row.frozenAt !== null || row.startDate === null) return 'engages_dabord';
  if (row.status === 'upcoming') return 'acceptes_dabord';
  // Active since its start date: still before a late-opening Host's start that day (an
  // overnight venue opens the day after) — never a campaign that started earlier.
  return row.status === 'active' && row.startDate >= plusCalendarDays(tunisDateOf(now), -1)
    ? 'acceptes_dabord'
    : 'engages_dabord';
};
