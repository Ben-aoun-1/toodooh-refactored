import { asc, eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  campaignTargeting,
  eventAttestations,
  events,
  notifications,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { campaignTiersOf } from './helpers/cpm-config.js';
import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// E3 — the refusal cascade (US-2.8), real Postgres, driven through the REAL reject route. Engine
// fixtures mirror campaign-dispatch.test.ts: cpm 10 / s 10 → T 0.6, seuil = seuilImpressions(10)
// = 2000; a venue with affluence Ai over the 2-day window (Hi = 20, R = 30) has facturable
// capacity 360·Ai (Ai 100 → 36 000, Ai 10 → 3 600, Ai 7 → 2 520).

// Atomicity probe — arming the bomb makes the CASCADE's pool assembly throw, so the whole reject
// transaction (including the REFUSE write) must roll back.
const cascadeBomb = vi.hoisted(() => ({ armed: false }));
vi.mock('../src/lib/dispatch/pool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/dispatch/pool.js')>();
  const assemblePool: typeof actual.assemblePool = async (...args) => {
    if (cascadeBomb.armed) throw new Error('cascade bomb');
    return actual.assemblePool(...args);
  };
  return { ...actual, assemblePool };
});

// The screenhostsRoutes plugin imports the wedooh sync — stubbed, same isolation as the
// allocation suite.
vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });
const mockSession = (userId: string): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role: 'individual_owner', status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `casc${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const ownerSectorId = async (): Promise<string> => {
  const [s] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  return s?.id ?? '';
};

const seedCampaign = async (advertiserId: string, name: string): Promise<string> => {
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name,
      campaignType: 'standard',
      status: 'draft',
      startDate: '2024-01-01', // Mon
      endDate: '2024-01-02', // Tue
    })
    .returning();
  return c?.id ?? '';
};

const setCampaignStatus = (
  id: string,
  status: 'pending' | 'upcoming' | 'active',
): Promise<unknown> => db.update(campaigns).set({ status }).where(eq(campaigns.id, id));

// An eligible venue with explicit SPS (the cascade queue orders by SPS desc) and affluence.
const seedVenue = async (
  ownerId: string,
  categoryId: string,
  sps: number,
  affluence: number,
): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `Venue sps${sps}`,
      ownerId,
      businessSectorId: categoryId,
      class: 'premium' as never,
      sps: String(sps),
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const id = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: id, dayOfWeek: dow, hour: h, estimatedImpressions: affluence });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  await seedInstalledScreen(id);

  // SPS-DISPATCH1 — these venues are ordered BY their stored sps, which is the whole point of the
  // cascade tests. A venue with no history at all now ranks at the neutral midpoint instead (its
  // stored score would be made of defaults), so give each one a single real observation: an
  // inspection it passed. That leaves every SPS VALUE untouched — respect was already 100 by the
  // EVENT_RESPECT_DEFAULT rule — and simply makes the stored score an earned one.
  const [ev] = await db
    .insert(events)
    .values({
      name: `Cascade inspection ${sps}`,
      kickoffAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
    })
    .returning();
  await db
    .insert(eventAttestations)
    .values({ eventId: ev?.id ?? '', screenhostId: id, authorId: ownerId, respecte: true });
  return id;
};

const dispatchNow = async (campaignId: string, name: string, iCible: number) => {
  const result = await runDispatch(
    { id: campaignId, name, startDate: '2024-01-01', endDate: '2024-01-02' },
    { iCible, cpm: 10, s: 10, tiers: await campaignTiersOf(campaignId) },
  );
  expect(result.status).toBe('OK');
};

const planFor = async (campaignId: string) => {
  const [plan] = await db
    .select()
    .from(campaignDispatchPlan)
    .where(eq(campaignDispatchPlan.campaignId, campaignId));
  return plan;
};

const allocsFor = async (campaignId: string) => {
  const plan = await planFor(campaignId);
  return db
    .select()
    .from(campaignDispatchAllocation)
    .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''))
    .orderBy(asc(campaignDispatchAllocation.createdAt));
};

const allocOn = async (campaignId: string, screenhostId: string) => {
  const allocs = await allocsFor(campaignId);
  return allocs.find((a) => a.screenhostId === screenhostId);
};

const notifsFor = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe('E3 refusal cascade (US-2.8, real Postgres, via the reject route)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    cascadeBomb.armed = false;
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sql.end();
  });

  const reject = (ownerId: string, allocationId: string) => {
    mockSession(ownerId);
    return app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/reject`,
    });
  };
  const accept = (ownerId: string, allocationId: string) => {
    mockSession(ownerId);
    return app.inject({
      method: 'POST',
      url: `/api/screenhosts/allocations/${allocationId}/accept`,
    });
  };

  it('E5.1 PIN: a ZERO-LINE campaign’s refusal cascades (empty targeting = whole network)', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const [oA, oB, oC] = await Promise.all(
      Array.from({ length: 3 }, () => seedUser({ role: 'individual_owner' })),
    );
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA ?? '', cat, 90, 100); // 36 000
    const shB = await seedVenue(oB ?? '', cat, 80, 100); // partial 2 400
    const shC = await seedVenue(oC ?? '', cat, 70, 10); // 3 600 — the absorber
    const campaignId = await seedCampaign(advertiser, 'Cascade WholeNet');
    // NO targeting rows — pre-E5.1 both the dispatch and the cascade assembly refused.

    await dispatchNow(campaignId, 'Cascade WholeNet', 38400);
    await setCampaignStatus(campaignId, 'pending');
    const allocB = await allocOn(campaignId, shB);
    expect(allocB?.iiPotentiel).toBe(2400);

    const res = await reject(oB ?? '', allocB?.id ?? '');
    expect(res.statusCode).toBe(200);
    const onC = await allocOn(campaignId, shC);
    expect(onC?.statutAcceptation).toBe('EN_ATTENTE');
    expect(onC?.iiPotentiel).toBe(2400);
    expect(await allocOn(campaignId, shA)).toBeDefined(); // the retained venue untouched
  });

  it('HAPPY PATH: the refused share lands on the next-best SPS venue (new EN_ATTENTE row + notification)', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const [oA, oB, oC, oD] = await Promise.all(
      Array.from({ length: 4 }, () => seedUser({ role: 'individual_owner' })),
    );
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA ?? '', cat, 90, 100); // 36 000
    const shB = await seedVenue(oB ?? '', cat, 80, 100); // 36 000
    const shC = await seedVenue(oC ?? '', cat, 70, 10); // 3 600 — next-best after B
    const shD = await seedVenue(oD ?? '', cat, 60, 10); // 3 600 — must NOT be picked before C
    const campaignId = await seedCampaign(advertiser, 'Cascade Happy');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    // A 36 000 (full) + B 2 400 → couvert 38 400; C/D not retained.
    await dispatchNow(campaignId, 'Cascade Happy', 38400);
    await setCampaignStatus(campaignId, 'pending'); // pre-diffusion → the cascade applies
    const allocB = await allocOn(campaignId, shB);
    expect(allocB?.iiPotentiel).toBe(2400);

    const res = await reject(oB ?? '', allocB?.id ?? '');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: allocB?.id, statut_acceptation: 'REFUSE' });

    // The refused row STAYS (visible history), its share re-placed on C — the best remaining SPS
    // with residual capacity (A is fully engaged → not eligible; D is lower SPS).
    const refused = await allocOn(campaignId, shB);
    expect(refused?.statutAcceptation).toBe('REFUSE');
    expect(refused?.iiPotentiel).toBe(2400);
    const onC = await allocOn(campaignId, shC);
    expect(onC?.statutAcceptation).toBe('EN_ATTENTE');
    expect(onC?.iiPotentiel).toBe(2400);
    expect(await allocOn(campaignId, shD)).toBeUndefined();
    expect(await allocOn(campaignId, shA)).toMatchObject({ iiPotentiel: 36000 });

    // Fully absorbed: nothing stored, not partial; the new venue's owner is notified.
    const plan = await planFor(campaignId);
    expect(plan?.reliquatStocke).toBe(0);
    expect(plan?.isPartial).toBe(false);
    const cNotifs = await notifsFor(oC ?? '');
    expect(cNotifs).toHaveLength(1);
    expect(cNotifs[0]).toMatchObject({ type: 'dispatch_pending_acceptance', campaignId });
    expect(cNotifs[0]?.body).toContain('Cascade Happy');
  });

  it('CHAIN + AMENDMENT: partial absorb continues down the queue; the sub-seuil remainder is STORED', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const [oA, oB, oC, oD] = await Promise.all(
      Array.from({ length: 4 }, () => seedUser({ role: 'individual_owner' })),
    );
    const cat = await ownerSectorId();
    await seedVenue(oA ?? '', cat, 90, 100); // 36 000
    const shB = await seedVenue(oB ?? '', cat, 80, 100); // 36 000
    const shC = await seedVenue(oC ?? '', cat, 70, 10); // 3 600
    const shD = await seedVenue(oD ?? '', cat, 60, 7); // 2 520
    const campaignId = await seedCampaign(advertiser, 'Cascade Chain');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    // A 36 000 + B 8 000 → couvert 44 000.
    await dispatchNow(campaignId, 'Cascade Chain', 44000);
    await setCampaignStatus(campaignId, 'upcoming');
    const allocB = await allocOn(campaignId, shB);
    expect(allocB?.iiPotentiel).toBe(8000);

    expect((await reject(oB ?? '', allocB?.id ?? '')).statusCode).toBe(200);

    // V=8 000: C absorbs its full 3 600, the remainder continues to D (2 520 ≥ seuil 2 000);
    // the final 1 880 is BELOW the seuil → per the amendment it JOINS the stored reliquat
    // (not dropped, not a clôture-1).
    expect((await allocOn(campaignId, shC))?.iiPotentiel).toBe(3600);
    expect((await allocOn(campaignId, shD))?.iiPotentiel).toBe(2520);
    const plan = await planFor(campaignId);
    expect(plan?.reliquatStocke).toBe(1880);
    expect(plan?.isPartial).toBe(false);
    expect(await notifsFor(oC ?? '')).toHaveLength(1);
    expect(await notifsFor(oD ?? '')).toHaveLength(1);
  });

  it('MERGE (La Cloche d’Or → Les Dunes): a RETAINED venue with residual capacity absorbs more — same row, back EN_ATTENTE, owner re-notified; the ≥-seuil rest flips PARTIAL', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const oA = await seedUser({ role: 'individual_owner' });
    const oB = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA, cat, 90, 100); // 36 000 — fully consumed
    const shB = await seedVenue(oB, cat, 80, 100); // 36 000 — retained for 4 000, has residual
    const campaignId = await seedCampaign(advertiser, 'Cascade Merge');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    // A 36 000 (r_i 30 → 300s, no residual) + B 4 000 (r_i 3 → 30s, 270s residual) = 40 000.
    await dispatchNow(campaignId, 'Cascade Merge', 40000);
    await setCampaignStatus(campaignId, 'upcoming');
    const allocA = await allocOn(campaignId, shA);
    const allocBBefore = await allocOn(campaignId, shB);
    expect(allocA?.iiPotentiel).toBe(36000);
    expect(allocBBefore).toMatchObject({ iiPotentiel: 4000, rI: 3 });
    // Owner B had accepted — the enlarged share must still re-ask them.
    expect((await accept(oB, allocBBefore?.id ?? '')).statusCode).toBe(200);

    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);

    // B's residual budget (270s → 27 reps → 32 400 facturable) merges ONTO ITS EXISTING ROW:
    // 4 000 + 32 400 = 36 400, r_i recomputed on the total (30 → the full 300s hour), statut back
    // to EN_ATTENTE (the deal changed), revenue updated — and still exactly ONE row for B.
    const allocBAfter = await allocOn(campaignId, shB);
    expect(allocBAfter?.id).toBe(allocBBefore?.id);
    expect(allocBAfter).toMatchObject({
      iiPotentiel: 36400,
      rI: 30,
      statutAcceptation: 'EN_ATTENTE',
    });
    expect(Number(allocBAfter?.revenuPrevisionnel)).toBe(364);
    expect(allocBAfter?.creneaux[0]?.reps).toBe(30);
    expect((await allocsFor(campaignId)).filter((a) => a.screenhostId === shB)).toHaveLength(1);

    // The refused row is untouched history; the unabsorbable 3 600 ≥ seuil → clôture-1 flips.
    expect(await allocOn(campaignId, shA)).toMatchObject({
      statutAcceptation: 'REFUSE',
      iiPotentiel: 36000,
    });
    const plan = await planFor(campaignId);
    expect(plan?.isPartial).toBe(true);
    expect(plan?.reliquatStocke).toBe(0); // ≥ seuil → NOT stored
    // Σ(r_i × S) on B never exceeds the 300s hour despite the merge.
    expect((allocBAfter?.rI ?? 0) * 10).toBeLessThanOrEqual(300);
    // Dispatch notified O_B once; the cascade re-notifies for the re-acceptance.
    expect(await notifsFor(oB)).toHaveLength(2);
  });

  it('NOTHING ABSORBABLE: an empty residual pool with a ≥-seuil share → isPartial flips, no rows, no notifications', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const oA = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA, cat, 90, 100);
    const campaignId = await seedCampaign(advertiser, 'Cascade Alone');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    await dispatchNow(campaignId, 'Cascade Alone', 36000);
    await setCampaignStatus(campaignId, 'pending');
    const allocA = await allocOn(campaignId, shA);

    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);

    expect(await allocsFor(campaignId)).toHaveLength(1); // only the REFUSE row
    const plan = await planFor(campaignId);
    expect(plan?.isPartial).toBe(true); // 36 000 ≥ seuil → clôture-1, NOT stored
    expect(plan?.reliquatStocke).toBe(0);
  });

  it('ACTIVE campaign: refusal does NOT cascade (banked to E6) — status flips, nothing else moves', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const oA = await seedUser({ role: 'individual_owner' });
    const oC = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA, cat, 90, 100);
    await seedVenue(oC, cat, 70, 10); // would absorb if the cascade (wrongly) ran
    const campaignId = await seedCampaign(advertiser, 'Cascade Active');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    await dispatchNow(campaignId, 'Cascade Active', 36000);
    await setCampaignStatus(campaignId, 'active');
    const allocA = await allocOn(campaignId, shA);

    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);

    expect((await allocOn(campaignId, shA))?.statutAcceptation).toBe('REFUSE');
    expect(await allocsFor(campaignId)).toHaveLength(1); // no re-placement mid-diffusion
    const plan = await planFor(campaignId);
    expect(plan?.isPartial).toBe(false);
    expect(plan?.reliquatStocke).toBe(0);
    expect(await notifsFor(oC)).toHaveLength(0);
  });

  it('TWO-HOP RECASCADE: a cascade-created/merged allocation refused again cascades again through the same route', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const oA = await seedUser({ role: 'individual_owner' });
    const oB = await seedUser({ role: 'individual_owner' });
    const oC = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA, cat, 90, 100); // 36 000
    const shB = await seedVenue(oB, cat, 80, 100); // 36 000
    const shC = await seedVenue(oC, cat, 70, 10); // 3 600
    const campaignId = await seedCampaign(advertiser, 'Cascade TwoHop');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    // A 36 000 + B 4 000 → 40 000; C not retained.
    await dispatchNow(campaignId, 'Cascade TwoHop', 40000);
    await setCampaignStatus(campaignId, 'upcoming');

    // HOP 1 — refuse A (36 000): B merges +32 400 → 36 400; C opens 3 600; fully absorbed.
    const allocA = await allocOn(campaignId, shA);
    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);
    const allocB = await allocOn(campaignId, shB);
    expect(allocB).toMatchObject({ iiPotentiel: 36400, statutAcceptation: 'EN_ATTENTE' });
    expect((await allocOn(campaignId, shC))?.iiPotentiel).toBe(3600);
    expect((await planFor(campaignId))?.isPartial).toBe(false);

    // HOP 2 — refuse the ENLARGED B (36 400): A and B are both REFUSE-excluded, C is saturated
    // (300s) → nothing absorbable → clôture-1. Refused history survives on BOTH rows.
    expect((await reject(oB, allocB?.id ?? '')).statusCode).toBe(200);
    expect(await allocOn(campaignId, shA)).toMatchObject({
      statutAcceptation: 'REFUSE',
      iiPotentiel: 36000,
    });
    expect(await allocOn(campaignId, shB)).toMatchObject({
      statutAcceptation: 'REFUSE',
      iiPotentiel: 36400,
    });
    expect(await allocOn(campaignId, shC)).toMatchObject({
      statutAcceptation: 'EN_ATTENTE',
      iiPotentiel: 3600,
    });
    expect((await planFor(campaignId))?.isPartial).toBe(true);
  });

  it('REFUSE is DEFINITIVE: re-refuse is an idempotent 200 (no second cascade), accept-after-refuse is 409', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const oA = await seedUser({ role: 'individual_owner' });
    const oC = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA, cat, 90, 100);
    const shC = await seedVenue(oC, cat, 70, 10); // absorbs hop 1
    const campaignId = await seedCampaign(advertiser, 'Cascade Final');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    await dispatchNow(campaignId, 'Cascade Final', 2400); // A alone covers 2 400
    await setCampaignStatus(campaignId, 'pending');
    const allocA = await allocOn(campaignId, shA);

    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);
    const countAfterFirst = (await allocsFor(campaignId)).length;
    expect((await allocOn(campaignId, shC))?.iiPotentiel).toBe(2400);

    // Re-refuse: 200, but NO second cascade (C's row untouched, no new rows, no extra notif).
    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);
    expect((await allocsFor(campaignId)).length).toBe(countAfterFirst);
    expect(await notifsFor(oC)).toHaveLength(1);

    // Accept-after-refuse: the share is already re-placed — un-refusing would double-book it.
    const res = await accept(oA, allocA?.id ?? '');
    expect(res.statusCode).toBe(409);
    expect((await allocOn(campaignId, shA))?.statutAcceptation).toBe('REFUSE');
  });

  it('ATOMICITY: a failing cascade rolls back the REFUSE write too (same transaction)', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const oA = await seedUser({ role: 'individual_owner' });
    const oC = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shA = await seedVenue(oA, cat, 90, 100);
    await seedVenue(oC, cat, 70, 10);
    const campaignId = await seedCampaign(advertiser, 'Cascade Bomb');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });

    await dispatchNow(campaignId, 'Cascade Bomb', 2400);
    await setCampaignStatus(campaignId, 'upcoming');
    const allocA = await allocOn(campaignId, shA);

    cascadeBomb.armed = true;
    const res = await reject(oA, allocA?.id ?? '');
    cascadeBomb.armed = false;
    expect(res.statusCode).toBe(500);

    // ALL-OR-NOTHING: the refusal rolled back with the failed cascade — the owner can retry.
    expect((await allocOn(campaignId, shA))?.statutAcceptation).toBe('EN_ATTENTE');
    expect(await allocsFor(campaignId)).toHaveLength(1);
    expect(await notifsFor(oC)).toHaveLength(0);

    // The retry (bomb disarmed) succeeds end-to-end.
    expect((await reject(oA, allocA?.id ?? '')).statusCode).toBe(200);
    expect((await allocOn(campaignId, shA))?.statutAcceptation).toBe('REFUSE');
    expect(await notifsFor(oC)).toHaveLength(1);
  });
});
