import { subDays, subMonths } from 'date-fns';
import { and, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  agentAffiliations,
  agentCommissionLines,
  agents,
  campaignDispatchPlan,
  campaigns,
  users,
} from '../db/schema.js';

import type { AgentRole } from './agent-sheet.js';
import { tunisDateOf } from './campaign-dates.js';
import { impressionsObjectif } from './impressions-objectif.js';
import { userLabel } from './user-label.js';

// AGT-4 (Agent Screencaster spec v1.0 §4–§6) — what the Screencaster agent's pages read, one home.
// Every campaign figure is the Screencaster's OWN field (name, dates, status, the « Impressions
// prévues » objective of lib/impressions-objectif) — never recomputed for the agent. Revenue is
// the agent's commission lines (lib/agent-commissions): acquired to date, forecast still open.
// Invariants (spec §5/§6): Σ campaign revenue = Revenus cumulés; Σ affiliate revenue = the same;
// Σ impressions identical across the three pages — they all come from agentCampaigns below.

export type AgentCampaignStatus = 'a_venir' | 'active' | 'terminee';

export interface AgentCampaignView {
  id: string;
  name: string;
  type: 'standard' | 'parc' | 'evenement';
  status: AgentCampaignStatus;
  start_date: string | null;
  end_date: string | null;
  affiliate_id: string;
  affiliate_name: string;
  impressions: number;
  revenue_tnd: number;
  forecast_tnd: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The agent badge: À venir before the start, Active during, Terminée after the end. */
export const agentCampaignStatus = (
  c: { status: string; startDate: string | null; endDate: string | null },
  today: string,
): AgentCampaignStatus => {
  if (c.status === 'completed' || (c.endDate !== null && c.endDate < today)) return 'terminee';
  if (c.startDate !== null && c.startDate > today) return 'a_venir';
  return 'active';
};

const typeOf = (c: { campaignType: string; eventId: string | null }) =>
  c.eventId !== null ? 'evenement' : c.campaignType === 'parc' ? 'parc' : 'standard';

/**
 * The Screencaster agent's campaigns: every confirmed launch (dispatched or an event positioning)
 * of an affiliate inside the affiliation window, plus any campaign that carries one of the
 * agent's commission lines (the carried pre-AGT-3 history included). Drafts, carts and
 * cancelled campaigns never show.
 */
export const agentCampaigns = async (
  agentUserId: string,
  now: Date = new Date(),
): Promise<AgentCampaignView[]> => {
  const today = tunisDateOf(now);
  const affs = await db
    .select()
    .from(agentAffiliations)
    .where(
      and(eq(agentAffiliations.agentUserId, agentUserId), ne(agentAffiliations.status, 'exclue')),
    );
  const lines = await db
    .select()
    .from(agentCommissionLines)
    .where(eq(agentCommissionLines.agentUserId, agentUserId));
  const affiliateIds = [...new Set(affs.map((a) => a.referredUserId))];
  const lineCampaignIds = [...new Set(lines.map((l) => l.campaignId))];
  if (affiliateIds.length === 0 && lineCampaignIds.length === 0) return [];

  const confirmed = sql`(${campaigns.eventId} is not null or exists (select 1 from ${campaignDispatchPlan} where ${campaignDispatchPlan.campaignId} = ${campaigns.id}))`;
  const rows = await db
    .select({ campaign: campaigns, advertiser: users })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.advertiserId))
    .where(
      and(
        inArray(campaigns.status, ['upcoming', 'active', 'completed']),
        eq(users.isDemo, false),
        sql`((${confirmed} and ${affiliateIds.length ? inArray(campaigns.advertiserId, affiliateIds) : sql`false`}) or ${lineCampaignIds.length ? inArray(campaigns.id, lineCampaignIds) : sql`false`})`,
      ),
    );

  const inWindow = (advertiserId: string, start: string | null) =>
    affs.some(
      (a) =>
        a.referredUserId === advertiserId &&
        a.startDate !== null &&
        a.endDate !== null &&
        start !== null &&
        a.startDate <= start &&
        start < a.endDate,
    );

  return rows
    .filter(
      (r) =>
        lineCampaignIds.includes(r.campaign.id) ||
        inWindow(r.campaign.advertiserId, r.campaign.startDate),
    )
    .map(({ campaign: c, advertiser }) => {
      const own = lines.filter((l) => l.campaignId === c.id);
      return {
        id: c.id,
        name: c.name,
        type: typeOf(c),
        status: agentCampaignStatus(c, today),
        start_date: c.startDate,
        end_date: c.endDate,
        affiliate_id: advertiser.id,
        affiliate_name: userLabel(advertiser),
        impressions: impressionsObjectif(c) ?? 0,
        revenue_tnd: round4(
          own
            .filter((l) => l.status === 'acquise')
            .reduce((s, l) => s + Number(l.acquiredTnd ?? 0), 0),
        ),
        forecast_tnd: round4(
          own
            .filter((l) => l.status !== 'annulee')
            .reduce(
              (s, l) => s + Number(l.status === 'acquise' ? l.acquiredTnd : l.forecastTnd),
              0,
            ),
        ),
      } satisfies AgentCampaignView;
    })
    .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''));
};

export interface AgentAffiliateView {
  id: string;
  user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: 'en_attente_activation' | 'en_cours' | 'terminee';
  attached_at: string;
  revenue_tnd: number;
  impressions: number;
}

/** The portfolio: one Screencaster per row, newest first, with what its campaigns brought. */
export const agentScAffiliates = async (
  agentUserId: string,
  campaignsView: AgentCampaignView[],
): Promise<AgentAffiliateView[]> => {
  const rows = await db
    .select({ aff: agentAffiliations, user: users })
    .from(agentAffiliations)
    .innerJoin(users, eq(users.id, agentAffiliations.referredUserId))
    .where(
      and(eq(agentAffiliations.agentUserId, agentUserId), ne(agentAffiliations.status, 'exclue')),
    );
  return rows
    .map(({ aff, user }) => {
      const own = campaignsView.filter((c) => c.affiliate_id === user.id);
      return {
        id: aff.id,
        user_id: user.id,
        name: userLabel(user),
        start_date: aff.startDate,
        end_date: aff.endDate,
        status: aff.status as AgentAffiliateView['status'],
        attached_at: aff.attachedAt.toISOString(),
        revenue_tnd: round4(own.reduce((s, c) => s + c.revenue_tnd, 0)),
        impressions: own.reduce((s, c) => s + c.impressions, 0),
      };
    })
    .sort((a, b) => b.attached_at.localeCompare(a.attached_at));
};

/**
 * The agent's rank among the ACTIVE agents of his type by commission acquired over 90 rolling
 * days; null while he has acquired nothing in the window (the block shows a dash). Only the
 * rank leaves the server — never another agent's name or figure.
 */
export const agentRank = async (
  agentUserId: string,
  role: AgentRole,
  now: Date = new Date(),
): Promise<number | null> => {
  const since = subDays(now, 90);
  const totals = await db
    .select({
      agentUserId: agentCommissionLines.agentUserId,
      total: sql<string>`sum(${agentCommissionLines.acquiredTnd})`,
    })
    .from(agentCommissionLines)
    .innerJoin(agents, eq(agents.userId, agentCommissionLines.agentUserId))
    .where(
      and(
        eq(agentCommissionLines.agentRole, role),
        eq(agentCommissionLines.status, 'acquise'),
        eq(agents.accountStatus, 'actif'),
        gte(agentCommissionLines.acquiredAt, since),
      ),
    )
    .groupBy(agentCommissionLines.agentUserId);
  const mine = Number(totals.find((t) => t.agentUserId === agentUserId)?.total ?? 0);
  if (!(mine > 0)) return null;
  return 1 + totals.filter((t) => Number(t.total) > mine).length;
};

/**
 * Variation between the last 12 months and the 12 before, in %; null (the line is hidden) while
 * the agent has less than 12 months of history or the previous period is empty.
 */
export const variationPct = (
  last12: number,
  previous12: number,
  accountCreatedAt: Date,
  now: Date,
): number | null => {
  if (accountCreatedAt > subMonths(now, 12) || !(previous12 > 0)) return null;
  return Math.round(((last12 - previous12) / previous12) * 1000) / 10;
};

/** Acquired commission in [from, to). */
export const acquiredBetween = async (agentUserId: string, from: Date, to: Date) => {
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${agentCommissionLines.acquiredTnd}), 0)` })
    .from(agentCommissionLines)
    .where(
      and(
        eq(agentCommissionLines.agentUserId, agentUserId),
        eq(agentCommissionLines.status, 'acquise'),
        gte(agentCommissionLines.acquiredAt, from),
        lt(agentCommissionLines.acquiredAt, to),
      ),
    );
  return Number(r?.total ?? 0);
};
