import { eq, inArray } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignZones,
  campaigns,
  creatives,
  recharges,
  screenhostAffluence,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { screenhostMatchesTargeting } from '../src/lib/dispatch/eligibility.js';
import { adminCampaignsRoutes } from '../src/routes/admin-campaigns.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// E5.1 (VF US-2.1, canonical) — EMPTY targeting = the whole network. The matcher passes-all on an
// empty list, the NO_TARGETING refusal is retired, and a zero-line campaign proceeds through
// pooling → selection → plan → activation exactly like any other. Real Postgres; session mocked.
// No business_sectors rows added; the one test zone is swept (the exact-seed-count footgun).

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'admin', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `wholenet${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorIds = async (): Promise<[string, string]> => {
  const rows = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(2);
  return [rows[0]?.id ?? '', rows[1]?.id ?? ''];
};

const seedVenue = async (
  ownerId: string,
  categoryId: string,
  opts: { zoneId?: string | null } = {},
): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `WholeNet Venue ${seq}-${Math.random().toString(16).slice(2, 6)}`,
      ownerId,
      businessSectorId: categoryId,
      class: 'premium',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
      zoneId: opts.zoneId ?? null,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  return id;
};

// A ZERO-LINE campaign — deliberately NO campaignTargeting rows.
const seedZeroLineCampaign = async (
  advertiserId: string,
  over: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'Tout le réseau',
      campaignType: 'standard',
      status: 'draft',
      startDate: '2024-01-01', // Mon
      endDate: '2024-01-02', // Tue
      ...over,
    })
    .returning();
  return c?.id ?? '';
};

const allocationsFor = async (campaignId: string) => {
  const [plan] = await db
    .select({ id: campaignDispatchPlan.id })
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId));
  return db
    .select({ screenhostId: campaignDispatchAllocation.screenhostId })
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
};

describe('E5.1 — whole-network dispatch semantics (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  const createdZoneIds: string[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(adminCampaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (createdZoneIds.length > 0) {
      await db
        .update(screenhosts)
        .set({ zoneId: null })
        .where(inArray(screenhosts.zoneId, createdZoneIds));
      await db.delete(campaignZones).where(inArray(campaignZones.zoneId, createdZoneIds));
      await db.delete(zones).where(inArray(zones.id, createdZoneIds));
      createdZoneIds.length = 0;
    }
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('the matcher passes ALL venues on an empty targeting list (the single semantic home)', () => {
    expect(screenhostMatchesTargeting({ businessSectorId: 'any', class: 'premium' }, [])).toBe(
      true,
    );
    // Non-empty lists keep their exact behavior (targeted campaigns byte-unchanged).
    expect(
      screenhostMatchesTargeting({ businessSectorId: 'a', class: 'premium' }, [
        { categoryId: 'b', class: null },
      ]),
    ).toBe(false);
  });

  it('a zero-line campaign assembles the FULL cross-sector pool and dispatches onto it', async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sectorA, sectorB] = await ownerSectorIds();
    const venueA = await seedVenue(owner, sectorA);
    const venueB = await seedVenue(owner, sectorB); // different sector — only whole-network reaches it
    const campaignId = await seedZeroLineCampaign(advertiser);

    // 36 000 facturable per venue (the E5 hand-computation); 40 000 needs BOTH venues.
    const result = await runDispatch(
      { id: campaignId, name: 'Tout le réseau', startDate: '2024-01-01', endDate: '2024-01-02' },
      { iCible: 40_000, cpm: 15, s: 10 },
    );
    expect(result.status).toBe('OK');
    const allocated = (await allocationsFor(campaignId)).map((a) => a.screenhostId).sort();
    expect(allocated).toEqual([venueA, venueB].sort());
  });

  it('zones still scope a zero-line campaign (the zone clause is untouched)', async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sectorA, sectorB] = await ownerSectorIds();
    const [z] = await db
      .insert(zones)
      .values({ name: `wholenet-zone-${Date.now()}` })
      .returning();
    const zoneId = z?.id ?? '';
    createdZoneIds.push(zoneId);
    const inZone = await seedVenue(owner, sectorA, { zoneId });
    await seedVenue(owner, sectorB); // zone-less — excluded by the zone clause
    const campaignId = await seedZeroLineCampaign(advertiser);
    await db.insert(campaignZones).values({ campaignId, zoneId });

    const result = await runDispatch(
      { id: campaignId, name: 'Tout le réseau', startDate: '2024-01-01', endDate: '2024-01-02' },
      { iCible: 10_000, cpm: 15, s: 10 },
    );
    expect(result.status).toBe('OK');
    const allocated = (await allocationsFor(campaignId)).map((a) => a.screenhostId);
    expect(allocated).toEqual([inZone]);
  });

  it('END-TO-END: a zero-line pending campaign ACTIVATES through the admin route', async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const admin = await seedUser({ role: 'admin' });
    const [sectorA] = await ownerSectorIds();
    await seedVenue(owner, sectorA);
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/wholenet/${seq}`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    const campaignId = await seedZeroLineCampaign(advertiser, {
      status: 'pending',
      creativeId: creative?.id ?? null,
      requestedBudget: '300.00',
    });
    await db.insert(recharges).values({
      advertiserId: advertiser,
      amountTnd: '300.00',
      status: 'confirmed',
      reference: `WNET-${seq}`,
    });

    mockSession(admin, 'admin');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/campaigns/${campaignId}/activate`,
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(['upcoming', 'active']).toContain(row?.status ?? '');
    expect(await allocationsFor(campaignId)).toHaveLength(1);
  });
});
