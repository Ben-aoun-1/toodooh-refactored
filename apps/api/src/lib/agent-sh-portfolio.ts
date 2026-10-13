import { and, eq, inArray, ne } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agentCommissionLines,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignScreenhostPayout,
  campaigns,
  eventAllocations,
  screenhosts,
  users,
} from '../db/schema.js';

import { agentCampaignStatus, type AgentCampaignStatus } from './agent-portfolio.js';
import { snapshotOn } from './agent-sh-followup.js';
import { tunisDateOf } from './campaign-dates.js';
import { displayImpressionsInFlight, displayImpressionsSettled } from './impressions-display.js';
import { loadDeliveredSlots } from './reconcile/delivered-slots.js';
import { userLabel } from './user-label.js';

// AGT-7 (Agent Screenhost spec v1.0 §4–§6) — what the Screenhost agent's pages read, one home.
// A campaign enters the list when an affiliated venue ACCEPTS its offer; every per-venue figure is
// the one that venue's owner sees (lib/impressions-display: settled = delivered, in flight =
// prédites − perdues; an event, its planned impressions until it settles). Revenue is the agent's
// commission lines. No venue outside the portfolio, no budget, no campaign total ever leaves.

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface ShVenueImpressions {
  id: string;
  name: string;
  impressions: number;
}

export interface ShAgentCampaignView {
  id: string;
  name: string;
  type: 'standard' | 'evenement';
  status: AgentCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  advertiser_name: string;
  venues: ShVenueImpressions[];
  venues_touched: number;
  impressions: number;
  revenue_tnd: number;
  forecast_tnd: number;
}

/** The agent's portfolio venues (an excluded or reassigned one is gone). */
const portfolio = (agentUserId: string) =>
  db
    .select({ aff: agentAffiliations, venue: screenhosts, category: businessSectors.name })
    .from(agentAffiliations)
    .innerJoin(screenhosts, eq(screenhosts.id, agentAffiliations.screenhostId))
    .leftJoin(businessSectors, eq(businessSectors.id, screenhosts.businessSectorId))
    .where(
      and(eq(agentAffiliations.agentUserId, agentUserId), ne(agentAffiliations.status, 'exclue')),
    );

export const shAgentCampaigns = async (
  agentUserId: string,
  now: Date = new Date(),
): Promise<ShAgentCampaignView[]> => {
  const today = tunisDateOf(now);
  const venues = await portfolio(agentUserId);
  const venueIds = venues.map((v) => v.venue.id);
  if (venueIds.length === 0) return [];
  const venueName = new Map(venues.map((v) => [v.venue.id, v.venue.name]));

  const std = await db
    .select({ a: campaignDispatchAllocation, campaignId: campaignDispatchPlan.campaignId })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId))
    .where(
      and(
        inArray(campaignDispatchAllocation.screenhostId, venueIds),
        eq(campaignDispatchAllocation.statutAcceptation, 'ACCEPTE'),
      ),
    );
  const evt = await db
    .select()
    .from(eventAllocations)
    .where(
      and(inArray(eventAllocations.screenhostId, venueIds), eq(eventAllocations.statut, 'ACCEPTE')),
    );
  const campaignIds = [
    ...new Set([...std.map((s) => s.campaignId), ...evt.map((e) => e.campaignId)]),
  ];
  if (campaignIds.length === 0) return [];

  const rows = await db
    .select({ campaign: campaigns, advertiser: users })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.advertiserId))
    .where(
      and(
        inArray(campaigns.id, campaignIds),
        inArray(campaigns.status, ['upcoming', 'active', 'completed']),
        eq(users.isDemo, false),
      ),
    );
  const payouts = await db
    .select()
    .from(campaignScreenhostPayout)
    .where(
      and(
        inArray(campaignScreenhostPayout.campaignId, campaignIds),
        inArray(campaignScreenhostPayout.screenhostId, venueIds),
      ),
    );
  const lines = await db
    .select()
    .from(agentCommissionLines)
    .where(eq(agentCommissionLines.agentUserId, agentUserId));

  const out: ShAgentCampaignView[] = [];
  for (const { campaign: c, advertiser } of rows) {
    const settled = (shId: string) =>
      payouts.find((p) => p.campaignId === c.id && p.screenhostId === shId);
    const perVenue: ShVenueImpressions[] = [];
    const stdHere = std.filter((s) => s.campaignId === c.id).map((s) => s.a);
    if (stdHere.length > 0) {
      const delivered = await loadDeliveredSlots(c.id);
      const flight = displayImpressionsInFlight(stdHere, delivered, now);
      for (const f of flight) {
        const p = settled(f.screenhostId);
        perVenue.push({
          id: f.screenhostId,
          name: venueName.get(f.screenhostId) ?? 'Screenhost',
          impressions: p ? displayImpressionsSettled(p) : f.displayImp,
        });
      }
    }
    for (const e of evt.filter((x) => x.campaignId === c.id)) {
      const p = settled(e.screenhostId);
      perVenue.push({
        id: e.screenhostId,
        name: venueName.get(e.screenhostId) ?? 'Screenhost',
        impressions: p ? displayImpressionsSettled(p) : e.impressionsTotal,
      });
    }
    const own = lines.filter((l) => l.campaignId === c.id);
    out.push({
      id: c.id,
      name: c.name,
      type: c.eventId ? 'evenement' : 'standard',
      status: agentCampaignStatus(c, today),
      start_date: c.startDate,
      end_date: c.endDate,
      advertiser_name: userLabel(advertiser),
      venues: perVenue,
      venues_touched: perVenue.length,
      impressions: perVenue.reduce((s, v) => s + v.impressions, 0),
      revenue_tnd: round4(
        own
          .filter((l) => l.status === 'acquise')
          .reduce((s, l) => s + Number(l.acquiredTnd ?? 0), 0),
      ),
      forecast_tnd: round4(
        own
          .filter((l) => l.status !== 'annulee')
          .reduce((s, l) => s + Number(l.status === 'acquise' ? l.acquiredTnd : l.forecastTnd), 0),
      ),
    });
  }
  return out.sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));
};

export interface ShAffiliateView {
  id: string;
  screenhost_id: string;
  name: string;
  category: string | null;
  address: string | null;
  status: 'en_attente_activation' | 'en_cours' | 'terminee';
  start_date: string | null;
  end_date: string | null;
  attached_at: string;
  exploited_by_agent: boolean;
  revenue_tnd: number;
  impressions: number;
  attention: string[];
}

/** The portfolio, newest first; revenue is always the AGENT's commission on the venue. */
export const shAgentAffiliates = async (
  agentUserId: string,
  campaignsView: ShAgentCampaignView[],
  now: Date = new Date(),
): Promise<ShAffiliateView[]> => {
  const venues = await portfolio(agentUserId);
  const lines = await db
    .select()
    .from(agentCommissionLines)
    .where(
      and(
        eq(agentCommissionLines.agentUserId, agentUserId),
        eq(agentCommissionLines.status, 'acquise'),
      ),
    );
  const today = tunisDateOf(now);
  const out: ShAffiliateView[] = [];
  for (const { aff, venue, category } of venues) {
    const live = aff.status === 'en_cours' || aff.status === 'en_attente_activation';
    const snap = live ? await snapshotOn(venue.id, today) : null;
    out.push({
      id: aff.id,
      screenhost_id: venue.id,
      name: venue.name,
      category,
      address: [venue.address, venue.city].filter(Boolean).join(', ') || null,
      status: aff.status as ShAffiliateView['status'],
      start_date: aff.startDate,
      end_date: aff.endDate,
      attached_at: aff.attachedAt.toISOString(),
      exploited_by_agent: aff.exploitedByAgent,
      revenue_tnd: round4(
        lines
          .filter((l) => l.screenhostId === venue.id)
          .reduce((s, l) => s + Number(l.acquiredTnd ?? 0), 0),
      ),
      impressions: campaignsView.reduce(
        (s, c) => s + (c.venues.find((v) => v.id === venue.id)?.impressions ?? 0),
        0,
      ),
      attention: snap?.signals ?? [],
    });
  }
  return out.sort((a, b) => b.attached_at.localeCompare(a.attached_at));
};
