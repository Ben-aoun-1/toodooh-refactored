import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  agentCommissionLines,
  agents,
  campaignDispatchPlan,
  campaigns,
  users,
} from '../src/db/schema.js';
import { agentCampaignStatus, variationPct } from '../src/lib/agent-portfolio.js';
import { agentPortfolioRoutes } from '../src/routes/agent-portfolio.js';

import { seedLiveAffiliation } from './helpers/agent-affiliation.js';
import { resetAuthTables } from './helpers/db-test-setup.js';

// AGT-4 — the Screencaster agent's Dashboard / Mes campagnes / Mes Screencasters (spec §4–§6):
// confirmed launches only, inside the affiliation window, the Screencaster's own impressions,
// and the three pages agreeing with each other and with the wallet.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `agt4-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  values: Partial<typeof campaigns.$inferInsert>,
  dispatched = true,
) => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `Campagne ${seq}`,
      campaignType: 'standard',
      status: 'active',
      requestedBudget: '150',
      standardCpmTnd: '15',
      ...values,
    })
    .returning();
  if (dispatched) {
    await db.insert(campaignDispatchPlan).values({
      campaignId: c?.id ?? '',
      iCible: 10000,
      cpm: '15',
      sSpotSeconds: 10,
      tTierCoef: '1',
      seuilDiffusable: 1000,
      sMin: '10',
      gJour: '1',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 10000,
      nMin: 1,
      nMax: 1,
      nRetenus: 1,
    });
  }
  return c?.id ?? '';
};

describe('AGT-4 — the Screencaster agent portfolio', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await sql.end();
  });

  it('badges and variations follow the spec rules', () => {
    const today = '2026-10-13';
    expect(
      agentCampaignStatus(
        { status: 'upcoming', startDate: '2026-10-20', endDate: '2026-10-30' },
        today,
      ),
    ).toBe('a_venir');
    expect(
      agentCampaignStatus(
        { status: 'active', startDate: '2026-10-01', endDate: '2026-10-30' },
        today,
      ),
    ).toBe('active');
    expect(
      agentCampaignStatus(
        { status: 'active', startDate: '2026-09-01', endDate: '2026-09-30' },
        today,
      ),
    ).toBe('terminee');
    const now = new Date('2026-10-13T10:00:00Z');
    expect(variationPct(120, 100, new Date('2024-01-01'), now)).toBe(20);
    expect(variationPct(80, 100, new Date('2024-01-01'), now)).toBe(-20);
    expect(variationPct(120, 100, new Date('2026-01-01'), now)).toBeNull(); // < 12 months
    expect(variationPct(120, 0, new Date('2024-01-01'), now)).toBeNull();
  });

  it('lists confirmed launches in the window only, and the three pages agree with the wallet', async () => {
    const agent = await seedUser({ role: 'screencast_agent' });
    await db
      .insert(agents)
      .values({ userId: agent, code: `SC${100000 + seq}`, accountStatus: 'actif' });
    const sc = await seedUser({ role: 'advertiser', businessName: 'Pâtisserie Lina' });
    await seedLiveAffiliation({
      agentUserId: agent,
      referredUserId: sc,
      start: '2026-01-01',
      end: '2028-01-01',
    });

    const live = await seedCampaign(sc, {
      name: 'Ramadan',
      startDate: '2026-10-01',
      endDate: '2026-10-30',
    });
    const done = await seedCampaign(sc, {
      name: 'Été',
      status: 'completed',
      startDate: '2026-07-01',
      endDate: '2026-07-10',
    });
    await seedCampaign(
      sc,
      { name: 'Brouillon', status: 'draft', startDate: '2026-11-01', endDate: '2026-11-05' },
      false,
    );
    await seedCampaign(
      sc,
      { name: 'Pas dispatchée', startDate: '2026-11-01', endDate: '2026-11-05' },
      false,
    );
    await seedCampaign(sc, {
      name: 'Avant affiliation',
      startDate: '2025-12-01',
      endDate: '2025-12-10',
    });
    await db.insert(agentCommissionLines).values([
      {
        agentUserId: agent,
        agentRole: 'screencast_agent',
        campaignId: done,
        status: 'acquise',
        ratePct: '3',
        forecastTnd: '4.5',
        acquiredTnd: '4.5',
        acquiredAt: new Date(),
      },
      {
        agentUserId: agent,
        agentRole: 'screencast_agent',
        campaignId: live,
        status: 'previsionnel',
        ratePct: '3',
        forecastTnd: '4.5',
      },
    ]);

    const app = Fastify({ logger: false });
    await app.register(agentPortfolioRoutes);
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: agent, role: 'screencast_agent', status: 'approved' },
    } as unknown as GetSessionResult);

    const list = (await app.inject({ method: 'GET', url: '/api/agent/campaigns' })).json<{
      campaigns: {
        name: string;
        status: string;
        impressions: number;
        revenue_tnd: number;
        forecast_tnd: number;
        affiliate_name: string;
      }[];
    }>().campaigns;
    expect(list.map((c) => c.name).sort()).toEqual(['Ramadan', 'Été']);
    const ramadan = list.find((c) => c.name === 'Ramadan');
    expect(ramadan).toMatchObject({
      impressions: 10000,
      revenue_tnd: 0,
      forecast_tnd: 4.5,
      affiliate_name: 'Pâtisserie Lina',
    });
    expect(list.find((c) => c.name === 'Été')).toMatchObject({
      status: 'terminee',
      revenue_tnd: 4.5,
    });

    const dash = (await app.inject({ method: 'GET', url: '/api/agent/dashboard' })).json<{
      wallet: { cumulative_tnd: number };
      impressions_total: number;
      affiliates_active: number;
      rank: number | null;
      current_campaigns: { name: string }[];
      recent_affiliates: { name: string }[];
    }>();
    expect(dash.wallet.cumulative_tnd).toBe(list.reduce((s, c) => s + c.revenue_tnd, 0));
    expect(dash.impressions_total).toBe(list.reduce((s, c) => s + c.impressions, 0));
    expect(dash).toMatchObject({ affiliates_active: 1, rank: 1 });
    expect(dash.current_campaigns.map((c) => c.name)).toEqual(['Ramadan']);
    expect(dash.recent_affiliates).toEqual([{ id: sc, name: 'Pâtisserie Lina', attention: 0 }]);

    const affs = (await app.inject({ method: 'GET', url: '/api/agent/affiliates' })).json<{
      affiliates: { revenue_tnd: number; impressions: number }[];
    }>().affiliates;
    expect(affs).toHaveLength(1);
    expect(affs[0]?.revenue_tnd).toBe(dash.wallet.cumulative_tnd);
    expect(affs[0]?.impressions).toBe(dash.impressions_total);
    await app.close();
  });
});
