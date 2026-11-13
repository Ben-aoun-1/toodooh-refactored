import { eq } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  type Campaign,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
} from '../../../db/schema.js';
import { type CpmFreezeCheck } from '../../cpm-freeze-guard.js';
import { acceptDemoAllocations, isDemoCampaign } from '../../demo.js';
import { NOOP_TRACE, type EngineTrace } from '../../engine-journal/trace.js';
import { freezeTypicalWeek } from '../../typical-week-freeze.js';
import { type TTiers, getDispatchConfig } from '../config.js';
import { type DispatchResult } from '../dispatch-service.js';
import { tForDuration } from '../thresholds.js';

import { calculerCampagne } from './campaign-calcul.js';
import { creneauxParVenue } from './creneaux.js';
import { type ShownQuote, quoteMoved } from './quote.js';
import { EPS } from './remplir.js';
import { tellOwners } from './reservation.js';

// DISP-TOURS — the LAUNCH of a standard campaign by the tours engine (Mariem's spec R13), in ONE
// transaction under the same sorted per-venue advisory locks as before (two launches can never
// take the same place of an almost full hour — the spec's « garde-fou au lancement »):
//   1. the calculation runs on the state of the moment (the live typical week, the launched
//      campaigns' places), at the budget the advertiser targeted;
//   2. the allocation is FROZEN: the plan keeps F, S, T, the CPM, the exact price and the admin
//      snapshot; the typical week used is copied into the campaign's own week (typical-week-
//      freeze.ts — the redispatching and the cascade price on it from now on);
//   3. every allocated créneau takes one place of its hour (the créneaux ARE the reservation:
//      the next calculation counts them, ./assemble.ts);
//   4. the amount engaged on the wallet becomes the exact price (requested_budget, the engaged
//      set's one figure — lib/recharges.ts); settlement still bills what was delivered;
//   5. each retained owner is told the campaign and its amount (always ≥ 30 DT a venue), and
//      accepts it as before (DEMO-1: a demo campaign is accepted on their behalf) — Q1: unless
//      the spot still awaits its validation: the allocations then wait as RESERVE, proposed and
//      told at the validation (./reservation.ts).
// The status flip (« à venir » / « active ») stays activation-service's finalize, unchanged.
// §3.4 — the « garde-fou au lancement »: under those locks, the figures the cart showed must
// still be the ones calculated (else nothing is written and the cart shows the new ones), and
// the wallet must cover the exact price (the amount the launch engages).

export interface ToursDispatchInputs {
  budgetTnd: number;
  cpm: number;
  s: number;
  tiers: TTiers;
  /** The figures the advertiser saw at « Lancer » (the cart's quote). */
  expected?: ShownQuote;
  /** What the advertiser can still engage (the campaign itself excluded). */
  spendableTnd?: number;
  /** Q1 — the spot awaits its validation: reserve the places, propose nothing yet. */
  reserve?: boolean;
}

export type ToursDispatchResult =
  | DispatchResult
  | { status: 'QUOTE_CHANGED' }
  | { status: 'INSUFFICIENT_BALANCE'; requiredTnd: number; availableTnd: number };

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export const runToursDispatch = async (
  campaign: Pick<Campaign, 'id' | 'name' | 'startDate' | 'endDate'>,
  inputs: ToursDispatchInputs,
  trace: EngineTrace = NOOP_TRACE,
  cpmCheck?: CpmFreezeCheck,
): Promise<ToursDispatchResult> => {
  if (!campaign.startDate || !campaign.endDate) return { status: 'NO_WINDOW' };
  const window = { id: campaign.id, startDate: campaign.startDate, endDate: campaign.endDate };

  const [existing] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaign.id))
    .limit(1);
  if (existing) return { status: 'ALREADY_DISPATCHED' };

  const config = await getDispatchConfig();
  const t = tForDuration(inputs.s, inputs.tiers);

  const outcome = await db
    .transaction(async (tx): Promise<ToursDispatchResult> => {
      if (cpmCheck && !(await cpmCheck(tx, inputs.cpm))) return { status: 'CPM_CHANGED' };
      const { pool, params, calcul, detail } = await calculerCampagne(
        tx,
        window,
        { s: inputs.s, t, cpm: inputs.cpm, budgetTnd: inputs.budgetTnd },
        { typicalWeek: 'live', lockOccupancy: true, trace },
      );
      if (pool.venues.length === 0) {
        return { status: 'NO_ELIGIBLE', saturated: pool.candidateCount > 0 };
      }
      // A budget too small to give any venue 30 DT places nothing: not a deliverable plan.
      if (calcul.iAlloue <= EPS) return { status: 'TOO_THIN', nMin: 0, nMax: 0 };
      // §3.4 — nothing written yet: a moved quote or a short wallet leaves no trace.
      if (
        inputs.expected &&
        quoteMoved(inputs.expected, { prixTnd: calcul.prixTnd, impressions: calcul.iAlloue })
      ) {
        return { status: 'QUOTE_CHANGED' };
      }
      if (
        inputs.spendableTnd !== undefined &&
        round2(calcul.prixTnd) > inputs.spendableTnd + EPS
      ) {
        return {
          status: 'INSUFFICIENT_BALANCE',
          requiredTnd: round2(calcul.prixTnd),
          availableTnd: inputs.spendableTnd,
        };
      }

      const retained = calcul.venues.filter((v) => v.impressions > EPS);
      const creneaux = creneauxParVenue(calcul.final.prises);
      const cutTranche = calcul.final.file[calcul.final.fill.cut];
      const isPartial =
        calcul.iCible - calcul.iAlloue > (cutTranche ? cutTranche.v / params.rPlein : 0) + EPS;
      const priceTnd = round4(calcul.prixTnd);

      for (const v of retained) {
        trace.event(
          'allocation_placed',
          {
            impressions: v.impressions,
            valueTnd: round4((v.impressions * inputs.cpm) / 1000),
            montantShTnd: round4(v.montantTnd),
            tours: v.tours.map((x) => `${x.tour}:${x.passages}`).join(','),
          },
          v.venueId,
        );
      }

      const [planRow] = await tx
        .insert(campaignDispatchPlan)
        .values({
          campaignId: campaign.id,
          iCible: Math.floor(calcul.iCible),
          cpm: String(inputs.cpm),
          sSpotSeconds: inputs.s,
          tTierCoef: String(t),
          // The impressions a venue needs to reach SEUIL_SH at this CPM and share.
          seuilDiffusable: Math.ceil(
            params.seuilShTnd / ((inputs.cpm / 1000) * (params.pctSh / 100)),
          ),
          sMin: String(params.seuilShTnd),
          gJour: '0',
          fMaxSeconds: config.fMaxSeconds,
          rMinEfficace: config.rMinEfficace,
          couvert: Math.round(calcul.iAlloue),
          nMin: 0,
          nMax: 0,
          nRetenus: retained.length,
          isPartial,
          isTooThin: false,
          reliquatStocke: 0,
          engine: 'tours',
          priceTnd: String(priceTnd),
          detail,
        })
        .returning();
      if (!planRow) throw new Error('dispatch plan insert failed');
      await tx.insert(campaignDispatchAllocation).values(
        retained.map((v) => {
          const own = creneaux.get(v.venueId) ?? [];
          return {
            planId: planRow.id,
            screenhostId: v.venueId,
            iiPotentiel: Math.round(v.impressions),
            rI: own.reduce((m, c) => Math.max(m, c.reps), 0),
            revenuPrevisionnel: String(round4((v.impressions * inputs.cpm) / 1000)),
            creneaux: own,
            ...(inputs.reserve === true ? { statutAcceptation: 'RESERVE' as const } : {}),
          };
        }),
      );
      // R13 — the typical week used, frozen for the whole campaign.
      await freezeTypicalWeek(tx, campaign.id);
      // R13 — the amount engaged is the exact price (shown to the cent).
      await tx
        .update(campaigns)
        .set({ requestedBudget: round2(priceTnd).toFixed(2) })
        .where(eq(campaigns.id, campaign.id));

      if (await isDemoCampaign(tx, campaign.id)) {
        await acceptDemoAllocations(tx, planRow.id);
        return { status: 'OK', plan: planRow, allocationCount: retained.length };
      }
      // R13 — each owner told their amount; Q1 — not before the spot is validated.
      if (inputs.reserve !== true) {
        await tellOwners(
          tx,
          campaign,
          retained.map((v) => ({ venueId: v.venueId, montantTnd: v.montantTnd })),
        );
      }
      return { status: 'OK', plan: planRow, allocationCount: retained.length };
    })
    .catch(async (err: unknown): Promise<ToursDispatchResult> => {
      if ((err as { code?: string }).code === '23505') return { status: 'ALREADY_DISPATCHED' };
      await trace.finish('rolled_back', { reason: 'ERROR' });
      throw err;
    });

  if (outcome.status === 'OK') {
    await trace.finish('committed', {
      status: 'OK',
      engine: 'tours',
      couvert: outcome.plan.couvert,
      nRetenus: outcome.plan.nRetenus,
      priceTnd: outcome.plan.priceTnd,
      allocationCount: outcome.allocationCount,
    });
  } else if (
    outcome.status === 'TOO_THIN' ||
    outcome.status === 'NO_ELIGIBLE' ||
    outcome.status === 'QUOTE_CHANGED' ||
    outcome.status === 'INSUFFICIENT_BALANCE'
  ) {
    await trace.finish('rolled_back', { reason: outcome.status, engine: 'tours' });
  }
  return outcome;
};
