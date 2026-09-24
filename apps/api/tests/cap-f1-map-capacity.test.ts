import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import { campaigns } from '../src/db/schema.js';
import { campaignEligibleHosts } from '../src/lib/campaign-eligible-hosts.js';
import { campaignTargetingRoutes } from '../src/routes/campaign-targeting.js';

import { seedApprovedOwner } from './helpers/approved-owner.js';
import { resetAuthTables } from './helpers/db-test-setup.js';
import { eventSector, seedCampaign, seedMatrix } from './helpers/installed-screen-matrix.js';
import { seedScreenFiller } from './helpers/screen-filler.js';

// CAP-F1 (operator ruling 2026-09-24) — « the map needs to check remaining capacity ». The
// advertiser's coverage map is the set dispatch can actually place on RIGHT NOW: the venues of
// « Hosts éligibles » (lib/campaign-eligible-hosts.ts — the real pool, read-only), not a parallel
// filter list that ignored capacity. Seen on prod 24/09: a map counting a venue whose screen hour
// was already held while « Hosts éligibles » did not list it. A draft without dates has no window
// to price capacity over, so its map keeps the static gates only (as MAP-4 does for availability).
// Fixture = MAP-TV1's five-venue matrix: (c)(d)(e) have an installed screen.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'advertiser', status: 'approved' },
  } as unknown as GetSessionResult);
};

interface CoverageBody {
  screenhosts: { id: string }[];
  covered_count: number;
}

describe('CAP-F1 — the coverage map checks remaining capacity', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(campaignTargetingRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  const coverage = async (campaignId: string): Promise<CoverageBody> => {
    const res = await app.inject({ method: 'GET', url: `/api/campaigns/${campaignId}/coverage` });
    expect(res.statusCode).toBe(200);
    return res.json() as CoverageBody;
  };

  it('a venue whose screen hour is full is off the map — the map IS « Hosts éligibles »', async () => {
    const v = await seedMatrix(await eventSector());
    const [full, ...rest] = v.in;
    await seedScreenFiller(full ?? '', { seconds: 3600 }); // the whole hour is held
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const campaign = await seedCampaign(advertiser);
    mockSession(advertiser);

    const body = await coverage(campaign.id);
    expect(body.covered_count).toBe(2);
    expect(body.screenhosts.map((s) => s.id).sort()).toEqual([...rest].sort());

    const hosts = await campaignEligibleHosts(campaign.id);
    if (hosts.status !== 'OK') throw new Error(`eligible hosts: ${hosts.status}`);
    expect(body.screenhosts.map((s) => s.id).sort()).toEqual(
      hosts.report.eligible.map((e) => e.id).sort(),
    );
  });

  it('a draft without dates keeps the static gates (no window to price capacity over)', async () => {
    const v = await seedMatrix(await eventSector());
    await seedScreenFiller(v.in[0] ?? '', { seconds: 3600 });
    const advertiser = await seedApprovedOwner({ role: 'advertiser' });
    const campaign = await seedCampaign(advertiser);
    await db
      .update(campaigns)
      .set({ startDate: null, endDate: null })
      .where(eq(campaigns.id, campaign.id));
    mockSession(advertiser);

    expect((await coverage(campaign.id)).covered_count).toBe(3);
  });
});
