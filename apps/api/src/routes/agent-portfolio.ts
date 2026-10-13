import { subMonths } from 'date-fns';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../db/client.js';
import { agents, users } from '../db/schema.js';
import {
  acquiredBetween,
  agentCampaigns,
  agentRank,
  agentScAffiliates,
  variationPct,
} from '../lib/agent-portfolio.js';
import { shAgentAffiliates, shAgentCampaigns } from '../lib/agent-sh-portfolio.js';
import { isAgentRole } from '../lib/agent-sheet.js';
import { agentWallet } from '../lib/agent-wallet.js';
import { requireAuth, requireRole } from '../middleware/require-auth.js';

import { agentCgeGate } from './agent-account.js';

// AGT-4 (Agent Screencaster spec v1.0 §4–§6) — the Screencaster agent's Dashboard, « Mes
// campagnes affiliées » and « Mes Screencasters affiliés ». Read-only, the caller's own data
// only, behind the CGE gate. No CPM, no split key, no Screenhost identity ever leaves (§13).

const scGuard = {
  preHandler: [requireAuth, requireRole('screencast_agent', 'screenhost_agent'), agentCgeGate],
};
const isSh = (role: string | undefined) => role === 'screenhost_agent';

export const agentPortfolioRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/agent/dashboard — the ten blocks' data (appointments + notifications come from
  // their own endpoints).
  app.get('/api/agent/dashboard', scGuard, async (request, reply) => {
    const id = request.user?.id ?? '';
    const role = request.user?.role;
    if (!isAgentRole(role)) return reply.status(403).send({ error: 'FORBIDDEN', message: '—' });
    const now = new Date();
    const [me] = await db
      .select({ code: agents.code, createdAt: users.createdAt })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.userId))
      .where(eq(agents.userId, id))
      .limit(1);
    const createdAt = me?.createdAt ?? now;
    // AGT-7 — the Screenhost agent's blocks read his own lists; « affiliés » counts the venues
    // pending activation or affiliated, and a venue with an attention point carries the flag.
    const sh = isSh(role);
    let campaignsView: { status: string; start_date: string | null; impressions: number }[];
    let affiliates: {
      id: string;
      name: string;
      status: string;
      attached_at: string;
      attention: string[];
    }[];
    if (sh) {
      const view = await shAgentCampaigns(id, now);
      campaignsView = view;
      affiliates = (await shAgentAffiliates(id, view, now)).map((a) => ({
        id: a.screenhost_id,
        name: a.name,
        status: a.status,
        attached_at: a.attached_at,
        attention: a.attention,
      }));
    } else {
      const view = await agentCampaigns(id, now);
      campaignsView = view;
      affiliates = (await agentScAffiliates(id, view)).map((a) => ({
        id: a.user_id,
        name: a.name,
        status: a.status,
        attached_at: a.attached_at,
        attention: [],
      }));
    }
    const counted = (status: string) =>
      status === 'en_cours' || (sh && status === 'en_attente_activation');

    const yearAgo = subMonths(now, 12);
    const twoYearsAgo = subMonths(now, 24);
    const inPeriod = (d: string | null, from: Date, to: Date) =>
      d !== null && d >= from.toISOString().slice(0, 10) && d < to.toISOString().slice(0, 10);
    const impressionsIn = (from: Date, to: Date) =>
      campaignsView
        .filter((c) => inPeriod(c.start_date, from, to))
        .reduce((s, c) => s + c.impressions, 0);
    const affiliatesIn = (from: Date, to: Date) =>
      affiliates.filter((a) => inPeriod(a.attached_at.slice(0, 10), from, to)).length;

    const live = (s: string) => s === 'active' || s === 'a_venir';
    return reply.status(200).send({
      code: me?.code ?? null,
      wallet: await agentWallet(id),
      cumulative_variation_pct: variationPct(
        await acquiredBetween(id, yearAgo, now),
        await acquiredBetween(id, twoYearsAgo, yearAgo),
        createdAt,
        now,
      ),
      affiliates_active: affiliates.filter((a) => counted(a.status)).length,
      affiliates_variation_pct: variationPct(
        affiliatesIn(yearAgo, now),
        affiliatesIn(twoYearsAgo, yearAgo),
        createdAt,
        now,
      ),
      impressions_total: campaignsView.reduce((s, c) => s + c.impressions, 0),
      impressions_variation_pct: variationPct(
        impressionsIn(yearAgo, now),
        impressionsIn(twoYearsAgo, yearAgo),
        createdAt,
        now,
      ),
      rank: await agentRank(id, role, now),
      recent_affiliates: affiliates
        .slice(0, 8)
        .map((a) => ({ id: a.id, name: a.name, attention: a.attention.length })),
      current_campaigns: campaignsView
        .filter((c) => live(c.status))
        .sort((a, b) =>
          a.status === b.status
            ? (a.start_date ?? '').localeCompare(b.start_date ?? '')
            : a.status === 'active'
              ? -1
              : 1,
        )
        .slice(0, 3),
    });
  });

  // GET /api/agent/campaigns — « Mes campagnes affiliées » (counters are derived client-side
  // from the same list, so Total = Actives + À venir + Terminées by construction).
  app.get('/api/agent/campaigns', scGuard, async (request, reply) => {
    const id = request.user?.id ?? '';
    return reply.status(200).send({
      campaigns: isSh(request.user?.role)
        ? await shAgentCampaigns(id, new Date())
        : await agentCampaigns(id, new Date()),
    });
  });

  // GET /api/agent/affiliates — « Mes Screencasters affiliés ».
  app.get('/api/agent/affiliates', scGuard, async (request, reply) => {
    const id = request.user?.id ?? '';
    if (isSh(request.user?.role)) {
      const view = await shAgentCampaigns(id, new Date());
      return reply.status(200).send({ affiliates: await shAgentAffiliates(id, view) });
    }
    const view = await agentCampaigns(id, new Date());
    return reply.status(200).send({ affiliates: await agentScAffiliates(id, view) });
  });
};
