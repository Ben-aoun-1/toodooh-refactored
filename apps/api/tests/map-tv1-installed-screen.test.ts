import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { screens } from '../src/db/schema.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import type { EngineTrace } from '../src/lib/engine-journal/trace.js';
import { assembleEventPool } from '../src/lib/event-dispatch/dispatch.js';
import { computeEventCmax } from '../src/lib/event-pricing/pricing.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import {
  MONDAY,
  SEEN_AT,
  WEDNESDAY,
  eventRef,
  eventSector,
  neverInstalled,
  seedCampaign,
  seedMatrix,
  seedPositioning,
  seedVenue,
} from './helpers/installed-screen-matrix.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// MAP-TV1 (operator ruling 2026-09-21, M1 A · M2 A) — a venue is SELLABLE only with at least one
// INSTALLED screen. This suite pins the POOLS and the PREVIEWS that read the shared predicate
// (lib/installed-screen.ts) on the five-venue matrix (tests/helpers/installed-screen-matrix.ts):
// (a) no row and (b) never-installed rows are OUT; (c) paired-only, (d) seen-only and (e) one
// installed row among others are IN. The placements that act on these pools (dispatch, the
// refusal cascades, the booster, event dispatch) are pinned in map-tv1-placements.test.ts.

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

const window = (id: string) => ({ id, startDate: MONDAY, endDate: WEDNESDAY });
const inputs = { s: 10, t: 1, fMaxSeconds: 300 };
const buildApp = () => Fastify({ logger: false });

describe('MAP-TV1 — only a venue with an installed screen is sold (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  describe('the standard engine — assemblePool and what reads it', () => {
    it('assemblePool keeps (c)(d)(e) and journals (a)(b) as no_installed_screen', async () => {
      const v = await seedMatrix(await eventSector());
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const { trace, reasons } = collectingTrace();
      const { pool, candidateCount } = await assemblePool(db, window(campaign.id), inputs, {
        trace,
      });

      expect(pool.map((p) => p.id).sort()).toEqual(v.in);
      expect(candidateCount).toBe(3);
      for (const out of v.out) expect(reasons.get(out)).toBe('no_installed_screen');
      for (const kept of v.in) expect(reasons.has(kept)).toBe(false);
    });

    it('owner_not_approved still comes first; installing a screen later brings the venue back', async () => {
      const sector = await eventSector();
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));
      const pendingNoScreen = await seedVenue(
        'En attente, sans écran',
        sector,
        await seedApprovedOwner({ status: 'pending' }),
      );
      const later = await seedVenue('Écran bientôt appairé', sector);
      const rowId = await seedInstalledScreen(later, neverInstalled);

      const { trace, reasons } = collectingTrace();
      expect((await assemblePool(db, window(campaign.id), inputs, { trace })).pool).toEqual([]);
      expect(reasons.get(pendingNoScreen)).toBe('owner_not_approved');
      expect(reasons.get(later)).toBe('no_installed_screen');

      // The rule reads the live rows: the device pairs → the venue is sellable again.
      await db.update(screens).set({ pairedAt: SEEN_AT }).where(eq(screens.id, rowId));
      const { pool } = await assemblePool(db, window(campaign.id), inputs);
      expect(pool.map((p) => p.id)).toEqual([later]);
    });

    it('C_max prices only (c)(d)(e)', async () => {
      await seedMatrix(await eventSector());
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const cmax = await computeCampaignCmax(campaign, 10);
      expect(cmax.eligibleCount).toBe(3);
      expect(cmax.targetedCount).toBe(3);
      const one = cmax.iMaxFacturable / 3;
      expect(Number.isInteger(one)).toBe(true);
      expect(one).toBeGreaterThan(0);
    });

    it('« Hosts éligibles » (standard) names (a)(b) no_installed_screen', async () => {
      const v = await seedMatrix(await eventSector());
      const campaign = await seedCampaign(await seedApprovedOwner({ role: 'advertiser' }));

      const result = await campaignEligibleHosts(campaign.id);
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.eligible.map((e) => e.id).sort()).toEqual(v.in);
      const reasonOf = new Map(result.report.excluded.map((e) => [e.id, e.reason]));
      for (const out of v.out) expect(reasonOf.get(out)).toBe('no_installed_screen');
    });
  });

  describe('the event engine — C_max_evt, the bloc pool, « Hosts éligibles »', () => {
    it('computeEventCmax and assembleEventPool keep only (c)(d)(e)', async () => {
      const v = await seedMatrix(await eventSector());
      const ref = await eventRef();

      const cmax = await computeEventCmax(ref, 15);
      expect(cmax.venues.map((x) => x.screenhostId).sort()).toEqual(v.in);
      expect(cmax.eligibleCount).toBe(3);
      // three venues × six blocs × 100 pers/h × 20 = 36 000 impressions → ⌊15 × 36 000 ÷ 1000⌋
      expect(cmax.iMax).toBe(36_000);
      expect(cmax.cMaxEvtTnd).toBe(540);

      const pool = await assembleEventPool(ref);
      expect(pool.map((x) => x.screenhostId).sort()).toEqual(v.in);
    });

    it('« Hosts éligibles » (event) names (a)(b) no_installed_screen', async () => {
      const v = await seedMatrix(await eventSector());
      const { positioningId } = await seedPositioning(
        await seedApprovedOwner({ role: 'advertiser' }),
      );

      const result = await campaignEligibleHosts(positioningId);
      expect(result.status).toBe('OK');
      if (result.status !== 'OK') return;
      expect(result.report.kind).toBe('event');
      expect(result.report.eligible.map((e) => e.id).sort()).toEqual(v.in);
      const reasonOf = new Map(result.report.excluded.map((e) => [e.id, e.reason]));
      for (const out of v.out) expect(reasonOf.get(out)).toBe('no_installed_screen');
    });
  });

  describe('GET /api/campaigns/:id/coverage — the advertiser map', () => {
    let app: ReturnType<typeof buildApp>;
    beforeEach(async () => {
      app = buildApp();
      await app.register(campaignTargetingRoutes);
      await app.ready();
    });
    afterEach(async () => {
      await app.close();
    });

    it('plots and counts only (c)(d)(e)', async () => {
      const v = await seedMatrix(await eventSector());
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
      expect(body.screenhosts.map((s) => s.id).sort()).toEqual(v.in);
      expect(body.covered_count).toBe(3);
      expect(body.without_coordinates).toBe(0);
    });
  });
});
