import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  type Campaign,
  type DispatchCreneau,
  businessSectors,
  campaignBoosts,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaignZones,
  campaigns,
  notifications,
  screenhosts,
  zones,
} from '../db/schema.js';

import { MIN_CAMPAIGN_BUDGET_TND } from './campaign-budget.js';
import { computeR, computeRi, physicalFromFacturable } from './dispatch/eligibility.js';
import { buildCreneaux, computeBounds } from './dispatch/plan.js';
import { assemblePool } from './dispatch/pool.js';
import { isFuture, tunisNowSlot } from './dispatch/redispatch.js';
import { type EligibleScreenhost, selection } from './dispatch/selection.js';
import { seuilImpressions } from './dispatch/thresholds.js';
import { walletBalance } from './recharges.js';

// CF-B1 (spec §3.3) — « Booster »: STRICTLY ADDITIVE on an Active/À venir campaign. The end date
// can only grow (the start is frozen), zones/categories only APPEND, and the complementary budget
// dispatches V = amount×1000/CPM over the MERGED perimeter under the SAME rules as any dispatch:
// assemblePool (occupancy-locked) → selection() verbatim → EN_ATTENTE placements (merge =
// re-consent, the E3 cascade semantics) → future-only créneaux (the E6 rule — uniform here: an
// upcoming campaign's window is entirely future, so the filter is a no-op for it).
//
// HYPOTHETICAL-STATE PRICING: assemblePool reads targeting/zones from the DB, so both preview and
// apply persist the additions INSIDE one transaction first, assemble over the merged state, and
// the preview then ROLLS BACK (a sentinel throw) — nothing observable ever persists for a preview,
// and an apply failure (TOO_THIN / NO_ELIGIBLE / gates) rolls the whole boost back the same way.
//
// OWN ALLOCATIONS = ENGAGEMENT (ruling 4): unlike the draft-side C_max (SK1 self-exclusion — a
// frozen plan not yet airing is the campaign's own delivery), a boosted campaign IS airing or
// committed; its existing allocations genuinely consume capacity, so the boost ceiling nets them
// like anyone else's. No excludeAllocationIds here — the assemblePool default IS ruling 4.
//
// Dispatch/selection/reconcile are CONSUMED, never modified.

export interface BoostAdditions {
  newEndDate?: string;
  addedZoneIds?: string[];
  addedCategoryIds?: string[];
}

export type BoostRefusal =
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_BOOSTABLE'; currentStatus: string }
  | { status: 'NO_PLAN' }
  | { status: 'NO_ADDITION' }
  | { status: 'INVALID_END_DATE'; currentEndDate: string }
  | { status: 'ZONE_NOT_FOUND'; zoneId: string }
  | { status: 'ZONE_ALREADY_TARGETED'; zoneId: string }
  | { status: 'ZONES_WHOLE_NETWORK' }
  | { status: 'CATEGORY_NOT_FOUND'; categoryId: string }
  | { status: 'CATEGORY_ALREADY_TARGETED'; categoryId: string }
  | { status: 'CATEGORIES_WHOLE_NETWORK' }
  | { status: 'NO_FUTURE_WINDOW' }
  | { status: 'BUDGET_BELOW_MINIMUM'; floorTnd: number }
  | { status: 'BUDGET_EXCEEDS_CMAX'; cMaxBoostTnd: number }
  | { status: 'INSUFFICIENT_BALANCE'; requiredTnd: number; availableTnd: number }
  | { status: 'TOO_THIN'; nMin: number; nMax: number }
  | { status: 'NO_ELIGIBLE' };

export interface BoostPreview {
  status: 'PREVIEW';
  cMaxBoostTnd: number;
  eligibleCount: number;
}

export interface BoostApplied {
  status: 'APPLIED';
  boostId: string;
  placedFact: number;
  vFact: number;
  newEndDate: string;
  reliquatAddedFact: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// The preview's rollback vehicle: computing over the hypothetical merged state requires the
// in-tx writes to be visible to assemblePool, and aborting the tx is what un-does them.
class PreviewRollback extends Error {
  constructor(public readonly preview: BoostPreview) {
    super('BOOST_PREVIEW_ROLLBACK');
  }
}
class BoostRefused extends Error {
  constructor(public readonly refusal: BoostRefusal) {
    super('BOOST_REFUSED');
  }
}

/**
 * Validate the additions against the CURRENT campaign state (inside the boost tx). STRICTLY
 * ADDITIVE, with the E5.1 consequence made explicit: an axis with ZERO existing lines already
 * targets the WHOLE NETWORK — "adding" to it would NARROW the campaign, so it is refused
 * (ZONES_WHOLE_NETWORK / CATEGORIES_WHOLE_NETWORK). Only a campaign that already narrows an axis
 * can broaden it further.
 */
const validateAdditions = async (
  tx: Parameters<Parameters<(typeof db)['transaction']>[0]>[0],
  campaign: Campaign,
  additions: BoostAdditions,
): Promise<{ endExtended: boolean; zoneIds: string[]; categoryIds: string[] }> => {
  const zoneIds = [...new Set(additions.addedZoneIds ?? [])];
  const categoryIds = [...new Set(additions.addedCategoryIds ?? [])];

  let endExtended = false;
  if (additions.newEndDate !== undefined && campaign.endDate !== null) {
    if (additions.newEndDate < campaign.endDate) {
      throw new BoostRefused({ status: 'INVALID_END_DATE', currentEndDate: campaign.endDate });
    }
    endExtended = additions.newEndDate > campaign.endDate;
  }

  if (zoneIds.length > 0) {
    const existing = await tx
      .select({ zoneId: campaignZones.zoneId })
      .from(campaignZones)
      .where(eq(campaignZones.campaignId, campaign.id));
    if (existing.length === 0) throw new BoostRefused({ status: 'ZONES_WHOLE_NETWORK' });
    const existingSet = new Set(existing.map((z) => z.zoneId));
    const known = await tx.select({ id: zones.id }).from(zones).where(inArray(zones.id, zoneIds));
    const knownSet = new Set(known.map((z) => z.id));
    for (const zoneId of zoneIds) {
      if (!knownSet.has(zoneId)) throw new BoostRefused({ status: 'ZONE_NOT_FOUND', zoneId });
      if (existingSet.has(zoneId)) {
        throw new BoostRefused({ status: 'ZONE_ALREADY_TARGETED', zoneId });
      }
    }
  }

  if (categoryIds.length > 0) {
    const existing = await tx
      .select({ categoryId: campaignTargeting.categoryId })
      .from(campaignTargeting)
      .where(eq(campaignTargeting.campaignId, campaign.id));
    if (existing.length === 0) throw new BoostRefused({ status: 'CATEGORIES_WHOLE_NETWORK' });
    const existingSet = new Set(existing.map((l) => l.categoryId));
    const known = await tx
      .select({ id: businessSectors.id })
      .from(businessSectors)
      .where(and(inArray(businessSectors.id, categoryIds), eq(businessSectors.audience, 'owner')));
    const knownSet = new Set(known.map((s) => s.id));
    for (const categoryId of categoryIds) {
      if (!knownSet.has(categoryId)) {
        throw new BoostRefused({ status: 'CATEGORY_NOT_FOUND', categoryId });
      }
      if (existingSet.has(categoryId)) {
        throw new BoostRefused({ status: 'CATEGORY_ALREADY_TARGETED', categoryId });
      }
    }
  }

  if (!endExtended && zoneIds.length === 0 && categoryIds.length === 0) {
    throw new BoostRefused({ status: 'NO_ADDITION' });
  }
  return { endExtended, zoneIds, categoryIds };
};

interface BoostRunOpts {
  /** Preview computes the ceiling over the merged state then ROLLS BACK. */
  previewOnly: boolean;
  /** Apply only: the complementary budget (TND HT). */
  amountTnd?: number;
  /** Apply only: the advertiser applying the boost (audit). */
  appliedBy?: string;
  now?: Date;
}

/**
 * The one boost routine — preview and apply are the SAME transaction body; preview aborts after
 * the ceiling, apply continues through selection → placements → the boost row.
 */
export const runBoost = async (
  campaignId: string,
  advertiserId: string,
  additions: BoostAdditions,
  opts: BoostRunOpts,
): Promise<BoostPreview | BoostApplied | BoostRefusal> => {
  const now = opts.now ?? new Date();
  const nowSlot = tunisNowSlot(now);

  try {
    return await db.transaction(async (tx) => {
      // Owner-scoped load (foreign ≡ missing) + the status gate.
      const [campaign] = await tx
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.advertiserId, advertiserId)))
        .limit(1);
      if (!campaign) throw new BoostRefused({ status: 'NOT_FOUND' });
      if (campaign.status !== 'active' && campaign.status !== 'upcoming') {
        throw new BoostRefused({ status: 'NOT_BOOSTABLE', currentStatus: campaign.status });
      }

      // Serialize vs the cascade/redispatch (their tx also take the plan row FOR UPDATE).
      const [plan] = await tx
        .select()
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, campaign.id))
        .for('update');
      if (!plan) throw new BoostRefused({ status: 'NO_PLAN' });

      const { endExtended, zoneIds, categoryIds } = await validateAdditions(
        tx,
        campaign,
        additions,
      );

      // Persist the additions INSIDE the tx — assemblePool reads targeting/zones from the DB, so
      // this is how the merged (hypothetical, for preview) state prices. Rollback un-does it.
      const previousEndDate = campaign.endDate ?? '';
      const newEndDate =
        endExtended && additions.newEndDate ? additions.newEndDate : previousEndDate;
      if (endExtended) {
        await tx
          .update(campaigns)
          .set({ endDate: newEndDate })
          .where(eq(campaigns.id, campaign.id));
      }
      if (categoryIds.length > 0) {
        // Category-only lines, class null — the CF-W1 wire shape.
        await tx
          .insert(campaignTargeting)
          .values(
            categoryIds.map((categoryId) => ({ campaignId: campaign.id, categoryId, class: null })),
          );
      }
      if (zoneIds.length > 0) {
        await tx
          .insert(campaignZones)
          .values(zoneIds.map((zoneId) => ({ campaignId: campaign.id, zoneId })));
      }

      // The boost places FORWARD only (E6): the capacity window starts today for an active
      // campaign; an upcoming one's whole window is already future.
      const effectiveStart =
        campaign.startDate && campaign.startDate > nowSlot.date ? campaign.startDate : nowSlot.date;
      if (effectiveStart > newEndDate) throw new BoostRefused({ status: 'NO_FUTURE_WINDOW' });

      const cpm = Number(plan.cpm);
      const t = Number(plan.tTierCoef);
      const s = plan.sSpotSeconds;
      const seuil = seuilImpressions(cpm);

      // Consent is final (E3): venues that refused this campaign never receive boost placements.
      const allocations = await tx
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan.id));
      const refuserIds = allocations
        .filter((a) => a.statutAcceptation === 'REFUSE')
        .map((a) => a.screenhostId);

      // Own allocations ENGAGED (ruling 4) — no excludeAllocationIds. Preview is a read: no
      // occupancy locks; apply locks (it is about to allocate).
      const { pool, windowDays } = await assemblePool(
        tx,
        { id: campaign.id, startDate: effectiveStart, endDate: newEndDate },
        { s, t, fMaxSeconds: plan.fMaxSeconds },
        { excludeScreenhostIds: refuserIds, lockOccupancy: !opts.previewOnly },
      );

      const iMaxFact = pool.reduce((sum, p) => sum + p.residualCapacity, 0);
      const cMaxBoostTnd = Math.floor((cpm * iMaxFact) / 1000);

      if (opts.previewOnly) {
        throw new PreviewRollback({
          status: 'PREVIEW',
          cMaxBoostTnd,
          eligibleCount: pool.length,
        });
      }

      // ── APPLY gates ──
      const amountTnd = opts.amountTnd ?? 0;
      if (amountTnd < MIN_CAMPAIGN_BUDGET_TND) {
        throw new BoostRefused({
          status: 'BUDGET_BELOW_MINIMUM',
          floorTnd: MIN_CAMPAIGN_BUDGET_TND,
        });
      }
      if (amountTnd > cMaxBoostTnd) {
        throw new BoostRefused({ status: 'BUDGET_EXCEEDS_CMAX', cMaxBoostTnd });
      }
      // Solde HT ≥ amount (the cart-confirm idiom: a READ — no money moves; settlement debits).
      const balance = (await walletBalance(advertiserId)).balance_tnd;
      if (balance < amountTnd) {
        throw new BoostRefused({
          status: 'INSUFFICIENT_BALANCE',
          requiredTnd: amountTnd,
          availableTnd: balance,
        });
      }

      // V = amount×1000/CPM facturable, dispatched under the SAME rules (bounds → selection).
      const vFact = Math.floor((amountTnd * 1000) / cpm);
      const maxCap = pool.reduce((m, p) => Math.max(m, p.capaciteUtile), 0);
      const { nMin, nMax } = computeBounds(vFact, maxCap, seuil);
      if (pool.length === 0) throw new BoostRefused({ status: 'NO_ELIGIBLE' });
      if (nMin > nMax) throw new BoostRefused({ status: 'TOO_THIN', nMin, nMax });

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
      if (retenus.length === 0) throw new BoostRefused({ status: 'NO_ELIGIBLE' });

      // Placements — the redispatch/cascade idiom verbatim: future-only créneaux; merge onto an
      // existing allocation = RE-CONSENT (EN_ATTENTE, past créneaux preserved); new venue = a
      // fresh EN_ATTENTE row. Owner consent is never bypassed.
      const poolById = new Map(pool.map((p) => [p.id, p]));
      const existingBySh = new Map(allocations.map((a) => [a.screenhostId, a]));
      let placedFact = 0;
      const notifyIds: string[] = [];

      for (const ret of retenus) {
        const p = poolById.get(ret.id);
        if (!p) continue;
        const rIAdd = computeRi(
          physicalFromFacturable(ret.ai, t),
          p.avgAffluence,
          p.hours,
          plan.rMinEfficace,
          p.repsCap,
        );
        const futureDelta = buildCreneaux(windowDays, p.slots, rIAdd).filter((c) =>
          isFuture(c, nowSlot),
        );
        if (futureDelta.length === 0) continue;

        const existing = existingBySh.get(ret.id);
        if (existing) {
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
        } else {
          await tx.insert(campaignDispatchAllocation).values({
            planId: plan.id,
            screenhostId: ret.id,
            iiPotentiel: ret.ai,
            rI: rIAdd,
            revenuPrevisionnel: String(round4((ret.ai * cpm) / 1000)),
            creneaux: futureDelta,
          });
        }
        placedFact += ret.ai;
        notifyIds.push(ret.id);
      }

      if (placedFact === 0) throw new BoostRefused({ status: 'NO_ELIGIBLE' });

      // Sub-seuil placement leftovers → the stored reliquat (the E3 rule; E6 folds it in).
      const leftover = vFact - placedFact;
      const reliquatAddedFact = leftover > 0 && leftover < seuil ? leftover : 0;
      if (reliquatAddedFact > 0) {
        await tx
          .update(campaignDispatchPlan)
          .set({ reliquatStocke: plan.reliquatStocke + reliquatAddedFact })
          .where(eq(campaignDispatchPlan.id, plan.id));
      }

      // The complementary budget lands on the campaign (settlement reconciles the union).
      await tx
        .update(campaigns)
        .set({
          requestedBudget: String(round4(Number(campaign.requestedBudget ?? 0) + amountTnd)),
        })
        .where(eq(campaigns.id, campaign.id));

      // Notify each DISTINCT owner whose venue must (re-)accept — the dispatch producer pattern.
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

      const [boost] = await tx
        .insert(campaignBoosts)
        .values({
          campaignId: campaign.id,
          amountTnd: String(amountTnd),
          previousEndDate,
          newEndDate,
          addedZoneIds: zoneIds,
          addedCategoryIds: categoryIds,
          placedFact,
          appliedBy: opts.appliedBy ?? null,
        })
        .returning({ id: campaignBoosts.id });

      return {
        status: 'APPLIED',
        boostId: boost?.id ?? '',
        placedFact,
        vFact,
        newEndDate,
        reliquatAddedFact,
      } satisfies BoostApplied;
    });
  } catch (err: unknown) {
    if (err instanceof PreviewRollback) return err.preview;
    if (err instanceof BoostRefused) return err.refusal;
    throw err;
  }
};
