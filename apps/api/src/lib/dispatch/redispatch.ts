import { formatInTimeZone } from 'date-fns-tz';
import { and, eq, inArray, isNotNull, max } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  type DispatchCreneau,
  type RedispatchMissedFrom,
  type RedispatchPlacedTo,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  notifications,
  screens,
  screenhosts,
} from '../../db/schema.js';
import { logger } from '../../logger.js';
import { NOOP_TRACE, type EngineTrace } from '../engine-journal/trace.js';
import { PLAYOUT_TZ, loadDeliveredSlots } from '../reconcile/delivered-slots.js';
import { slotKey } from '../reconcile/valuation.js';
import { S_MIN_TND } from '../vf-constants.js';

import { computeR, computeRi, physicalFromFacturable } from './eligibility.js';
import { buildCreneaux } from './plan.js';
import { type DbExecutor, assemblePool } from './pool.js';
import { type EligibleScreenhost, selection } from './selection.js';
import { seuilImpressions } from './thresholds.js';

const log = logger.child({ module: 'redispatch' });

// E6 — redispatching (VF Epic 3 + Mariem's total-validation amendment). Detect manquements on an
// ACTIVE campaign (elapsed planned créneaux with no proof, the SAME FIX A bucketing as the
// reconciliation), accumulate the loss, and while the TOTAL (stored reliquat + NET missed value)
// reaches S_min = 20 TND, re-run THE SAME remplissage (selection, unmodified) over the remaining
// pool to re-place the volume FORWARD (future-only créneaux over the remaining window). What
// cannot be placed waits for the end-of-campaign NET reconciliation. Rounds are recorded in
// campaign_redispatch_rounds — the ledger that keeps the detector STATELESS (net missed = gross −
// Σ prior missed-sourced placements) and reconciliation NET (no slot refunded twice).

/**
 * A screenhost is DEAD for redispatch when none of its screens has been seen within this
 * tolerance (screens.last_seen_at — written on pair, on every HEARTBEAT and on every proof).
 * 12 minutes: an airing screen refreshes last_seen_at at worst every few minutes (heartbeats ride
 * the WS ping cadence and proofs land per repetition, r_i ≥ 2/hour), so 12 min tolerates several
 * missed beats plus a reconnect/backoff window without false positives — while staying well under
 * the hourly tick, so a screen that died is excluded by the FIRST round that considers it. A
 * screenhost with NO screen rows at all has no airing device and is dead by definition here.
 */
export const REDISPATCH_HEARTBEAT_TOLERANCE_MS = 12 * 60 * 1000;

/** The current Africa/Tunis (date, hour) — the boundary between elapsed and future créneaux. */
export const tunisNowSlot = (now: Date): { date: string; hour: number } => ({
  date: formatInTimeZone(now, PLAYOUT_TZ, 'yyyy-MM-dd'),
  hour: Number(formatInTimeZone(now, PLAYOUT_TZ, 'H')),
});

/** A créneau has ELAPSED iff its hour is strictly past (the in-progress hour is NOT elapsed). */
export const isElapsed = (
  c: { date: string; hour: number },
  nowSlot: { date: string; hour: number },
): boolean => c.date < nowSlot.date || (c.date === nowSlot.date && c.hour < nowSlot.hour);

/** A créneau is FUTURE iff its hour has not started (the in-progress hour is NOT placeable). */
export const isFuture = (
  c: { date: string; hour: number },
  nowSlot: { date: string; hour: number },
): boolean => c.date > nowSlot.date || (c.date === nowSlot.date && c.hour > nowSlot.hour);

export interface DetectorAllocation {
  screenhostId: string;
  creneaux: readonly { date: string; hour: number; impressions: number }[];
  deliveredSlots: ReadonlySet<string>;
}

/**
 * PURE detector: per screenhost, the elapsed créneaux with no delivered proof — the campaign's
 * gross manquement so far, in PHYSICAL impressions (the créneaux unit). REFUSE allocations are
 * included by the caller on purpose: a mid-flight refusal simply stops airing, and its elapsing
 * slots surface here — this is how an ACTIVE-campaign refusal cascades via E6.
 */
export const detectMissedSlots = (
  allocations: readonly DetectorAllocation[],
  nowSlot: { date: string; hour: number },
): { perScreenhost: RedispatchMissedFrom[]; missedPhysical: number } => {
  const perScreenhost: RedispatchMissedFrom[] = [];
  let missedPhysical = 0;
  for (const a of allocations) {
    let slots = 0;
    let imp = 0;
    for (const c of a.creneaux) {
      if (!isElapsed(c, nowSlot)) continue;
      if (a.deliveredSlots.has(slotKey(c.date, c.hour))) continue;
      slots += 1;
      imp += c.impressions;
    }
    if (slots > 0) {
      perScreenhost.push({ screenhost_id: a.screenhostId, slots, imp_physical: imp });
      missedPhysical += imp;
    }
  }
  return { perScreenhost, missedPhysical };
};

export type RedispatchRoundOutcome =
  | { status: 'NO_PLAN' }
  | { status: 'BELOW_THRESHOLD'; totalValueTnd: number }
  | { status: 'NO_FUTURE_WINDOW' }
  | { status: 'NOTHING_PLACEABLE'; vFact: number }
  | {
      status: 'PLACED';
      vFact: number;
      placedFact: number;
      residualFact: number;
      reliquatConsumedFact: number;
      placedTo: RedispatchPlacedTo[];
    };

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// Screenhosts with NO screen seen within the tolerance (or no screens at all) — they cannot air,
// so the rattrapage must not place onto them.
const deadScreenhostIds = async (tx: DbExecutor, cutoff: Date): Promise<string[]> => {
  const rows = await tx
    .select({ screenhostId: screenhosts.id, lastSeen: max(screens.lastSeenAt) })
    .from(screenhosts)
    .leftJoin(screens, eq(screens.screenhostId, screenhosts.id))
    .where(eq(screenhosts.isActive, true))
    .groupBy(screenhosts.id);
  return rows.filter((r) => r.lastSeen === null || r.lastSeen < cutoff).map((r) => r.screenhostId);
};

/**
 * ONE rattrapage round for one ACTIVE campaign (per tick). Everything runs in a single
 * transaction: the plan row is locked FOR UPDATE (serializes concurrent ticks AND the refusal
 * cascade's reliquat writes), the pool assembles under the same per-screenhost advisory locks as
 * dispatch/cascade, placements append/merge EXACTLY like the cascade (EN_ATTENTE — owner consent
 * is never bypassed; a merge re-asks), and the round is recorded. A round is only RECORDED when
 * it changed state (placed > 0); an unplaceable total is logged and left for the next tick /
 * the reconciliation.
 */
export const runRedispatchRound = async (
  campaign: { id: string; name: string; startDate: string; endDate: string },
  now: Date = new Date(),
  // LOG1 — observe-only journal (default no-op); buffered in-tx, flushed BELOW after the tx.
  trace: EngineTrace = NOOP_TRACE,
): Promise<RedispatchRoundOutcome> => {
  const nowSlot = tunisNowSlot(now);

  const outcome = await db
    .transaction(async (tx): Promise<RedispatchRoundOutcome> => {
      // Serialize rounds per campaign (and vs the cascade's reliquat_stocke writes).
      const [plan] = await tx
        .select()
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, campaign.id))
        .for('update');
      if (!plan) return { status: 'NO_PLAN' };

      const cpm = Number(plan.cpm);
      const t = Number(plan.tTierCoef);
      const s = plan.sSpotSeconds;
      const seuil = seuilImpressions(cpm);

      const allocations = await tx
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan.id));

      // Gross manquement: elapsed ∧ undelivered, the shared FIX A bucketing.
      const deliveredBySh = await loadDeliveredSlots(campaign.id);
      const detected = detectMissedSlots(
        allocations.map((a) => ({
          screenhostId: a.screenhostId,
          creneaux: a.creneaux,
          deliveredSlots: deliveredBySh.get(a.screenhostId) ?? new Set<string>(),
        })),
        nowSlot,
      );

      // NET missed = gross − what earlier rounds already re-placed (missed-sourced placements only:
      // placed_fact − reliquat_consumed_fact; the reliquat-sourced part shrank the column instead).
      const priorRounds = await tx
        .select({
          placedFact: campaignRedispatchRounds.placedFact,
          reliquatConsumedFact: campaignRedispatchRounds.reliquatConsumedFact,
        })
        .from(campaignRedispatchRounds)
        .where(eq(campaignRedispatchRounds.campaignId, campaign.id));
      const replacedMissedFact = priorRounds.reduce(
        (sum, r) => sum + Math.max(0, r.placedFact - r.reliquatConsumedFact),
        0,
      );

      const grossMissedFact = Math.floor(detected.missedPhysical * t);
      const netMissedFact = Math.max(0, grossMissedFact - replacedMissedFact);

      // LOG1 — the detector's verdict, per defaulting venue + the round's valued trigger.
      for (const m of detected.perScreenhost) {
        trace.event(
          'manquement_detected',
          { slots: m.slots, impPhysical: m.imp_physical },
          m.screenhost_id,
        );
      }

      // Mariem's amendment — the trigger validates the TOTAL: stored reliquat + net missed value.
      const vFact = plan.reliquatStocke + netMissedFact;
      const totalValueTnd = round4((vFact * cpm) / 1000);
      trace.event('redispatch_valued', {
        grossMissedFact,
        netMissedFact,
        reliquatStocke: plan.reliquatStocke,
        vFact,
        totalValueTnd,
      });
      if (totalValueTnd < S_MIN_TND) return { status: 'BELOW_THRESHOLD', totalValueTnd };

      // The rattrapage places FORWARD only: the pool's capacity window starts today (past days are
      // gone), and the créneaux filter below drops today's already-started hours.
      const effectiveStart = campaign.startDate > nowSlot.date ? campaign.startDate : nowSlot.date;
      if (effectiveStart > campaign.endDate) return { status: 'NO_FUTURE_WINDOW' };

      // Exclusions: refusers (consent is final), this round's defaulters (never re-place onto the
      // screen that just missed), and DEAD screens (no heartbeat within the tolerance / no device).
      const refuserIds = allocations
        .filter((a) => a.statutAcceptation === 'REFUSE')
        .map((a) => a.screenhostId);
      const defaulterIds = detected.perScreenhost.map((m) => m.screenhost_id);
      const cutoff = new Date(now.getTime() - REDISPATCH_HEARTBEAT_TOLERANCE_MS);
      const deadIds = await deadScreenhostIds(tx, cutoff);
      const excludeScreenhostIds = [...new Set([...refuserIds, ...defaulterIds, ...deadIds])];
      // Belt: the excluded screenhosts' allocations for THIS plan drop out of the netting too.
      const excludeAllocationIds = allocations
        .filter((a) => excludeScreenhostIds.includes(a.screenhostId))
        .map((a) => a.id);

      // E5.1 — the pool always assembles (zero targeting lines = the whole network).
      const { pool } = await assemblePool(
        tx,
        { id: campaign.id, startDate: effectiveStart, endDate: campaign.endDate },
        { s, t, fMaxSeconds: plan.fMaxSeconds },
        { excludeScreenhostIds, excludeAllocationIds, lockOccupancy: true, trace },
      );

      // THE SAME remplissage as dispatch/cascade — selection() verbatim, frozen plan params.
      const eligible: EligibleScreenhost[] = pool.map((p) => ({
        id: p.id,
        sps: p.sps,
        anciennete: p.anciennete,
        residualCapacity: p.residualCapacity,
        revenuJour: p.revenuJour,
        activeToday: p.activeToday,
      }));
      const { retenus } = selection(eligible, vFact, {
        seuilDiffusable: seuil,
        gJour: Number(plan.gJour),
      });

      const poolById = new Map(pool.map((p) => [p.id, p]));
      const retainedIds = retenus.map((r) => r.id);
      const existingRows = retainedIds.length
        ? await tx
            .select()
            .from(campaignDispatchAllocation)
            .where(
              and(
                eq(campaignDispatchAllocation.planId, plan.id),
                inArray(campaignDispatchAllocation.screenhostId, retainedIds),
              ),
            )
        : [];
      const existingBySh = new Map(existingRows.map((r) => [r.screenhostId, r]));

      const placedTo: RedispatchPlacedTo[] = [];
      let placedFact = 0;
      const notifyIds: string[] = [];

      for (const ret of retenus) {
        const p = poolById.get(ret.id);
        if (!p) continue;
        // The delta reps for the added share, over the REMAINING window's capacity.
        const rIAdd = computeRi(
          physicalFromFacturable(ret.ai, t),
          p.avgAffluence,
          p.hours,
          plan.rMinEfficace,
          p.repsCap,
        );
        // FUTURE-ONLY créneaux: buildCreneaux over the remaining window, minus today's
        // already-started hours. An empty result (e.g. the window ends within the current hour)
        // means this placement cannot air — skip it (its volume stays unplaced).
        // E2 — p.days: the replacement venue's OWN declared days are skipped here too.
        const futureDelta = buildCreneaux(p.days, p.slots, rIAdd).filter((c) =>
          isFuture(c, nowSlot),
        );
        if (futureDelta.length === 0) continue;

        const existing = existingBySh.get(ret.id);
        if (existing) {
          // Merge onto the retained allocation — the cascade's re-consent semantics: the deal
          // changed, so the row returns EN_ATTENTE (the airability gate pauses it until the owner
          // re-accepts; consent is never bypassed). Past créneaux are PRESERVED (the reconciliation
          // needs them); the delta rides appended future slots, and r_i (the forward pacing the
          // playout reads) grows by the delta reps.
          const totalAi = existing.iiPotentiel + ret.ai;
          const rITotal = Math.min(existing.rI + rIAdd, computeR(s, 3600));
          const mergedCreneaux: DispatchCreneau[] = [...existing.creneaux, ...futureDelta];
          await tx
            .update(campaignDispatchAllocation)
            .set({
              iiPotentiel: totalAi,
              rI: rITotal,
              revenuPrevisionnel: String(round4((totalAi * cpm) / 1000)),
              creneaux: mergedCreneaux,
              statutAcceptation: 'EN_ATTENTE',
            })
            .where(eq(campaignDispatchAllocation.id, existing.id));
          placedTo.push({ screenhost_id: ret.id, added_fact: ret.ai, merged: true });
          trace.event(
            'rattrapage_placed',
            { impressions: ret.ai, valueTnd: round4((ret.ai * cpm) / 1000), merged: true },
            ret.id,
          );
        } else {
          await tx.insert(campaignDispatchAllocation).values({
            planId: plan.id,
            screenhostId: ret.id,
            iiPotentiel: ret.ai,
            rI: rIAdd,
            revenuPrevisionnel: String(round4((ret.ai * cpm) / 1000)),
            creneaux: futureDelta,
          });
          placedTo.push({ screenhost_id: ret.id, added_fact: ret.ai, merged: false });
          trace.event(
            'rattrapage_placed',
            { impressions: ret.ai, valueTnd: round4((ret.ai * cpm) / 1000), merged: false },
            ret.id,
          );
        }
        placedFact += ret.ai;
        notifyIds.push(ret.id);
      }

      if (placedFact === 0) {
        // Nothing absorbable this tick — no state changed, no round recorded (the ledger only
        // carries state changes); the residue waits for the next tick / the reconciliation.
        log.info(
          { campaignId: campaign.id, vFact, totalValueTnd },
          'redispatch: rien de plaçable — le reliquat attend la réconciliation',
        );
        return { status: 'NOTHING_PLACEABLE', vFact };
      }

      // Reliquat-FIRST attribution: the stored crumb rides the first material round; what the
      // placement did not cover stays stored (reduced) or — if missed-sourced — stays implicit in
      // the original créneaux until reconciliation.
      const reliquatConsumedFact = Math.min(placedFact, plan.reliquatStocke);
      if (reliquatConsumedFact > 0) {
        trace.event('reliquat_consumed', { impressions: reliquatConsumedFact });
        await tx
          .update(campaignDispatchPlan)
          .set({ reliquatStocke: plan.reliquatStocke - reliquatConsumedFact })
          .where(eq(campaignDispatchPlan.id, plan.id));
      }

      // Notify each DISTINCT owner whose venue must (re-)accept — the dispatch/cascade producer
      // pattern, inside the same transaction.
      const ownerRows = await tx
        .select({ ownerId: screenhosts.ownerId })
        .from(screenhosts)
        .where(and(inArray(screenhosts.id, notifyIds), isNotNull(screenhosts.ownerId)));
      const ownerIds = [
        ...new Set(ownerRows.map((r) => r.ownerId).filter((id): id is string => id !== null)),
      ];
      if (ownerIds.length > 0) {
        await tx.insert(notifications).values(
          ownerIds.map((ownerId) => ({
            userId: ownerId,
            type: 'dispatch_pending_acceptance',
            title: 'Campagne en attente de votre acceptation',
            body: `La campagne « ${campaign.name} » attend votre acceptation.`,
            campaignId: campaign.id,
          })),
        );
      }

      const residualFact = vFact - placedFact;
      await tx.insert(campaignRedispatchRounds).values({
        campaignId: campaign.id,
        planId: plan.id,
        roundTs: now,
        reliquatConsumedFact,
        missedFact: netMissedFact,
        missedFrom: detected.perScreenhost,
        placedFact,
        placedTo,
        residualFact,
      });

      log.info(
        {
          campaignId: campaign.id,
          vFact,
          placedFact,
          residualFact,
          reliquatConsumedFact,
          placements: placedTo.length,
        },
        'redispatch: rattrapage effectué',
      );

      return {
        status: 'PLACED',
        vFact,
        placedFact,
        residualFact,
        reliquatConsumedFact,
        placedTo,
      };
    })
    .catch(async (err: unknown) => {
      // LOG1 — the round rolled back; keep its trace, rethrow verbatim.
      await trace.finish('rolled_back', { reason: 'ERROR' });
      throw err;
    });

  // LOG1 — flush POST-outcome (the tx above resolved). NO_PLAN ran no engine work → no run row;
  // every other outcome committed (BELOW_THRESHOLD / NO_FUTURE_WINDOW / NOTHING_PLACEABLE write
  // nothing but their detection trace is the operator's answer to « pourquoi rien ? »).
  if (outcome.status !== 'NO_PLAN') {
    await trace.finish('committed', {
      result: outcome.status,
      ...(outcome.status === 'PLACED'
        ? {
            vFact: outcome.vFact,
            placedFact: outcome.placedFact,
            residualFact: outcome.residualFact,
            reliquatConsumedFact: outcome.reliquatConsumedFact,
          }
        : {}),
      ...(outcome.status === 'BELOW_THRESHOLD' ? { totalValueTnd: outcome.totalValueTnd } : {}),
      ...(outcome.status === 'NOTHING_PLACEABLE' ? { vFact: outcome.vFact } : {}),
    });
  }
  return outcome;
};
