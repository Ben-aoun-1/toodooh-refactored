import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
} from '../db/schema.js';

import { notDemoCampaignSql } from './demo.js';
import { placerToursIncrement } from './dispatch/tours/placer.js';
import { createEngineTrace } from './engine-journal/trace.js';

// Mariem 13/11/2026 (« Changements à livrer avant le démarrage du test », point 2) — the two
// pre-launch steps of a classic campaign dispatched by the tours engine, run by a minute job:
//
//   • start − 6 h — THE LOCK. The Hosts that have not answered are removed (their proposal is
//     withdrawn) and their share is redispatched, FIRST to new Hosts (same peaks, 30 DT each, who
//     are told and must accept), the rest onto the Hosts that already accepted (accepted at once,
//     whatever the amount, told « Bonne nouvelle »). A refusal before the start re-places the same
//     way, at once (lib/dispatch/cascade.ts → ./dispatch/tours/prelaunch-ordre.ts).
//   • start − 5 min — THE FREEZE. The Hosts proposed after the lock that still have not answered
//     are removed too; a last redispatch puts their share onto the accepted Hosts only, and the
//     campaign starts with its price recalculated: what the accepted Hosts hold. Operator ruling
//     2026-11-14 (B = A): never above what the Screencaster launched — the engaged amount
//     (requested_budget) only ever goes DOWN to it. When the result differs from the launch, the
//     Screencaster is told.
//
// « The start » is the campaign's start date at 00:00, Tunis — the instant the lifecycle turns it
// active (the lock is 18:00 the day before, the freeze 23:55). Demo campaigns, v1 plans, event
// positionings and campaigns whose spot still awaits its validation (pending) are left alone.
// Each step stamps its column (migration 0108), so it runs once; both run in one transaction per
// campaign, under the plan's FOR UPDATE lock (the cascade / E6 idiom).

export const PRELAUNCH_LOCK_LEAD_MS = 6 * 60 * 60 * 1000;
export const PRELAUNCH_FREEZE_LEAD_MS = 5 * 60 * 1000;

/** The start instant of a campaign: its start date at 00:00 in Tunis (UTC+1, no DST). */
export const campaignStartInstant = (startDate: string): Date =>
  new Date(`${startDate}T00:00:00+01:00`);

export type PrelaunchStep = 'lock' | 'freeze' | null;

/** Which step is due now (pure): the freeze wins when both are late. */
export const prelaunchStepDue = (
  startDate: string,
  stamps: { lockedAt: Date | null; frozenAt: Date | null },
  now: Date,
): PrelaunchStep => {
  if (stamps.frozenAt !== null) return null;
  const start = campaignStartInstant(startDate).getTime();
  const t = now.getTime();
  if (t >= start - PRELAUNCH_FREEZE_LEAD_MS) return 'freeze';
  if (t >= start - PRELAUNCH_LOCK_LEAD_MS && stamps.lockedAt === null) return 'lock';
  return null;
};

/** The Screencaster's notice when the campaign starts differently from its launch (French). */
export const prelaunchFinalNotice = (input: {
  name: string;
  impressions: number;
  venues: number;
  amountTnd: number;
}): { title: string; body: string } => ({
  title: 'Votre campagne démarre dans quelques minutes',
  body: `Votre campagne ${input.name} démarre dans quelques minutes. Nous vous offrons finalement ${input.impressions.toLocaleString('fr-FR')} impressions dans ${input.venues} établissement${input.venues > 1 ? 's' : ''}, pour un montant de ${input.amountTnd.toFixed(2).replace('.', ',')} DT.`,
});

export interface PrelaunchOutcome {
  campaignId: string;
  step: 'lock' | 'freeze';
  removed: number;
  volumeFact: number;
  placedFact: number;
  /** freeze only: the recalculated figures, and whether the Screencaster was told. */
  final?: { impressions: number; venues: number; amountTnd: number; told: boolean };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const runStep = async (
  campaignId: string,
  now: Date,
  log?: FastifyBaseLogger,
): Promise<PrelaunchOutcome | null> => {
  const trace = createEngineTrace('cascade', campaignId);
  const outcome = await db
    .transaction(async (tx): Promise<PrelaunchOutcome | null> => {
      const [row] = await tx
        .select({ plan: campaignDispatchPlan, campaign: campaigns })
        .from(campaignDispatchPlan)
        .innerJoin(campaigns, eq(campaignDispatchPlan.campaignId, campaigns.id))
        .where(eq(campaignDispatchPlan.campaignId, campaignId))
        .limit(1)
        .for('update', { of: campaignDispatchPlan });
      if (!row) return null;
      const { plan, campaign } = row;
      if (campaign.status !== 'upcoming' || !campaign.startDate || !campaign.endDate) return null;
      const step = prelaunchStepDue(
        campaign.startDate,
        { lockedAt: campaign.prelaunchLockedAt, frozenAt: campaign.prelaunchFrozenAt },
        now,
      );
      if (step === null) return null;

      const allocations = await tx
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan.id));
      const silent = allocations.filter((a) => a.statutAcceptation === 'EN_ATTENTE');
      const volumeFact = silent.reduce((sum, a) => sum + a.iiPotentiel, 0);
      for (const a of silent) {
        await tx.delete(campaignDispatchAllocation).where(eq(campaignDispatchAllocation.id, a.id));
        trace.event(
          'refusal_received',
          { impressions: a.iiPotentiel, noAnswer: true },
          a.screenhostId,
        );
      }
      const exclude = [
        ...silent.map((a) => a.screenhostId),
        ...allocations.filter((a) => a.statutAcceptation === 'REFUSE').map((a) => a.screenhostId),
      ];
      const placed =
        volumeFact > 0
          ? await placerToursIncrement(
              tx,
              {
                plan,
                campaign: {
                  id: campaign.id,
                  name: campaign.name,
                  startDate: campaign.startDate,
                  endDate: campaign.endDate,
                },
                volumeFact,
                excludeVenueIds: exclude,
                now,
                ordre: step === 'freeze' ? 'engages_seuls' : 'nouveaux_dabord',
              },
              trace,
            )
          : { placedFact: 0, nonPlaceFact: 0, placedTo: [] };

      if (step === 'lock') {
        await tx
          .update(campaigns)
          .set({ prelaunchLockedAt: now })
          .where(eq(campaigns.id, campaign.id));
        return {
          campaignId,
          step,
          removed: silent.length,
          volumeFact,
          placedFact: placed.placedFact,
        };
      }

      // THE FREEZE — the campaign starts with what its accepted Hosts hold.
      const accepted = (
        await tx
          .select()
          .from(campaignDispatchAllocation)
          .where(eq(campaignDispatchAllocation.planId, plan.id))
      ).filter((a) => a.statutAcceptation === 'ACCEPTE');
      const impressions = accepted.reduce((sum, a) => sum + a.iiPotentiel, 0);
      const launchedTnd = Number(campaign.requestedBudget ?? 0);
      const amountTnd = Math.min(
        launchedTnd,
        round2(accepted.reduce((sum, a) => sum + Number(a.revenuPrevisionnel), 0)),
      );
      const differs =
        amountTnd < launchedTnd - 0.005 ||
        accepted.length !== plan.nRetenus ||
        Math.abs(impressions - plan.couvert) >= 1;
      await tx
        .update(campaigns)
        .set({
          prelaunchFrozenAt: now,
          prelaunchLockedAt: campaign.prelaunchLockedAt ?? now,
          ...(amountTnd < launchedTnd - 0.005 ? { requestedBudget: amountTnd.toFixed(2) } : {}),
        })
        .where(eq(campaigns.id, campaign.id));
      if (differs) {
        await tx.insert(notifications).values({
          userId: campaign.advertiserId,
          type: 'campaign_prelaunch_final',
          ...prelaunchFinalNotice({
            name: campaign.name,
            impressions,
            venues: accepted.length,
            amountTnd,
          }),
          campaignId: campaign.id,
        });
      }
      trace.event('prelaunch_frozen', {
        impressions,
        venues: accepted.length,
        amountTnd,
        launchedTnd,
      });
      return {
        campaignId,
        step,
        removed: silent.length,
        volumeFact,
        placedFact: placed.placedFact,
        final: { impressions, venues: accepted.length, amountTnd, told: differs },
      };
    })
    .catch(async (err: unknown) => {
      await trace.finish('rolled_back', { reason: 'ERROR' });
      throw err;
    });
  // LOG1 — journal a step that ran (nothing due = nothing to journal).
  if (outcome) {
    await trace.finish('committed', { reason: `prelaunch_${outcome.step}` });
    log?.info(outcome, 'campaign pre-launch step');
  }
  return outcome;
};

/** One pass over every upcoming tours campaign whose lock or freeze is due. */
export const runCampaignPrelaunchTick = async (
  now: Date = new Date(),
  log?: FastifyBaseLogger,
): Promise<PrelaunchOutcome[]> => {
  const candidates = await db
    .select({
      id: campaigns.id,
      startDate: campaigns.startDate,
      lockedAt: campaigns.prelaunchLockedAt,
      frozenAt: campaigns.prelaunchFrozenAt,
    })
    .from(campaigns)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(
      and(
        eq(campaigns.status, 'upcoming'),
        isNull(campaigns.eventId),
        isNotNull(campaigns.startDate),
        isNull(campaigns.prelaunchFrozenAt),
        eq(campaignDispatchPlan.engine, 'tours'),
        notDemoCampaignSql(),
      ),
    );
  const outcomes: PrelaunchOutcome[] = [];
  for (const c of candidates) {
    if (!c.startDate || prelaunchStepDue(c.startDate, c, now) === null) continue;
    try {
      const outcome = await runStep(c.id, now, log);
      if (outcome) outcomes.push(outcome);
    } catch (err) {
      log?.warn({ err, campaignId: c.id }, 'campaign pre-launch step failed');
    }
  }
  return outcomes;
};

/** Boot tick + a 1-minute unref'd interval: the freeze lands within a minute of start − 5 min. */
export function startCampaignPrelaunchJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runCampaignPrelaunchTick(new Date(), log).catch((err: unknown) =>
      log.warn({ err }, 'campaign pre-launch tick failed'),
    );
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
}
