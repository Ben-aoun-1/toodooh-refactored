import { and, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import { db } from '../db/client.js';
import {
  type CampaignDispatchAllocation,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  screenhosts,
} from '../db/schema.js';

import { plusCalendarDays, tunisDateOf } from './campaign-dates.js';
import { notDemoCampaignSql } from './demo.js';
import { hostFreezeInstant, hostLockInstant } from './dispatch/tours/host-start.js';
import { placerToursIncrement } from './dispatch/tours/placer.js';
import { createEngineTrace } from './engine-journal/trace.js';

// Mariem 13/11/2026 (« Changements à livrer avant le démarrage du test », point 2) — the
// pre-launch steps of a classic campaign dispatched by the tours engine, run by a minute job.
// Operator 2026-11-14: « each screenhost has their own start hour » — the campaign starts at a
// venue on its start date at THAT venue's opening hour (./dispatch/tours/host-start.ts), so both
// deadlines are per Host:
//
//   • the Host's start − 6 h — THE LOCK. Still no answer: the proposal is withdrawn and its share
//     redispatched, FIRST to new Hosts (same peaks, 30 DT each, told and asked to accept — never
//     one whose own freeze has passed), the rest onto the Hosts that already accepted (accepted at
//     once, whatever the amount, told « Bonne nouvelle »). A refusal before the start re-places the
//     same way, at once (lib/dispatch/cascade.ts → ./dispatch/tours/prelaunch-ordre.ts).
//   • the Host's start − 5 min — THE FREEZE. A Host proposed after its own lock that still has not
//     answered is withdrawn too, its share placed onto the Hosts that accepted only.
//   • THE PRICE — once no Host is left pending and the first Host's freeze has passed, the
//     campaign runs on its recalculated price: what the accepted Hosts hold. Operator ruling
//     2026-11-14 (B = A): never above what the Screencaster launched — the engaged amount
//     (requested_budget) only ever goes DOWN. When the result differs from the launch, the
//     Screencaster is told (Mariem's text).
//
// Demo campaigns, v1 plans, event positionings and campaigns whose spot still awaits its
// validation (pending) are left alone. One transaction per campaign, under the plan's FOR UPDATE
// lock (the cascade / E6 idiom). Idempotent: a withdrawn proposal is gone, the price is stamped.

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

/** What one Host's pending proposal owes now (pure): withdrawn at its lock, or at its freeze. */
export const hostPrelaunchStep = (
  startDate: string,
  openingHour: number | null,
  alloc: Pick<CampaignDispatchAllocation, 'statutAcceptation' | 'lateProposal' | 'createdAt'>,
  now: Date,
): 'lock' | 'freeze' | null => {
  if (alloc.statutAcceptation !== 'EN_ATTENTE') return null;
  if (now >= hostFreezeInstant(startDate, openingHour)) return 'freeze';
  const lock = hostLockInstant(startDate, openingHour);
  // Mariem 16/11 — a Host proposed after its own lock (a campaign launched the evening before,
  // a venue opening at midnight) had no 6 hours to answer: only the freeze withdraws it.
  const late = alloc.lateProposal || alloc.createdAt >= lock;
  if (!late && now >= lock) return 'lock';
  return null;
};

export interface PrelaunchOutcome {
  campaignId: string;
  locked: number;
  frozen: number;
  volumeFact: number;
  placedFact: number;
  /** When the price was recalculated this tick. */
  final?: { impressions: number; venues: number; amountTnd: number; told: boolean };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const runCampaign = async (
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
      if (
        (campaign.status !== 'upcoming' && campaign.status !== 'active') ||
        campaign.prelaunchFrozenAt !== null ||
        !campaign.startDate ||
        !campaign.endDate
      ) {
        return null;
      }
      const startDate = campaign.startDate;
      const window = { id: campaign.id, name: campaign.name, startDate, endDate: campaign.endDate };

      const loadAllocations = () =>
        tx
          .select({ a: campaignDispatchAllocation, openingHour: screenhosts.openingHour })
          .from(campaignDispatchAllocation)
          .innerJoin(screenhosts, eq(campaignDispatchAllocation.screenhostId, screenhosts.id))
          .where(eq(campaignDispatchAllocation.planId, plan.id));
      const allocations = await loadAllocations();
      const due = allocations.map((r) => ({
        ...r,
        step: hostPrelaunchStep(startDate, r.openingHour, r.a, now),
      }));
      const locked = due.filter((d) => d.step === 'lock');
      const frozen = due.filter((d) => d.step === 'freeze');
      // Mariem 16/11 — « il n'a fait aucune action »: the proposal is withdrawn but its row stays
      // (REFUSE; the engine journal records it as « Sans réponse ») so the admin can trace it and it is never proposed again.
      for (const d of [...locked, ...frozen]) {
        await tx
          .update(campaignDispatchAllocation)
          .set({ statutAcceptation: 'REFUSE' })
          .where(eq(campaignDispatchAllocation.id, d.a.id));
        trace.event(
          'refusal_received',
          { impressions: d.a.iiPotentiel, noAnswer: true, step: d.step },
          d.a.screenhostId,
        );
      }
      const exclude = [
        ...locked.map((d) => d.a.screenhostId),
        ...frozen.map((d) => d.a.screenhostId),
        ...allocations
          .filter((r) => r.a.statutAcceptation === 'REFUSE')
          .map((r) => r.a.screenhostId),
      ];
      const volumeOf = (rows: readonly { a: CampaignDispatchAllocation }[]) =>
        rows.reduce((sum, r) => sum + r.a.iiPotentiel, 0);
      let placedFact = 0;
      // The frozen Hosts' share first, onto the accepted ones only (it cannot wait for anyone).
      if (volumeOf(frozen) > 0) {
        const placed = await placerToursIncrement(
          tx,
          {
            plan,
            campaign: window,
            volumeFact: volumeOf(frozen),
            excludeVenueIds: exclude,
            now,
            ordre: 'engages_seuls',
          },
          trace,
        );
        placedFact += placed.placedFact;
      }
      if (volumeOf(locked) > 0) {
        const placed = await placerToursIncrement(
          tx,
          {
            plan,
            campaign: window,
            volumeFact: volumeOf(locked),
            excludeVenueIds: exclude,
            now,
            ordre: 'nouveaux_dabord',
          },
          trace,
        );
        placedFact += placed.placedFact;
      }

      // THE PRICE — every answer fixed and the campaign starting at its first Host.
      const after = await loadAllocations();
      const firstFreeze = Math.min(
        ...allocations.map((r) => hostFreezeInstant(startDate, r.openingHour).getTime()),
      );
      const settled =
        now.getTime() >= firstFreeze && after.every((r) => r.a.statutAcceptation !== 'EN_ATTENTE');
      let final: PrelaunchOutcome['final'];
      if (settled) {
        const accepted = after.filter((r) => r.a.statutAcceptation === 'ACCEPTE').map((r) => r.a);
        const impressions = accepted.reduce((sum, a) => sum + a.iiPotentiel, 0);
        const launchedTnd = Number(campaign.requestedBudget ?? 0);
        const amountTnd = Math.min(
          launchedTnd,
          round2(accepted.reduce((sum, a) => sum + Number(a.revenuPrevisionnel), 0)),
        );
        const lowered = amountTnd < launchedTnd - 0.005;
        const told =
          lowered || accepted.length !== plan.nRetenus || Math.abs(impressions - plan.couvert) >= 1;
        await tx
          .update(campaigns)
          .set({
            prelaunchFrozenAt: now,
            ...(lowered ? { requestedBudget: amountTnd.toFixed(2) } : {}),
          })
          .where(eq(campaigns.id, campaign.id));
        if (told) {
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
        final = { impressions, venues: accepted.length, amountTnd, told };
      }
      if (locked.length === 0 && frozen.length === 0 && !final) return null;
      return {
        campaignId,
        locked: locked.length,
        frozen: frozen.length,
        volumeFact: volumeOf(locked) + volumeOf(frozen),
        placedFact,
        ...(final ? { final } : {}),
      };
    })
    .catch(async (err: unknown) => {
      await trace.finish('rolled_back', { reason: 'ERROR' });
      throw err;
    });
  // LOG1 — journal a pass that acted (nothing due = nothing to journal).
  if (outcome) {
    await trace.finish('committed', { reason: 'prelaunch' });
    log?.info(outcome, 'campaign pre-launch step');
  }
  return outcome;
};

/** One pass over every classic tours campaign still before its start at some Host. */
export const runCampaignPrelaunchTick = async (
  now: Date = new Date(),
  log?: FastifyBaseLogger,
): Promise<PrelaunchOutcome[]> => {
  const candidates = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.campaignId, campaigns.id))
    .where(
      and(
        inArray(campaigns.status, ['upcoming', 'active']),
        isNull(campaigns.eventId),
        isNotNull(campaigns.startDate),
        // An overnight venue opens the day after the start date: yesterday's starts still count.
        gte(campaigns.startDate, plusCalendarDays(tunisDateOf(now), -1)),
        isNull(campaigns.prelaunchFrozenAt),
        eq(campaignDispatchPlan.engine, 'tours'),
        notDemoCampaignSql(),
      ),
    );
  const outcomes: PrelaunchOutcome[] = [];
  for (const c of candidates) {
    try {
      const outcome = await runCampaign(c.id, now, log);
      if (outcome) outcomes.push(outcome);
    } catch (err) {
      log?.warn({ err, campaignId: c.id }, 'campaign pre-launch step failed');
    }
  }
  return outcomes;
};

/** Boot tick + a 1-minute unref'd interval: each deadline lands within a minute. */
export function startCampaignPrelaunchJob(log: FastifyBaseLogger): void {
  const tick = () =>
    void runCampaignPrelaunchTick(new Date(), log).catch((err: unknown) =>
      log.warn({ err }, 'campaign pre-launch tick failed'),
    );
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
}
