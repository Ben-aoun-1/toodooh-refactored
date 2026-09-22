import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { campaignDispatchAllocation, campaignDispatchPlan, screenhosts } from '../src/db/schema.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { campaignTTiers } from '../src/lib/dispatch/config.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import type { EngineTrace } from '../src/lib/engine-journal/trace.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import {
  MONDAY,
  WEDNESDAY,
  eventSector,
  seedCampaign,
  seedVenue,
} from './helpers/installed-screen-matrix.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// CAP-EVT1 (operator ruling 2026-09-22) — « Capacité de diffusion » (screenhosts.broadcast_capacity)
// is the venue's EVENT-ONLY eligibility switch. Its value is unused; set (not NULL) is what counts.
//
//   • STANDARD campaigns never read it: the coverage map, the dispatch pool (and through it C_max,
//     dispatch, the refusal cascade, redispatch and the booster) and « Hosts éligibles » keep a
//     venue whose capacity is NULL — every other rule stays, MAP-TV1's installed screen included.
//
// Every venue here passes every OTHER gate (tests/helpers/installed-screen-matrix.ts: active,
// approved owner, 8–23, located, 100/h every day) and has an installed screen; the pair differs
// ONLY by its capacity. Dates are FIXED and named (Monday 2024-01-01 → Wednesday 2024-01-03).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

const collectingTrace = (): { trace: EngineTrace; reasons: Map<string, string> } => {
  const reasons = new Map<string, string>();
  return {
    reasons,
    trace: {
      enabled: true,
      event(type, payload = {}, screenhostId = null) {
        const reason = payload['reason'];
        if (type === 'venue_excluded' && screenhostId && typeof reason === 'string') {
          reasons.set(screenhostId, reason);
        }
      },
      finish: async () => undefined,
    },
  };
};

/** Two installed venues that differ only by their capacity: `on` = 4, `off` = NULL. */
const seedSwitchPair = async (): Promise<{ on: string; off: string; both: string[] }> => {
  const sector = await eventSector();
  const on = await seedVenue('Capacité 4', sector);
  await seedInstalledScreen(on);
  const off = await seedVenue('Capacité vide', sector);
  await seedInstalledScreen(off);
  await db.update(screenhosts).set({ broadcastCapacity: null }).where(eq(screenhosts.id, off));
  return { on, off, both: [on, off].sort() };
};

const window = (id: string) => ({ id, startDate: MONDAY, endDate: WEDNESDAY });
const inputs = { s: 10, t: 1, fMaxSeconds: 300 };
const buildApp = () => Fastify({ logger: false });

describe('CAP-EVT1 — the capacity is the event switch (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  describe('a STANDARD campaign never reads the capacity', () => {
    it('assemblePool keeps the venue whose capacity is NULL and journals nothing for it', async () => {
      const v = await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const { trace, reasons } = collectingTrace();
      const { pool, candidateCount } = await assemblePool(db, window(campaign.id), inputs, {
        trace,
      });

      expect(pool.map((p) => p.id).sort()).toEqual(v.both);
      expect(candidateCount).toBe(2);
      expect(reasons.has(v.off)).toBe(false);
      // Same venue, same audience: the capacity changes nothing in what it is worth.
      const byId = new Map(pool.map((p) => [p.id, p.residualCapacity]));
      expect(byId.get(v.off)).toBe(byId.get(v.on));
    });

    it('C_max prices both venues', async () => {
      await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const cmax = await computeCampaignCmax(campaign, 10);
      expect(cmax.eligibleCount).toBe(2);
      expect(cmax.targetedCount).toBe(2);
    });

    it('dispatch places on the venue whose capacity is NULL when it needs both', async () => {
      const v = await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));
      const cmax = await computeCampaignCmax(campaign, 10);

      // 80 % of both venues' capacity: one venue cannot carry it.
      const result = await runDispatch(campaign, {
        iCible: Math.floor(cmax.iMaxFacturable * 0.8),
        cpm: cmax.cpmTnd,
        s: 10,
        tiers: campaignTTiers(campaign),
      });
      expect(result.status).toBe('OK');
      const placed = await db
        .select({ screenhostId: campaignDispatchAllocation.screenhostId })
        .from(campaignDispatchAllocation)
        .innerJoin(
          campaignDispatchPlan,
          eq(campaignDispatchPlan.id, campaignDispatchAllocation.planId),
        )
        .where(eq(campaignDispatchPlan.campaignId, campaign.id));
      expect([...new Set(placed.map((p) => p.screenhostId))].sort()).toEqual(v.both);
    });

    it('« Hosts éligibles » (standard) lists both, with no capacity reason', async () => {
      const v = await seedSwitchPair();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const result = await campaignEligibleHosts(campaign.id);
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.kind).toBe('standard');
      expect(result.report.eligible.map((e) => e.id).sort()).toEqual(v.both);
      expect(result.report.excluded).toEqual([]);
    });

    describe('GET /api/campaigns/:id/coverage (standard draft)', () => {
      let app: ReturnType<typeof buildApp>;
      beforeEach(async () => {
        app = buildApp();
        await app.register(campaignTargetingRoutes);
        await app.ready();
      });
      afterEach(async () => {
        await app.close();
      });

      it('plots and counts both venues', async () => {
        const v = await seedSwitchPair();
        const advertiser = await seedApprovedOwner({ role: 'advertiser' });
        const campaign = await seedCampaign(advertiser);

        mockSession(advertiser, 'advertiser');
        const res = await app.inject({
          method: 'GET',
          url: `/api/campaigns/${campaign.id}/coverage`,
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{
          screenhosts: { id: string }[];
          covered_count: number;
          without_coordinates: number;
        }>();
        expect(body.screenhosts.map((s) => s.id).sort()).toEqual(v.both);
        expect(body.covered_count).toBe(2);
        expect(body.without_coordinates).toBe(0);
      });
    });
  });
});
