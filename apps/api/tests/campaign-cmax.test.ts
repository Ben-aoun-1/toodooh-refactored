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
  campaignTargeting,
  campaignZones,
  campaigns,
  creatives,
  screenhostAffluence,
  screenhosts,
  users,
  zones,
} from '../src/db/schema.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E5 (VF US-1.3/1.4) — the C_max ceiling. Real Postgres; session mocked. The pool math is pinned
// against a HAND-COMPUTED fixture (defaults: t10s=0.6, F=300s, CPM standard=15):
//
//   venue 8–18h (10 broadcastable hours/day), window Mon 2024-01-01 → Tue 2024-01-02 (2 days,
//   INCLUSIVE) → Hi = 20 slots; affluence 100/slot → avg Ai = 100.
//   S = 10s, no other engagement → R = min(3600/10, ⌊300/10⌋) = 30.
//   capacité brute = Ai·Hi·R = 100 × 20 × 30 = 60 000 → facturable = ⌊60 000 × 0.6⌋ = 36 000.
//   I_max = 36 000 → C_max = ⌊15 × 36 000 / 1000⌋ = 540 TND.
//
// No business_sectors/zones rows are ever ADDED without sweeping (the exact-seed-count footgun):
// sectors are read from the seed; the one test zone is deleted in afterEach.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'advertiser', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `cmax${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'advertiser',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

// Two DISTINCT owner sectors from the canonical seed (never inserted here — seed-count pins).
const ownerSectorIds = async (): Promise<[string, string]> => {
  const rows = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(2);
  return [rows[0]?.id ?? '', rows[1]?.id ?? ''];
};

const seedCreative = async (advertiserId: string, durationSeconds = 10): Promise<string> => {
  const [c] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/cmax/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds,
      validationStatus: 'approved',
    })
    .returning();
  return c?.id ?? '';
};

const seedCampaign = async (
  advertiserId: string,
  over: Partial<typeof campaigns.$inferInsert> = {},
): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: 'C_max fixture',
      campaignType: 'standard',
      status: 'draft',
      startDate: '2024-01-01', // Mon
      endDate: '2024-01-02', // Tue — 2 INCLUSIVE days
      ...over,
    })
    .returning();
  return c?.id ?? '';
};

const targetSector = (campaignId: string, categoryId: string) =>
  db.insert(campaignTargeting).values({ campaignId, categoryId, class: null });

// An eligible venue: horaires 8–18, capacity present. `dows` controls which weekdays carry
// affluence (Mon+Tue for the fixed 2024 window; all 7 for the future-dated submit tests).
const seedVenue = async (
  ownerId: string,
  categoryId: string,
  opts: { affluence?: number; dows?: number[]; zoneId?: string | null } = {},
): Promise<string> => {
  const affluence = opts.affluence ?? 100;
  const dows = opts.dows ?? [1, 2];
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Venue ${seq}-${Math.random().toString(16).slice(2, 6)}`,
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
  for (const dow of dows)
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: affluence });
  await db.insert(screenhostAffluence).values(rows);
  return id;
};

// A foreign campaign's frozen engagement on a venue: plan (S=10s) + one ACCEPTE allocation with a
// known r_i, so the engaged seconds are exactly rI × 10.
const seedEngagement = async (advertiserId: string, screenhostId: string, rI: number) => {
  const campaignId = await seedCampaign(advertiserId, { name: 'Engaged neighbour' });
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId,
      iCible: 10_000,
      cpm: '15',
      sSpotSeconds: 10,
      tTierCoef: '0.6',
      seuilDiffusable: 1000,
      sMin: '20',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 10_000,
      nMin: 1,
      nMax: 10,
      nRetenus: 1,
      reliquatStocke: 0,
    })
    .returning();
  await db.insert(campaignDispatchAllocation).values({
    planId: plan?.id ?? '',
    screenhostId,
    iiPotentiel: 1000,
    rI,
    revenuPrevisionnel: '15',
    creneaux: [],
    statutAcceptation: 'ACCEPTE',
  });
};

describe('E5 — GET /api/campaigns/:id/cmax + the submit C_max gate (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;
  const createdZoneIds: string[] = [];

  beforeEach(async () => {
    await resetAuthTables();
    app = buildApp();
    await app.register(campaignsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Sweep the test zone rows (exact-seed-count footgun: zones must never accumulate). The
    // referencing rows still exist here (the truncate runs in the NEXT test's beforeEach), so
    // detach them first: screenhosts.zone_id nulls out, campaign_zones rows drop.
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

  const getCmax = (id: string) => app.inject({ method: 'GET', url: `/api/campaigns/${id}/cmax` });
  const submit = (id: string) => app.inject({ method: 'POST', url: `/api/campaigns/${id}/submit` });

  const fullFixture = async (opts: { affluence?: number; venues?: number } = {}) => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sector] = await ownerSectorIds();
    const creativeId = await seedCreative(advertiser, 10);
    const campaignId = await seedCampaign(advertiser, { creativeId });
    await targetSector(campaignId, sector);
    const venueIds: string[] = [];
    for (let i = 0; i < (opts.venues ?? 1); i += 1) {
      venueIds.push(await seedVenue(owner, sector, { affluence: opts.affluence }));
    }
    return { advertiser, owner, sector, campaignId, creativeId, venueIds };
  };

  // ── the hand-computed I_max ────────────────────────────────────────────────
  it('one venue: I_max = 36 000 facturable → C_max = 540 TND (the hand computation)', async () => {
    const f = await fullFixture();
    mockSession(f.advertiser);
    const res = await getCmax(f.campaignId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      c_max_tnd: 540,
      i_max_facturable: 36_000,
      eligible_count: 1,
      targeted_count: 1,
    });
  });

  it('two venues sum: I_max = 72 000 → C_max = 1 080, eligible_count 2', async () => {
    const f = await fullFixture({ venues: 2 });
    mockSession(f.advertiser);
    const res = await getCmax(f.campaignId);
    expect(res.json()).toEqual({
      c_max_tnd: 1080,
      i_max_facturable: 72_000,
      eligible_count: 2,
      targeted_count: 2,
    });
  });

  it('FLOORS to whole TND: affluence 77 → I_max ⌊46 200×0.6⌋ = 27 720 → C_max ⌊415,8⌋ = 415', async () => {
    const f = await fullFixture({ affluence: 77 });
    mockSession(f.advertiser);
    const res = await getCmax(f.campaignId);
    expect(res.json()).toEqual({
      c_max_tnd: 415,
      i_max_facturable: 27_720,
      eligible_count: 1,
      targeted_count: 1,
    });
  });

  // ── engagement netting (the dispatch-truth requirement) ────────────────────
  it("an existing campaign's engagement SHRINKS the ceiling: rI=15×10s engaged → 540 → 270", async () => {
    const f = await fullFixture();
    // A neighbour's frozen allocation on the same venue: engaged 150s → residual 150s →
    // R = ⌊150/10⌋ = 15 → brute 100×20×15 = 30 000 → facturable 18 000 → C_max 270.
    await seedEngagement(f.advertiser, f.venueIds[0] ?? '', 15);
    mockSession(f.advertiser);
    const res = await getCmax(f.campaignId);
    expect(res.json()).toEqual({
      c_max_tnd: 270,
      i_max_facturable: 18_000,
      eligible_count: 1,
      targeted_count: 1,
    });
  });

  // ── scoping ────────────────────────────────────────────────────────────────
  it('targeting scopes the pool: a venue in an untargeted sector never counts', async () => {
    const f = await fullFixture();
    const [, otherSector] = await ownerSectorIds();
    expect(otherSector).not.toBe(f.sector);
    await seedVenue(f.owner, otherSector); // eligible venue, wrong sector
    mockSession(f.advertiser);
    const res = await getCmax(f.campaignId);
    expect(res.json()).toEqual({
      c_max_tnd: 540,
      i_max_facturable: 36_000,
      eligible_count: 1,
      targeted_count: 1,
    });
  });

  it('zones scope the pool: with a targeted zone, only venues IN it count', async () => {
    const f = await fullFixture(); // venue 0: zoneId null
    const [z] = await db
      .insert(zones)
      .values({ name: `cmax-test-zone-${Date.now()}` })
      .returning();
    const zoneId = z?.id ?? '';
    createdZoneIds.push(zoneId);
    await seedVenue(f.owner, f.sector, { zoneId }); // venue 1: in the zone
    await db.insert(campaignZones).values({ campaignId: f.campaignId, zoneId });
    mockSession(f.advertiser);
    const res = await getCmax(f.campaignId);
    // Only the in-zone venue: the zone-less venue is filtered out.
    expect(res.json()).toEqual({
      c_max_tnd: 540,
      i_max_facturable: 36_000,
      eligible_count: 1,
      targeted_count: 1,
    });
  });

  it('E5.1 — a ZERO-LINE campaign prices the FULL network (VF US-2.1: empty = whole network)', async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sectorA, sectorB] = await ownerSectorIds();
    await seedVenue(owner, sectorA);
    await seedVenue(owner, sectorB); // a DIFFERENT sector — only whole-network semantics sums both
    const creativeId = await seedCreative(advertiser, 10);
    const campaignId = await seedCampaign(advertiser, { creativeId }); // NO targeting rows
    mockSession(advertiser);
    const res = await getCmax(campaignId);
    expect(res.json()).toEqual({
      c_max_tnd: 1080,
      i_max_facturable: 72_000,
      eligible_count: 2,
      targeted_count: 2,
    });
  });

  it('impossible targeting still yields the zero ceiling (the FE zero-state premise holds)', async () => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sectorA, sectorB] = await ownerSectorIds();
    await seedVenue(owner, sectorA);
    const creativeId = await seedCreative(advertiser, 10);
    const campaignId = await seedCampaign(advertiser, { creativeId });
    await targetSector(campaignId, sectorB); // targeted sector has NO venues
    mockSession(advertiser);
    const res = await getCmax(campaignId);
    expect(res.json()).toEqual({
      c_max_tnd: 0,
      i_max_facturable: 0,
      eligible_count: 0,
      targeted_count: 0,
    });
  });

  // ── the 409 CMAX_REQUIRES matrix ───────────────────────────────────────────
  it.each([
    [{ dates: false, creative: true }, ['dates']],
    [{ dates: true, creative: false }, ['creative']],
    [{ dates: false, creative: false }, ['dates', 'creative']],
  ])('409 CMAX_REQUIRES %j → missing %j', async (have, missing) => {
    const advertiser = await seedUser();
    const creativeId = have.creative ? await seedCreative(advertiser, 10) : null;
    const campaignId = await seedCampaign(advertiser, {
      creativeId,
      ...(have.dates ? {} : { startDate: null, endDate: null }),
    });
    mockSession(advertiser);
    const res = await getCmax(campaignId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CMAX_REQUIRES', missing });
  });

  // ── the submit gate at the boundary ────────────────────────────────────────
  const submitFixture = async (requestedBudget: string) => {
    const advertiser = await seedUser();
    const owner = await seedUser({ role: 'individual_owner' });
    const [sector] = await ownerSectorIds();
    const creativeId = await seedCreative(advertiser, 10);
    // A future window satisfying the J+lead floor, derived VIA THE LIB (never hardcoded);
    // affluence on all 7 weekdays keeps Hi = 2×10 whatever weekday the floor lands on.
    const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
    const start = premiereDateDisponible(new Date(), lead);
    const end = plusCalendarDays(start, 1);
    const campaignId = await seedCampaign(advertiser, {
      creativeId,
      startDate: start,
      endDate: end,
      requestedBudget,
    });
    await targetSector(campaignId, sector);
    // ISO days 1=Mon…7=Sun (the affluence convention) — every weekday carries affluence so the
    // future-dated 2-day window prices identically wherever the J+lead floor lands.
    await seedVenue(owner, sector, { dows: [1, 2, 3, 4, 5, 6, 7] });
    return { advertiser, campaignId };
  };

  it('submit at requested_budget == C_max PASSES (the boundary is inclusive)', async () => {
    const f = await submitFixture('540.00');
    mockSession(f.advertiser);
    const res = await submit(f.campaignId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'pending' });
  });

  it('submit at C_max+1 → 400 BUDGET_EXCEEDS_CMAX carrying the ceiling', async () => {
    const f = await submitFixture('541.00');
    mockSession(f.advertiser);
    const res = await submit(f.campaignId);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BUDGET_EXCEEDS_CMAX', c_max_tnd: 540 });
    const [row] = await db
      .select({ status: campaigns.status })
      .from(campaigns)
      .where(eq(campaigns.id, f.campaignId));
    expect(row?.status).toBe('draft'); // the refusal never flips the status
  });

  // ── auth/scoping ───────────────────────────────────────────────────────────
  it('401 without a session; foreign ≡ missing 404', async () => {
    const f = await fullFixture();
    const stranger = await seedUser();
    mockNoSession();
    expect((await getCmax(f.campaignId)).statusCode).toBe(401);
    mockSession(stranger);
    const foreign = await getCmax(f.campaignId);
    const missing = await getCmax('00000000-0000-4000-8000-000000000000');
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
  });
});
