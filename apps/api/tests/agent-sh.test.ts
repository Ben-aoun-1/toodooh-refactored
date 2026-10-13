import { and, eq, isNull } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  agentAffiliations,
  agentAttentionEvents,
  agents,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { attentionSignals, runAgentShFollowupTick } from '../src/lib/agent-sh-followup.js';
import { agentFollowupRoutes } from '../src/routes/agent-followup.js';
import { agentPortfolioRoutes } from '../src/routes/agent-portfolio.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-7 — the Screenhost agent (spec §4–§6): campaigns enter on an ACCEPTED offer at an
// affiliated venue; the follow-up job's attention points appear once, notify once, clear by
// themselves; the agent sees only his portfolio.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const NOW = new Date('2026-10-13T10:00:00Z');

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `agt7-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const FUTURE: DispatchCreneau[] = [{ date: '2026-11-02', hour: 10, reps: 10, impressions: 500 }];

const offer = async (
  venueId: string,
  advertiserId: string,
  statut: 'ACCEPTE' | 'REFUSE' | 'EN_ATTENTE',
  name: string,
) => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name,
      campaignType: 'standard',
      status: 'upcoming',
      startDate: '2026-11-01',
      endDate: '2026-11-10',
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: c?.id ?? '',
      iCible: 500,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '1',
      seuilDiffusable: 10,
      sMin: '1',
      gJour: '1',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 500,
      nMin: 1,
      nMax: 1,
      nRetenus: 1,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId: venueId,
    iiPotentiel: 500,
    rI: 1,
    revenuPrevisionnel: '5',
    statutAcceptation: statut,
    creneaux: FUTURE,
    createdAt: new Date('2026-10-10T10:00:00Z'),
  });
  return c?.id ?? '';
};

const setup = async () => {
  const agent = await seedUser({ role: 'screenhost_agent' });
  await db
    .insert(agents)
    .values({ userId: agent, code: `SH${100000 + seq}`, accountStatus: 'actif' });
  const owner = await seedUser({ role: 'individual_owner' });
  const [venue] = await db
    .insert(screenhosts)
    .values({ name: 'Café Nord', ownerId: owner, city: 'Tunis' })
    .returning();
  await db.insert(agentAffiliations).values({
    agentUserId: agent,
    agentRole: 'screenhost_agent',
    referredUserId: owner,
    screenhostId: venue?.id ?? '',
    status: 'en_attente_activation',
  });
  const advertiser = await seedUser({ role: 'advertiser', businessName: 'Pâtisserie Lina' });
  return { agent, owner, venueId: venue?.id ?? '', advertiser };
};

const asAgent = async (agent: string) => {
  const app = Fastify({ logger: false });
  await app.register(agentPortfolioRoutes);
  await app.register(agentFollowupRoutes);
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: agent, role: 'screenhost_agent', status: 'approved' },
  } as unknown as GetSessionResult);
  return app;
};

describe('AGT-7 — the Screenhost agent (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('attention points follow the hub thresholds', () => {
    const t = {
      refusPct: 30,
      sansReponseCount: 2,
      activitePct: 70,
      evenementCount: 1,
      inactiviteDays: 30,
      baisseScorePoints: 10,
    };
    const base = {
      sps: 60,
      rates: { acceptation: 50, respect_evenements: 100, activite: 65, remplissage: 20 },
      offers: { received: 3, accepted: 1, refused: 2, no_answer: 0 },
      missed: [{ at: '2026-10-01T09:00:00Z', campaign: 'X', cause: 'evenement' as const }],
      lastDiffusionAt: new Date('2026-08-01T10:00:00Z'),
    };
    expect(
      attentionSignals(base, t, { activated: true, sps30DaysAgo: 75, now: NOW }).sort(),
    ).toEqual(
      [
        'aucune_campagne_recente',
        'baisse_score',
        'ecrans_peu_actifs',
        'evenement_non_diffuse',
        'refus_frequents',
      ].sort(),
    );
    expect(
      attentionSignals(
        {
          ...base,
          offers: { received: 3, accepted: 3, refused: 0, no_answer: 0 },
          missed: [],
          rates: { ...base.rates, activite: 90 },
        },
        t,
        { activated: false, sps30DaysAgo: null, now: NOW },
      ),
    ).toEqual([]);
  });

  it('a campaign enters on an accepted offer; the dashboard counts pending venues', async () => {
    const s = await setup();
    await offer(s.venueId, s.advertiser, 'ACCEPTE', 'Ramadan');
    await offer(s.venueId, s.advertiser, 'EN_ATTENTE', 'En attente');
    await offer(s.venueId, s.advertiser, 'REFUSE', 'Refusée');
    const app = await asAgent(s.agent);
    const list = (await app.inject({ method: 'GET', url: '/api/agent/campaigns' })).json<{
      campaigns: {
        name: string;
        venues_touched: number;
        impressions: number;
        advertiser_name: string;
        venues: { name: string }[];
      }[];
    }>().campaigns;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Ramadan',
      venues_touched: 1,
      impressions: 500,
      advertiser_name: 'Pâtisserie Lina',
    });
    expect(list[0]?.venues.map((v) => v.name)).toEqual(['Café Nord']);
    const dash = (await app.inject({ method: 'GET', url: '/api/agent/dashboard' })).json<{
      affiliates_active: number;
      impressions_total: number;
      recent_affiliates: { name: string }[];
    }>();
    expect(dash).toMatchObject({ affiliates_active: 1, impressions_total: 500 });
    expect(dash.recent_affiliates.map((a) => a.name)).toEqual(['Café Nord']);
    await app.close();
  });

  it('the follow-up job raises an attention point once, notifies once, and clears it', async () => {
    const s = await setup();
    await offer(s.venueId, s.advertiser, 'REFUSE', 'A');
    await offer(s.venueId, s.advertiser, 'REFUSE', 'B');
    await offer(s.venueId, s.advertiser, 'ACCEPTE', 'C');
    // The first computation is a silent baseline: no notice for signals already there.
    await runAgentShFollowupTick(new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000));
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, s.agent)),
    ).toHaveLength(0);
    await db.delete(agentAttentionEvents).where(eq(agentAttentionEvents.screenhostId, s.venueId));
    await runAgentShFollowupTick(NOW);
    await runAgentShFollowupTick(NOW);
    const open = await db
      .select()
      .from(agentAttentionEvents)
      .where(
        and(
          eq(agentAttentionEvents.screenhostId, s.venueId),
          isNull(agentAttentionEvents.clearedAt),
        ),
      );
    expect(open.map((e) => e.signal)).toEqual(['refus_frequents']);
    const notes = await db.select().from(notifications).where(eq(notifications.userId, s.agent));
    expect(notes.map((n) => n.title)).toEqual(['Point d’attention : Café Nord, Refus fréquents']);

    const app = await asAgent(s.agent);
    const panel = (await app.inject({ method: 'GET', url: '/api/agent/followup' })).json<{
      rows: { name: string; refused: number; attention: { label: string }[] }[];
    }>().rows;
    expect(panel).toEqual([
      expect.objectContaining({
        name: 'Café Nord',
        refused: 2,
        attention: [{ key: 'refus_frequents', label: 'Refus fréquents' }],
      }),
    ]);
    const sheet = await app.inject({ method: 'GET', url: `/api/agent/followup/${s.venueId}` });
    expect(sheet.statusCode).toBe(200);
    expect(
      sheet.json<{ history: { unaccepted: { type: string; outcome: string }[] } }>().history
        .unaccepted,
    ).toHaveLength(2);
    const stranger = await db
      .insert(screenhosts)
      .values({ name: 'Ailleurs', ownerId: s.owner })
      .returning();
    expect(
      (await app.inject({ method: 'GET', url: `/api/agent/followup/${stranger[0]?.id}` }))
        .statusCode,
    ).toBe(404);
    await app.close();

    // The refusals become acceptances: the point clears by itself on the next run.
    await db
      .update(campaignDispatchAllocation)
      .set({ statutAcceptation: 'ACCEPTE' })
      .where(eq(campaignDispatchAllocation.screenhostId, s.venueId));
    await runAgentShFollowupTick(NOW);
    const [ev] = await db
      .select()
      .from(agentAttentionEvents)
      .where(eq(agentAttentionEvents.screenhostId, s.venueId));
    expect(ev?.clearedAt).not.toBeNull();
  });
});
