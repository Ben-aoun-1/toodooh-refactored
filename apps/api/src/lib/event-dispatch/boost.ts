import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  campaignBoosts,
  campaignZones,
  campaigns,
  eventAllocations,
  events,
  notifications,
  screenhosts,
  zones,
} from '../../db/schema.js';
import { MIN_CAMPAIGN_BUDGET_TND } from '../campaign-budget.js';
import { campaignCpmRates } from '../dispatch/config.js';
import { computeEventCmax } from '../event-pricing/pricing.js';
import { walletSpendable } from '../recharges.js';

import {
  EVENT_PROPOSAL_TITLE,
  type EventPoolVenue,
  assembleEventPool,
  eventProposalBody,
  fillEventBlocs,
  reserveBlocHours,
} from './dispatch.js';

// EV6 (flow §7) — THE EVENT BOOSTER: extend a live positioning on ONE axis, ZONES ONLY. The spot,
// the categories and the diffusion window are FROZEN by the match — they are the event's, not the
// advertiser's, so the booster never offers them (unlike CF-B1's campaign boost, whose three axes
// include the end date). The complementary budget dispatches over the ADDED perimeter under EV4's
// bloc rules: same pool assembly, same D2 order, same D3/D4 fill, same reservations, same §11.1
// owner proposals — all CONSUMED here, never re-implemented.
//
// ⚠️ SURFACED AT CF-9 (the zone-axis weight): EV2/EV4's event engine has never filtered its pool
// by zone — computeEventCmax and assembleEventPool read every active event-eligible venue, and
// EV3's récap says so out loud (« tous les lieux éligibles diffusent pendant la fenêtre »). So an
// added zone does NOT widen the ceiling; what it does — and what this module implements, the
// charter's literal « dispatches over the ADDED perimeter » — is CONSTRAIN where the complementary
// budget lands: the boost fill runs over venues in the added zones only, minus the ones this
// positioning already holds. Nothing existing reprices; the deeper question (should zones filter
// event PRICING at all?) is the CF-9's watch-item.

export type EventBoostRefusal =
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_POSITIONING' }
  | { status: 'NOT_BOOSTABLE'; currentStatus: string }
  | { status: 'EVENT_ANNULE' }
  | { status: 'NO_ADDITION' }
  | { status: 'ZONE_NOT_FOUND'; zoneId: string }
  | { status: 'ZONE_ALREADY_TARGETED'; zoneId: string }
  | { status: 'BUDGET_BELOW_MINIMUM'; floorTnd: number }
  | { status: 'BUDGET_EXCEEDS_CMAX'; cMaxEvtTnd: number }
  | { status: 'INSUFFICIENT_BALANCE'; requiredTnd: number; availableTnd: number }
  | { status: 'NO_ELIGIBLE' }
  | { status: 'NMAX_EXCEEDED'; nMax: number };

export interface EventBoostPreview {
  status: 'PREVIEW';
  cMaxEvtTnd: number;
  eligibleCount: number;
}

export interface EventBoostApplied {
  status: 'APPLIED';
  boostId: string;
  amountTnd: number;
  placedVenues: number;
  placedImpressions: number;
  partial: boolean;
}

/** The statuses a positioning can be boosted in (flow §7: À venir / Active). */
const BOOSTABLE = new Set(['upcoming', 'active']);

interface LoadedPositioning {
  campaign: typeof campaigns.$inferSelect;
  event: typeof events.$inferSelect;
}

const loadPositioning = async (
  campaignId: string,
  advertiserId: string,
): Promise<LoadedPositioning | null> => {
  const [row] = await db
    .select({ campaign: campaigns, event: events })
    .from(campaigns)
    .innerJoin(events, eq(campaigns.eventId, events.id))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.advertiserId, advertiserId)))
    .limit(1);
  return row ?? null;
};

/**
 * Validate the shared gates of both routes. Returns the loaded rows + the resolved additions,
 * or the precise refusal.
 */
const gate = async (
  campaignId: string,
  advertiserId: string,
  addedZoneIds: readonly string[],
): Promise<
  | { ok: true; loaded: LoadedPositioning; additions: string[]; currentZoneIds: string[] }
  | { ok: false; refusal: EventBoostRefusal }
> => {
  const loaded = await loadPositioning(campaignId, advertiserId);
  if (!loaded) return { ok: false, refusal: { status: 'NOT_FOUND' } };
  // A classic campaign boosts through CF-B1's route; this one is positioning-only.
  if (loaded.campaign.eventId === null) {
    return { ok: false, refusal: { status: 'NOT_POSITIONING' } };
  }
  if (!BOOSTABLE.has(loaded.campaign.status)) {
    return {
      ok: false,
      refusal: { status: 'NOT_BOOSTABLE', currentStatus: loaded.campaign.status },
    };
  }
  if (loaded.event.annule) return { ok: false, refusal: { status: 'EVENT_ANNULE' } };

  const currentRows = await db
    .select({ zoneId: campaignZones.zoneId })
    .from(campaignZones)
    .where(eq(campaignZones.campaignId, campaignId));
  const currentZoneIds = currentRows.map((r) => r.zoneId);
  const current = new Set(currentZoneIds);
  const additions = [...new Set(addedZoneIds)];
  if (additions.length === 0) return { ok: false, refusal: { status: 'NO_ADDITION' } };
  for (const zoneId of additions) {
    if (current.has(zoneId)) {
      return { ok: false, refusal: { status: 'ZONE_ALREADY_TARGETED', zoneId } };
    }
  }
  const known = await db
    .select({ id: zones.id })
    .from(zones)
    .where(and(inArray(zones.id, additions), eq(zones.active, true)));
  const knownIds = new Set(known.map((z) => z.id));
  for (const zoneId of additions) {
    if (!knownIds.has(zoneId)) return { ok: false, refusal: { status: 'ZONE_NOT_FOUND', zoneId } };
  }
  return { ok: true, loaded, additions, currentZoneIds };
};

/**
 * The complementary ceiling: EV2's event C_max with this positioning's OWN placed value already
 * engaged — what is still buyable on top of what it holds. (EV4's charge cap means the placed
 * montants ARE the engaged value.) CPM-1 — priced at the positioning's own event CPM.
 */
const complementaryCeiling = async (
  loaded: LoadedPositioning,
): Promise<{ cMaxEvtTnd: number; eligibleCount: number }> => {
  const full = await computeEventCmax(
    {
      id: loaded.event.id,
      kickoffAt: loaded.event.kickoffAt,
      endsAt: loaded.event.endsAt,
    },
    campaignCpmRates(loaded.campaign).eventCpmTnd,
  );
  const own = await db
    .select({ montantTnd: eventAllocations.montantTnd, statut: eventAllocations.statut })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, loaded.campaign.id));
  // Only LIVE allocations (EN_ATTENTE / ACCEPTE) hold inventory; a REFUSE released its blocs.
  const engagedTnd = own
    .filter((a) => a.statut !== 'REFUSE')
    .reduce((sum, a) => sum + Number(a.montantTnd), 0);
  return {
    cMaxEvtTnd: Math.max(0, Math.round((full.cMaxEvtTnd - engagedTnd) * 1000) / 1000),
    eligibleCount: full.eligibleCount,
  };
};

/** The ADDED perimeter: pool venues sitting in the added zones, minus the ones already held. */
const addedPerimeter = async (
  loaded: LoadedPositioning,
  additions: readonly string[],
): Promise<EventPoolVenue[]> => {
  const held = await db
    .select({ screenhostId: eventAllocations.screenhostId })
    .from(eventAllocations)
    .where(eq(eventAllocations.campaignId, loaded.campaign.id));
  const pool = await assembleEventPool(
    { id: loaded.event.id, kickoffAt: loaded.event.kickoffAt, endsAt: loaded.event.endsAt },
    new Set(held.map((h) => h.screenhostId)),
  );
  if (pool.length === 0) return [];
  const inAddedZones = await db
    .select({ id: screenhosts.id })
    .from(screenhosts)
    .where(
      and(
        inArray(
          screenhosts.id,
          pool.map((p) => p.screenhostId),
        ),
        inArray(screenhosts.zoneId, [...additions]),
      ),
    );
  const allowed = new Set(inAddedZones.map((s) => s.id));
  return pool.filter((p) => allowed.has(p.screenhostId));
};

/** The preview: the complementary ceiling over the hypothetical merged zone set. Persists NOTHING. */
export const previewEventBoost = async (
  campaignId: string,
  advertiserId: string,
  addedZoneIds: readonly string[],
): Promise<EventBoostPreview | EventBoostRefusal> => {
  const gated = await gate(campaignId, advertiserId, addedZoneIds);
  if (!gated.ok) return gated.refusal;
  const ceiling = await complementaryCeiling(gated.loaded);
  const perimeter = await addedPerimeter(gated.loaded, gated.additions);
  return {
    status: 'PREVIEW',
    cMaxEvtTnd: ceiling.cMaxEvtTnd,
    // What the added zones actually bring: the venues the complementary budget can land on.
    eligibleCount: perimeter.length,
  };
};

/**
 * The apply: ONE transaction appending the zones, raising the engaged budget, dispatching the
 * complementary I_cible over the added perimeter (EV4's fill), writing the reservations, the owner
 * proposals and the audit row. Any refusal happens BEFORE the transaction — nothing persists.
 */
export const applyEventBoost = async (
  campaignId: string,
  advertiserId: string,
  input: { addedZoneIds: readonly string[]; amountTnd: number },
): Promise<EventBoostApplied | EventBoostRefusal> => {
  const gated = await gate(campaignId, advertiserId, input.addedZoneIds);
  if (!gated.ok) return gated.refusal;
  const { loaded, additions } = gated;

  if (input.amountTnd < MIN_CAMPAIGN_BUDGET_TND) {
    return { status: 'BUDGET_BELOW_MINIMUM', floorTnd: MIN_CAMPAIGN_BUDGET_TND };
  }
  const ceiling = await complementaryCeiling(loaded);
  if (input.amountTnd > ceiling.cMaxEvtTnd) {
    return { status: 'BUDGET_EXCEEDS_CMAX', cMaxEvtTnd: ceiling.cMaxEvtTnd };
  }
  // FIX2 — SPENDABLE (no exclusion: the positioning's own budget stays engaged; the boost is on top).
  const balance = (await walletSpendable(advertiserId)).spendable_tnd;
  if (balance < input.amountTnd) {
    return { status: 'INSUFFICIENT_BALANCE', requiredTnd: input.amountTnd, availableTnd: balance };
  }

  const perimeter = await addedPerimeter(loaded, additions);
  if (perimeter.length === 0) return { status: 'NO_ELIGIBLE' };

  // The complementary fill: EV4's rules over the added perimeter, budgeted by the top-up alone.
  // N_max is derived from the COMPLEMENTARY budget (this is a new placement decision of its own).
  // CPM-1 — a boost extends an EXISTING positioning: it prices at the positioning's own event CPM.
  const fill = fillEventBlocs(
    perimeter,
    input.amountTnd,
    campaignCpmRates(loaded.campaign).eventCpmTnd,
  );
  if (fill.status === 'NMAX_EXCEEDED') return { status: 'NMAX_EXCEEDED', nMax: fill.nMax };
  if (fill.status === 'NO_POOL') return { status: 'NO_ELIGIBLE' };

  const applied = await db.transaction(async (tx) => {
    // MERGE SEMANTICS: the added perimeter EXCLUDES venues this positioning already holds, so a
    // boost never mutates an existing allocation — every placement is a NEW row awaiting its own
    // owner decision. (A held venue keeps exactly the blocs its owner accepted.)
    await tx
      .insert(campaignZones)
      .values(additions.map((zoneId) => ({ campaignId, zoneId })))
      .onConflictDoNothing();
    await tx
      .update(campaigns)
      .set({
        requestedBudget: String(
          Math.round((Number(loaded.campaign.requestedBudget ?? 0) + input.amountTnd) * 1000) /
            1000,
        ),
      })
      .where(eq(campaigns.id, campaignId));

    const owners = new Set<string>();
    let placedImpressions = 0;
    for (const placement of fill.placements) {
      await tx.insert(eventAllocations).values({
        campaignId,
        screenhostId: placement.screenhostId,
        blocs: placement.blocs,
        impressionsTotal: placement.impressionsTotal,
        montantTnd: placement.montantTnd.toFixed(3),
        statut: 'EN_ATTENTE',
      });
      await reserveBlocHours(tx, loaded.event.id, placement.screenhostId, placement.blocs);
      owners.add(placement.ownerId);
      placedImpressions += placement.impressionsTotal;
    }
    if (owners.size > 0) {
      await tx.insert(notifications).values(
        [...owners].map((ownerId) => ({
          userId: ownerId,
          type: 'dispatch_pending_acceptance',
          title: EVENT_PROPOSAL_TITLE,
          body: eventProposalBody(loaded.campaign.name),
          campaignId,
        })),
      );
    }

    // The audit row REUSES campaign_boosts as-is (no migration): the event boost has no date
    // move, so previous/new end date both record the positioning's frozen window end and the
    // category axis stays empty — the zones axis and the amount are the whole story.
    const [audit] = await tx
      .insert(campaignBoosts)
      .values({
        campaignId,
        amountTnd: input.amountTnd.toFixed(2),
        previousEndDate: loaded.campaign.endDate ?? '1970-01-01',
        newEndDate: loaded.campaign.endDate ?? '1970-01-01',
        addedZoneIds: [...additions],
        addedCategoryIds: [],
        placedFact: placedImpressions,
        appliedBy: advertiserId,
      })
      .returning({ id: campaignBoosts.id });
    return {
      boostId: audit?.id ?? '',
      placedVenues: fill.placements.length,
      placedImpressions,
      partial: fill.partial,
    };
  });

  return {
    status: 'APPLIED',
    boostId: applied.boostId,
    amountTnd: input.amountTnd,
    placedVenues: applied.placedVenues,
    placedImpressions: applied.placedImpressions,
    partial: applied.partial,
  };
};
