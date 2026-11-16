import { and, eq, ne } from 'drizzle-orm';

import {
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  campaignDispatchPlan,
} from '../../../db/schema.js';
import { NOOP_TRACE, type EngineTrace } from '../../engine-journal/trace.js';
import { type DbExecutor } from '../pool.js';

import { type PlacementOutcome, placerToursIncrement } from './placer.js';
import { prelaunchOrdre } from './prelaunch-ordre.js';

// Operator ruling 16/11 (A) — before the start, a share a refusal or a withdrawal could not place
// is not lost at once: until start − 5 min (the freeze), each Host that ACCEPTS is topped up from
// it, up to its free hours (« Bonne nouvelle » notice). What is still unplaced at the freeze leaves
// the price, as before (lib/campaign-prelaunch.ts).
//
// No stored counter: the share still to place IS what the launch sold (the frozen detail's
// iAlloue) minus what the Hosts that did not refuse hold now — every refusal removes its share,
// every placement adds to a Host. The plan row is locked so two answers never place it twice.

/** The qualified impressions sold at the launch that no Host holds any more (≥ 0). */
export const prelaunchOutstanding = async (
  tx: DbExecutor,
  plan: Pick<CampaignDispatchPlan, 'id' | 'detail'>,
): Promise<number> => {
  const sold = plan.detail?.iAlloue ?? 0;
  if (sold <= 0) return 0;
  const rows = await tx
    .select({ ii: campaignDispatchAllocation.iiPotentiel })
    .from(campaignDispatchAllocation)
    .where(
      and(
        eq(campaignDispatchAllocation.planId, plan.id),
        ne(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  const held = rows.reduce((sum, r) => sum + r.ii, 0);
  return Math.max(0, sold - held);
};

/** Below one impression nothing is worth placing (whole-impression rounding of the créneaux). */
const MIN_TOPUP = 1;

export const topUpOnAcceptance = async (
  tx: DbExecutor,
  input: {
    plan: CampaignDispatchPlan;
    campaign: { id: string; name: string; startDate: string; endDate: string };
    now?: Date;
  },
  trace: EngineTrace = NOOP_TRACE,
): Promise<PlacementOutcome | null> => {
  const { plan, campaign } = input;
  if (plan.engine !== 'tours' || !plan.detail) return null;
  // Only before the freeze: after it every answer is fixed and the price final.
  if ((await prelaunchOrdre(tx, campaign.id, input.now)) === 'engages_dabord') return null;
  await tx
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.id, plan.id))
    .for('update');
  const outstanding = await prelaunchOutstanding(tx, plan);
  if (outstanding < MIN_TOPUP) return null;
  const refusers = await tx
    .select({ screenhostId: campaignDispatchAllocation.screenhostId })
    .from(campaignDispatchAllocation)
    .where(
      and(
        eq(campaignDispatchAllocation.planId, plan.id),
        eq(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  trace.event('prelaunch_topup', { impressions: outstanding });
  const placed = await placerToursIncrement(
    tx,
    {
      plan,
      campaign,
      volumeFact: outstanding,
      excludeVenueIds: refusers.map((r) => r.screenhostId),
      now: input.now ?? new Date(),
      // Only the Hosts that accepted (the one answering included): the share is placed now.
      ordre: 'engages_seuls',
    },
    trace,
  );
  if (placed.nonPlaceFact > 0) {
    trace.event('partial_coverage', { shortfall: placed.nonPlaceFact, engine: 'tours' });
  }
  return placed;
};
