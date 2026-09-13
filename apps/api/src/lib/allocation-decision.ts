import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type DispatchAcceptation,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  screenhosts,
} from '../db/schema.js';

import { notifyAdmins } from './admin-notifications.js';
import { runRefusalCascade } from './dispatch/cascade.js';
import { createEngineTrace } from './engine-journal/trace.js';

// ONE home for « the owner answers a proposal » (extracted verbatim from
// routes/screenhosts.ts's decideAllocation at SIM-2, 2026-09-13, so the simulator's owner
// emulator drives the SAME transaction the product route does — a copy would drift and the
// simulator would then be testing the copy).
//
// Owner-scoping is enforced IN the statement (the allocation must belong to a venue this user
// owns), the row is taken FOR UPDATE, a REFUSE is definitive, and a refusal on a campaign that
// has not started yet runs the E3 cascade in the same transaction. What stays with the caller:
// the HTTP mapping, the post-commit SPS recompute and the playlist re-push.

export type AllocationDecisionOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_final' }
  | {
      kind: 'ok';
      id: string;
      statut: DispatchAcceptation;
      screenhostId: string;
      campaignId: string;
      campaignName: string;
      changed: boolean;
    };

export const decideAllocation = async (input: {
  allocationId: string;
  ownerId: string;
  statut: DispatchAcceptation;
}): Promise<AllocationDecisionOutcome> => {
  const { allocationId, ownerId, statut } = input;
  const cascadeTrace: { current: ReturnType<typeof createEngineTrace> | null } = { current: null };
  const outcome = await db
    .transaction(async (tx): Promise<AllocationDecisionOutcome> => {
      const [row] = await tx
        .select({
          allocation: campaignDispatchAllocation,
          plan: campaignDispatchPlan,
          campaignId: campaigns.id,
          campaignName: campaigns.name,
          campaignStatus: campaigns.status,
          campaignStart: campaigns.startDate,
          campaignEnd: campaigns.endDate,
        })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id),
        )
        .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
        .where(
          and(
            eq(campaignDispatchAllocation.id, allocationId),
            inArray(
              campaignDispatchAllocation.screenhostId,
              tx
                .select({ id: screenhosts.id })
                .from(screenhosts)
                .where(eq(screenhosts.ownerId, ownerId)),
            ),
          ),
        )
        .limit(1)
        .for('update', { of: campaignDispatchAllocation });
      if (!row) return { kind: 'not_found' };

      const current = row.allocation.statutAcceptation;
      if (current === statut) {
        return {
          kind: 'ok',
          id: row.allocation.id,
          statut,
          screenhostId: row.allocation.screenhostId,
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          changed: false,
        };
      }
      if (current === 'REFUSE') return { kind: 'refused_final' };

      await tx
        .update(campaignDispatchAllocation)
        .set({ statutAcceptation: statut })
        .where(eq(campaignDispatchAllocation.id, row.allocation.id));

      if (
        statut === 'REFUSE' &&
        (row.campaignStatus === 'pending' || row.campaignStatus === 'upcoming') &&
        row.campaignStart !== null &&
        row.campaignEnd !== null
      ) {
        cascadeTrace.current = createEngineTrace('cascade', row.campaignId);
        const cascade = await runRefusalCascade(
          tx,
          {
            plan: row.plan,
            campaign: {
              id: row.campaignId,
              name: row.campaignName,
              startDate: row.campaignStart,
              endDate: row.campaignEnd,
            },
            refused: {
              id: row.allocation.id,
              screenhostId: row.allocation.screenhostId,
              iiPotentiel: row.allocation.iiPotentiel,
            },
          },
          cascadeTrace.current,
        );
        if (cascade.absorbed < cascade.v) {
          await notifyAdmins(tx, {
            type: 'admin_allocation_refused',
            title: 'Diffusion refusée non replacée',
            body: `Un établissement a refusé la campagne « ${row.campaignName} » et ${
              cascade.v - cascade.absorbed
            } impressions n'ont pas pu être replacées.`,
            campaignId: row.campaignId,
          });
        }
      }
      return {
        kind: 'ok',
        id: row.allocation.id,
        statut,
        screenhostId: row.allocation.screenhostId,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        changed: true,
      };
    })
    .catch(async (err: unknown) => {
      await cascadeTrace.current?.finish('rolled_back', { reason: 'ERROR' });
      throw err;
    });
  if (cascadeTrace.current) await cascadeTrace.current.finish('committed', {});
  return outcome;
};
