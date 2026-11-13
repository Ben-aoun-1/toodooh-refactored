import { formatInTimeZone } from 'date-fns-tz';
import { eq, inArray } from 'drizzle-orm';

import {
  type CampaignDispatchPlan,
  campaignDispatchAllocation,
  notifications,
  screenhosts,
} from '../../../db/schema.js';
import { acceptDemoAllocations, isDemoCampaign } from '../../demo.js';
import { NOOP_TRACE, type EngineTrace } from '../../engine-journal/trace.js';
import { SEUIL_SH_TND } from '../../vf-constants.js';
import { getDispatchConfig } from '../config.js';
import { computeR } from '../eligibility.js';
import { type DbExecutor } from '../pool.js';

import { assembleToursPool } from './assemble.js';
import { creneauxParVenue } from './creneaux.js';
import { redistribuer } from './redistribuer.js';
import { EPS, type Prise } from './remplir.js';

// DISP-TOURS — placing MORE of a launched tours campaign (Mariem's spec R14): a loss to
// redispatch, a refused share to re-place. ONE placement, on the caller's transaction:
//   • only the REMAINING créneaux (strictly after the current Tunis hour, never after the end);
//   • on the frozen typical week (R13), at hours this campaign does not use yet, under the same
//     CAP_heure and availability rules as the launch (./assemble.ts);
//   • first onto the venues ALREADY holding the campaign (the excluded ones — a defaulter, a
//     refuser — never), then onto NEW eligible venues, each only if it reaches 30 DT;
//   • a venue already in the campaign gets its added créneaux at once and a notice of what they
//     add (it accepted the campaign; ruling pending, Mariem Q3) — a new venue accepts first;
//   • what cannot be placed stays to the end-of-campaign settlement, which refunds it.

export interface PlacementInput {
  plan: CampaignDispatchPlan;
  campaign: { id: string; name: string; startDate: string; endDate: string };
  /** The qualified impressions to place. */
  volumeFact: number;
  /** Venues that never get any of it (the defaulters, the refusers). */
  excludeVenueIds: readonly string[];
  now: Date;
  /** Compute only — nothing written, no lock taken (the booster's preview). */
  dryRun?: boolean;
}

export interface PlacementOutcome {
  placedFact: number;
  nonPlaceFact: number;
  placedTo: { screenhost_id: string; added_fact: number; merged: boolean }[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

const montantText = (tnd: number): string => `${tnd.toFixed(2).replace('.', ',')} DT`;

export const placerToursIncrement = async (
  tx: DbExecutor,
  input: PlacementInput,
  trace: EngineTrace = NOOP_TRACE,
): Promise<PlacementOutcome> => {
  const { plan, campaign } = input;
  const allocations = await tx
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan.id));
  const excluded = new Set(input.excludeVenueIds);
  const ownCells = new Map<string, Set<string>>();
  for (const a of allocations) {
    ownCells.set(a.screenhostId, new Set(a.creneaux.map((c) => `${c.date}:${c.hour}`)));
  }
  const pool = await assembleToursPool(tx, campaign, plan.fMaxSeconds, {
    typicalWeek: 'frozen',
    afterSlot: {
      date: formatInTimeZone(input.now, 'Africa/Tunis', 'yyyy-MM-dd'),
      hour: Number(formatInTimeZone(input.now, 'Africa/Tunis', 'H')),
    },
    now: input.now,
    ownCells,
    excludeScreenhostIds: [...excluded],
    lockOccupancy: input.dryRun !== true,
    trace,
  });
  const engagedIds = new Set(
    allocations
      .filter((a) => a.statutAcceptation !== 'REFUSE' && !excluded.has(a.screenhostId))
      .map((a) => a.screenhostId),
  );
  const config = await getDispatchConfig();
  const cpm = Number(plan.cpm);
  const params = {
    rPlein: computeR(plan.sSpotSeconds, plan.fMaxSeconds),
    t: Number(plan.tTierCoef),
    cpm,
    pctSh: plan.detail?.params.pctSh ?? config.pctSh,
    seuilShTnd: plan.detail?.params.seuilShTnd ?? SEUIL_SH_TND,
  };
  const r = redistribuer({
    perte: input.volumeFact,
    engages: pool.venues.filter((v) => engagedIds.has(v.id)),
    nouveaux: pool.venues.filter((v) => !engagedIds.has(v.id) && !ownCells.has(v.id)),
    params,
  });

  const placedTo: PlacementOutcome['placedTo'] = [];
  const notices: { screenhostId: string; montant: number; merged: boolean }[] = [];
  const write = async (prises: readonly Prise[], merged: boolean): Promise<void> => {
    for (const [venueId, added] of creneauxParVenue(prises)) {
      const addedFact = added.reduce((sum, c) => sum + c.impressions, 0) * params.t;
      if (addedFact <= EPS) continue;
      const existing = allocations.find((a) => a.screenhostId === venueId);
      if (input.dryRun === true) {
        placedTo.push({ screenhost_id: venueId, added_fact: addedFact, merged });
        continue;
      }
      if (existing && merged) {
        const creneaux = [...existing.creneaux, ...added];
        await tx
          .update(campaignDispatchAllocation)
          .set({
            iiPotentiel: existing.iiPotentiel + Math.round(addedFact),
            rI: creneaux.reduce((m, c) => Math.max(m, c.reps), 0),
            revenuPrevisionnel: String(
              round4(Number(existing.revenuPrevisionnel) + (addedFact * cpm) / 1000),
            ),
            creneaux,
          })
          .where(eq(campaignDispatchAllocation.id, existing.id));
      } else {
        await tx.insert(campaignDispatchAllocation).values({
          planId: plan.id,
          screenhostId: venueId,
          iiPotentiel: Math.round(addedFact),
          rI: added.reduce((m, c) => Math.max(m, c.reps), 0),
          revenuPrevisionnel: String(round4((addedFact * cpm) / 1000)),
          creneaux: added,
        });
      }
      placedTo.push({ screenhost_id: venueId, added_fact: addedFact, merged });
      notices.push({
        screenhostId: venueId,
        montant: ((addedFact * cpm) / 1000) * (params.pctSh / 100),
        merged,
      });
      trace.event(
        'rattrapage_placed',
        { impressions: addedFact, valueTnd: round4((addedFact * cpm) / 1000), merged },
        venueId,
      );
    }
  };
  await write(r.engages.prises, true);
  if (r.nouveaux) await write(r.nouveaux.prises, false);

  if (notices.length > 0) {
    if (await isDemoCampaign(tx, campaign.id)) {
      await acceptDemoAllocations(tx, plan.id);
    } else {
      const owners = await tx
        .select({ id: screenhosts.id, ownerId: screenhosts.ownerId })
        .from(screenhosts)
        .where(
          inArray(
            screenhosts.id,
            notices.map((n) => n.screenhostId),
          ),
        );
      const rows = notices.flatMap((n) => {
        const ownerId = owners.find((o) => o.id === n.screenhostId)?.ownerId;
        if (!ownerId) return [];
        return [
          n.merged
            ? {
                userId: ownerId,
                type: 'dispatch_slots_added',
                title: 'Créneaux ajoutés à une campagne',
                body: `La campagne « ${campaign.name} » ajoute des créneaux chez vous : ${montantText(n.montant)} de plus.`,
                campaignId: campaign.id,
              }
            : {
                userId: ownerId,
                type: 'dispatch_pending_acceptance',
                title: 'Campagne en attente de votre acceptation',
                body: `La campagne « ${campaign.name} » vous rapporte ${montantText(n.montant)}. Elle attend votre acceptation.`,
                campaignId: campaign.id,
              },
        ];
      });
      if (rows.length > 0) await tx.insert(notifications).values(rows);
    }
  }
  const placedFact = placedTo.reduce((sum, p) => sum + p.added_fact, 0);
  return { placedFact, nonPlaceFact: Math.max(0, input.volumeFact - placedFact), placedTo };
};
