import { and, inArray, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  campaignDispatchAllocation,
  campaignDispatchPlan,
  eventAllocations,
} from '../db/schema.js';

import { predictedImpressionsOf } from './impressions-display.js';

// IMP-UNIT1 (operator ruling B, 2026-09-22) — THE post-dispatch « Impressions prévues » read, for
// one campaign or a whole list. « We are talking about real audience not billable, because
// billable is real × T »: the advertiser-facing figure is PHYSICAL impressions on BOTH sides of
// dispatch — before, IMP-EST1's dry-run (lib/impressions-estimate.ts); after, this read. The sum
// itself is NET-IMP1's own home (lib/impressions-display.ts predictedImpressionsOf), so
// « prédites », the estimate and « prévues » can never drift apart.
//
// It used to be Σ campaign_dispatch_allocation.ii_potentiel — a_i, the FACTURABLE allocation
// (physical × T, T = 0.60 / 0.70 / 0.80), counting REFUSE allocations. The same label therefore
// dropped by ~T the moment the campaign was dispatched (16 000 → ~10 000 on the reported fixture)
// and double-counted a venue whose refusal the cascade had already re-placed elsewhere.
//
// DISPLAY ONLY. The facturable arithmetic is untouched everywhere it means money: ii_potentiel
// still drives revenu_prévisionnel, the reversement rail, the invoices and C_max.
//
// A REFUSE allocation never airs, so it is out of the figure — but the campaign is still
// DISPATCHED: a plan (or an event allocation row, whatever its statut) means « the plan is
// frozen », and the answer is that plan's figure, 0 included. Absent from the map = not dispatched
// yet, and the caller falls back to the dry-run estimate (or « — » on a list endpoint, which never
// fans dry-runs out).

export interface PlannedPrevues {
  /** PHYSICAL impressions: Σ créneau.impressions (classic) / Σ impressions_total (event). */
  impressions: number;
  /** The venues the frozen plan actually airs on — REFUSE excluded. */
  venuesCount: number;
}

const EMPTY: PlannedPrevues = { impressions: 0, venuesCount: 0 };

const add = (out: Map<string, PlannedPrevues>, campaignId: string, impressions: number): void => {
  const current = out.get(campaignId) ?? EMPTY;
  out.set(campaignId, {
    impressions: current.impressions + impressions,
    venuesCount: current.venuesCount + 1,
  });
};

/**
 * The CLASSIC frozen plan's « prévues », per campaign id. A campaign has at most one plan
 * (`campaign_dispatch_plan_campaign_uq`), so the per-campaign read and this batched one can never
 * disagree on which plan they mean.
 */
export const planPrevuesByCampaign = async (
  campaignIds: readonly string[],
): Promise<Map<string, PlannedPrevues>> => {
  const out = new Map<string, PlannedPrevues>();
  if (campaignIds.length === 0) return out;
  const plans = await db
    .select({ id: campaignDispatchPlan.id, campaignId: campaignDispatchPlan.campaignId })
    .from(campaignDispatchPlan)
    .where(inArray(campaignDispatchPlan.campaignId, [...campaignIds]));
  if (plans.length === 0) return out;
  // A frozen plan HAS its figure, even when every allocation was refused (0, not « no plan »).
  for (const p of plans) out.set(p.campaignId, EMPTY);
  const campaignByPlan = new Map(plans.map((p) => [p.id, p.campaignId]));
  const allocations = await db
    .select({
      planId: campaignDispatchAllocation.planId,
      creneaux: campaignDispatchAllocation.creneaux,
    })
    .from(campaignDispatchAllocation)
    .where(
      and(
        inArray(
          campaignDispatchAllocation.planId,
          plans.map((p) => p.id),
        ),
        ne(campaignDispatchAllocation.statutAcceptation, 'REFUSE'),
      ),
    );
  for (const a of allocations) {
    const campaignId = campaignByPlan.get(a.planId);
    if (campaignId !== undefined) add(out, campaignId, predictedImpressionsOf(a));
  }
  return out;
};

/**
 * THE rule for an EVENT positioning's « prévues », over rows already in hand: Σ
 * event_allocations.impressions_total across the non-REFUSE rows (EV4 places whole 20-min blocs of
 * A_max × 20 — already physical, no T anywhere). Pure, so every surface that prints « impressions
 * prévues » for a positioning — GET /api/campaigns/mine and the Consulter drawer's own placement
 * block, GET /api/campaigns/:id/event-allocations — reads the same figure from the same rows. They
 * sit in ONE drawer side by side; they used to be equal only by construction, and a single refused
 * venue was enough to make them contradict each other.
 */
export const eventPrevuesOf = (
  rows: readonly { statut: string; impressionsTotal: number }[],
): PlannedPrevues =>
  rows.reduce<PlannedPrevues>(
    (acc, r) =>
      r.statut === 'REFUSE'
        ? acc
        : { impressions: acc.impressions + r.impressionsTotal, venuesCount: acc.venuesCount + 1 },
    EMPTY,
  );

/**
 * An EVENT positioning's « prévues », per campaign id — `eventPrevuesOf` over the campaign's rows.
 * ONE row of any statut means the positioning is dispatched (a wholly refused positioning answers
 * 0, never « no plan »).
 */
export const eventPrevuesByCampaign = async (
  campaignIds: readonly string[],
): Promise<Map<string, PlannedPrevues>> => {
  const out = new Map<string, PlannedPrevues>();
  if (campaignIds.length === 0) return out;
  const rows = await db
    .select({
      campaignId: eventAllocations.campaignId,
      statut: eventAllocations.statut,
      impressionsTotal: eventAllocations.impressionsTotal,
    })
    .from(eventAllocations)
    .where(inArray(eventAllocations.campaignId, [...campaignIds]));
  const byCampaign = new Map<string, { statut: string; impressionsTotal: number }[]>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaignId) ?? [];
    list.push({ statut: r.statut, impressionsTotal: r.impressionsTotal });
    byCampaign.set(r.campaignId, list);
  }
  for (const [campaignId, campaignRows] of byCampaign) {
    out.set(campaignId, eventPrevuesOf(campaignRows));
  }
  return out;
};

/**
 * « Prévues » for a set of campaigns, whichever engine dispatched them. A campaign has EITHER a
 * dispatch plan OR event allocations, never both; the plan wins if it ever did.
 */
export const plannedPrevuesByCampaign = async (
  campaignIds: readonly string[],
): Promise<Map<string, PlannedPrevues>> => {
  const [classic, event] = await Promise.all([
    planPrevuesByCampaign(campaignIds),
    eventPrevuesByCampaign(campaignIds),
  ]);
  for (const [campaignId, prevues] of event) {
    if (!classic.has(campaignId)) classic.set(campaignId, prevues);
  }
  return classic;
};
