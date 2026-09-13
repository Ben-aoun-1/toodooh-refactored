import { fromZonedTime } from 'date-fns-tz';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import {
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  proofOfPlay,
  recharges,
  screenhostAffluenceHourly,
  screenhosts,
  screens,
} from '../../db/schema.js';
import { isOpenAt } from '../../lib/opening-hours.js';

import { TZ, type VirtualMoment, advance, momentOf } from './clock.js';

// SIM-3 — everything the living-world board renders, in ONE read: where the clock is, which
// screens are lit, what each venue is playing this very hour, what its sensors just measured,
// and where the campaigns and the money stand. Read-only; the page polls it between ticks.

/** A screen counts as lit when its last heartbeat is within the redispatch tolerance (12 min). */
const LIVENESS_TOLERANCE_MS = 12 * 60 * 1000;

export interface VenueState {
  id: string;
  name: string;
  sector: string | null;
  class: string | null;
  sps: number;
  open: boolean;
  screens: { id: string; online: boolean }[];
  audience_now: number | null;
  airing: { campaign_id: string; name: string; reps: number }[];
  pending: number;
  accepted: number;
  refused: number;
  proofs_today: number;
}

export interface SimulationState {
  clock: { at: string; date: string; hour: number };
  venues: VenueState[];
  campaigns: {
    id: string;
    name: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    budget_tnd: number | null;
    allocations: number;
    accepted: number;
    refused: number;
    pending: number;
    proofs: number;
  }[];
  totals: {
    venues: number;
    screens_online: number;
    screens_total: number;
    airing_now: number;
    audience_now: number;
    proofs_today: number;
    wallet_credited_tnd: number;
    pending_proposals: number;
  };
}

export const simulationState = async (moment: VirtualMoment): Promise<SimulationState> => {
  const venueRows = await db
    .select({
      id: screenhosts.id,
      name: screenhosts.name,
      sector: businessSectors.name,
      class: screenhosts.class,
      sps: screenhosts.sps,
      openingHour: screenhosts.openingHour,
      closingHour: screenhosts.closingHour,
    })
    .from(screenhosts)
    .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId))
    .where(eq(screenhosts.isActive, true))
    .orderBy(screenhosts.name);
  const venueIds = venueRows.map((v) => v.id);
  if (venueIds.length === 0) {
    return {
      clock: { at: moment.at.toISOString(), date: moment.date, hour: moment.hour },
      venues: [],
      campaigns: [],
      totals: {
        venues: 0,
        screens_online: 0,
        screens_total: 0,
        airing_now: 0,
        audience_now: 0,
        proofs_today: 0,
        wallet_credited_tnd: 0,
        pending_proposals: 0,
      },
    };
  }

  const screenRows = await db
    .select({ id: screens.id, screenhostId: screens.screenhostId, lastSeenAt: screens.lastSeenAt })
    .from(screens)
    .where(inArray(screens.screenhostId, venueIds));

  // The clock stands at the hour ABOUT to be simulated, which no sensor has measured yet — the
  // board therefore shows the last COMPLETED hour's footfall, the only one that exists.
  const measured = momentOf(advance(moment.at, -1));
  const audienceRows = await db
    .select({
      screenhostId: screenhostAffluenceHourly.screenhostId,
      value: screenhostAffluenceHourly.value,
    })
    .from(screenhostAffluenceHourly)
    .where(
      and(
        eq(screenhostAffluenceHourly.date, measured.date),
        eq(screenhostAffluenceHourly.slot, measured.hour * 2),
        inArray(screenhostAffluenceHourly.screenhostId, venueIds),
      ),
    );
  const audienceOf = new Map(audienceRows.map((r) => [r.screenhostId, r.value]));

  const allocationRows = await db
    .select({
      screenhostId: campaignDispatchAllocation.screenhostId,
      statut: campaignDispatchAllocation.statutAcceptation,
      creneaux: campaignDispatchAllocation.creneaux,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignStatus: campaigns.status,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .innerJoin(campaigns, eq(campaigns.id, campaignDispatchPlan.campaignId));

  // Two different questions: a venue shows TODAY's diffusions (the Tunis day, not a UTC one — an
  // 01h spot belongs to the night that is still running), a campaign shows its total since launch.
  const dayStart = fromZonedTime(`${moment.date}T00:00:00`, TZ);
  const venueProofRows = await db
    .select({ screenhostId: proofOfPlay.screenhostId, n: sql<number>`count(*)::int` })
    .from(proofOfPlay)
    .where(gte(proofOfPlay.receivedAt, dayStart))
    .groupBy(proofOfPlay.screenhostId);
  const campaignProofRows = await db
    .select({ campaignId: proofOfPlay.campaignId, n: sql<number>`count(*)::int` })
    .from(proofOfPlay)
    .groupBy(proofOfPlay.campaignId);
  const proofsByVenue = new Map(venueProofRows.map((r) => [r.screenhostId, r.n]));
  const proofsByCampaign = new Map(campaignProofRows.map((r) => [r.campaignId, r.n]));

  const venues: VenueState[] = venueRows.map((venue) => {
    const mine = allocationRows.filter((a) => a.screenhostId === venue.id);
    const airing = mine
      .filter((a) => a.statut === 'ACCEPTE' && a.campaignStatus === 'active')
      .flatMap((a) => {
        const slot = a.creneaux.find((c) => c.date === moment.date && c.hour === moment.hour);
        return slot ? [{ campaign_id: a.campaignId, name: a.campaignName, reps: slot.reps }] : [];
      });
    return {
      id: venue.id,
      name: venue.name,
      sector: venue.sector,
      class: venue.class,
      sps: Number(venue.sps),
      open: isOpenAt(moment.hour, venue.openingHour, venue.closingHour),
      screens: screenRows
        .filter((s) => s.screenhostId === venue.id)
        .map((s) => ({
          id: s.id,
          online:
            s.lastSeenAt !== null &&
            moment.at.getTime() - s.lastSeenAt.getTime() <= LIVENESS_TOLERANCE_MS,
        })),
      audience_now: audienceOf.get(venue.id) ?? null,
      airing,
      pending: mine.filter((a) => a.statut === 'EN_ATTENTE').length,
      accepted: mine.filter((a) => a.statut === 'ACCEPTE').length,
      refused: mine.filter((a) => a.statut === 'REFUSE').length,
      proofs_today: proofsByVenue.get(venue.id) ?? 0,
    };
  });

  const campaignRows = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      budget: campaigns.requestedBudget,
    })
    .from(campaigns)
    .orderBy(campaigns.createdAt);

  const [wallet] = await db
    .select({ total: sql<string>`coalesce(sum(${recharges.amountTnd}), 0)` })
    .from(recharges)
    .where(eq(recharges.status, 'confirmed'));

  return {
    clock: { at: moment.at.toISOString(), date: moment.date, hour: moment.hour },
    venues,
    campaigns: campaignRows.map((c) => {
      const mine = allocationRows.filter((a) => a.campaignId === c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        start_date: c.startDate,
        end_date: c.endDate,
        budget_tnd: c.budget === null ? null : Number(c.budget),
        allocations: mine.length,
        accepted: mine.filter((a) => a.statut === 'ACCEPTE').length,
        refused: mine.filter((a) => a.statut === 'REFUSE').length,
        pending: mine.filter((a) => a.statut === 'EN_ATTENTE').length,
        proofs: proofsByCampaign.get(c.id) ?? 0,
      };
    }),
    totals: {
      venues: venues.length,
      screens_online: venues.reduce((n, v) => n + v.screens.filter((s) => s.online).length, 0),
      screens_total: screenRows.length,
      airing_now: venues.filter((v) => v.airing.length > 0).length,
      audience_now: venues.reduce((n, v) => n + (v.audience_now ?? 0), 0),
      proofs_today: [...proofsByVenue.values()].reduce((a, b) => a + b, 0),
      wallet_credited_tnd: Number(wallet?.total ?? 0),
      pending_proposals: venues.reduce((n, v) => n + v.pending, 0),
    },
  };
};
