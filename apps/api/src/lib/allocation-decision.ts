import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type AllocationDecider,
  type DispatchAcceptation,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  screenhosts,
} from '../db/schema.js';

import { notifyAdmins } from './admin-notifications.js';
import { runRefusalCascade } from './dispatch/cascade.js';
import { topUpOnAcceptance } from './dispatch/tours/prelaunch-topup.js';
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
//
// Agent spec VF §10 + operator 2026-11-14 (« an acceptance should be final ») — the FIRST answer
// decides, whoever gives it (the Host, its agent, the admin for the Host): an ACCEPTE can no
// longer be turned into a REFUSE, and a second actor's answer is turned away even when it says
// the same thing (`already_answered`). The same actor repeating its own answer stays an
// idempotent no-op. The author is stored on the row (decided_by, migration 0109).

/** The 409 message of a second answer (spec §10, verbatim). */
export const OFFER_ALREADY_ANSWERED = 'Cette offre a déjà reçu une réponse';

export interface DecisionActor {
  kind: AllocationDecider;
  /** The user who answers (the agent, the admin); the owner's own id for the Host. */
  userId: string | null;
}

export type AllocationDecisionOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_final' }
  /** Someone already answered (an acceptance is final; a second actor never overrides). */
  | { kind: 'already_answered'; statut: DispatchAcceptation; by: AllocationDecider | null }
  | {
      kind: 'ok';
      id: string;
      statut: DispatchAcceptation;
      screenhostId: string;
      campaignId: string;
      campaignName: string;
      changed: boolean;
    };

const statutIsAcceptance = (s: DispatchAcceptation): boolean => s === 'ACCEPTE';

export const decideAllocation = async (input: {
  allocationId: string;
  ownerId: string;
  statut: DispatchAcceptation;
  /** Who answers; the Host itself when omitted. */
  actor?: DecisionActor;
  now?: Date;
}): Promise<AllocationDecisionOutcome> => {
  const { allocationId, ownerId, statut } = input;
  const actor: DecisionActor = input.actor ?? { kind: 'owner', userId: ownerId };
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
      // DISP-TOURS Q1 — a reservation is not proposed until its spot is validated: nothing to
      // decide (indistinguishable from a missing one).
      if (current === 'RESERVE') return { kind: 'not_found' };
      // A row answered before migration 0109 carries no author: it is the Host's.
      const by = row.allocation.decidedBy ?? (current === 'EN_ATTENTE' ? null : 'owner');
      if (current !== 'EN_ATTENTE' && by !== actor.kind) {
        return { kind: 'already_answered', statut: current, by };
      }
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
      if (current === 'ACCEPTE') return { kind: 'already_answered', statut: current, by };

      await tx
        .update(campaignDispatchAllocation)
        .set({
          statutAcceptation: statut,
          decidedBy: actor.kind,
          decidedByUserId: actor.userId,
          decidedAt: input.now ?? new Date(),
        })
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
      // Operator ruling 16/11 (A) — an acceptance before the freeze takes back what a refusal or a
      // withdrawal left unplaced (./dispatch/tours/prelaunch-topup.ts).
      if (
        statut === 'ACCEPTE' &&
        (row.campaignStatus === 'upcoming' || row.campaignStatus === 'active') &&
        row.campaignStart !== null &&
        row.campaignEnd !== null
      ) {
        const trace = createEngineTrace('cascade', row.campaignId);
        const placed = await topUpOnAcceptance(
          tx,
          {
            plan: row.plan,
            campaign: {
              id: row.campaignId,
              name: row.campaignName,
              startDate: row.campaignStart,
              endDate: row.campaignEnd,
            },
            ...(input.now ? { now: input.now } : {}),
          },
          trace,
        );
        if (placed) cascadeTrace.current = trace;
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
  if (cascadeTrace.current) {
    await cascadeTrace.current.finish(
      'committed',
      statutIsAcceptance(input.statut) ? { reason: 'prelaunch' } : {},
    );
  }
  return outcome;
};
