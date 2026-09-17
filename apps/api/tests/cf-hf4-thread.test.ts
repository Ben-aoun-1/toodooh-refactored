import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  cartItems,
  creatives,
  screenhostAffluence,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import { screenRegistry } from '../src/lib/playout/registry.js';
import { adminCreativesRoutes } from '../src/routes/admin-creatives.js';
import { campaignsRoutes } from '../src/routes/campaigns.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { campaignTiersOf } from './helpers/cpm-config.js';
import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// CF-HF4 — the thread batch:
//  - ENGAGEMENT is window-overlap-aware + terminal-releasing (the r_i=1 anti-concentration
//    fingerprint becomes the regression: a September pricing no longer collapses under July
//    engagements; an ended campaign or a REFUSE allocation engages nothing; EN_ATTENTE
//    within-window still engages — the as-found rule, kept);
//  - the saturated ≠ empty-targeting refusal split (dispatch + cmax surfaces);
//  - creative validation at PANIER-ADD (the queue's derived submission gate; the stored
//    pending/approved/rejected machine untouched — no migration);
//  - the live playlist re-push on an ACCEPTE flip (registry-targeted, disconnected = no-op).
// Real Postgres; sessions mocked. No business_sectors/zones rows added (the fixture footgun).

vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'individual_owner'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

// The two windows of the fingerprint: a JULY campaign whose engagements USED to leak into a
// SEPTEMBER pricing (they never overlap).
const JULY = { start: '2026-07-06', end: '2026-07-07' }; // Mon–Tue
const SEPT = { start: '2026-09-07', end: '2026-09-08' }; // Mon–Tue

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `hf4-${seq}@example.com`,
      contactName: `HF4 User ${seq}`,
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

/** A venue open 8–18, affluence 100 on Mon+Tue (the e2 covering fixture). */
const seedVenue = async (
  opts: { ownerId?: string } = {},
): Promise<{ shId: string; ownerId: string }> => {
  const ownerId = opts.ownerId ?? (await seedUser({ role: 'individual_owner' }));
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `HF4 Venue ${seq}`,
      ownerId,
      businessSectorId: await ownerSectorId(),
      class: 'premium' as never,
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const shId = sh?.id ?? '';
  const rows = [];
  for (const dow of [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: shId, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(bothHalves(rows));
  return { shId, ownerId };
};

const seedCampaign = async (opts: {
  start: string;
  end: string;
  status?: string;
  creative?: 'approved' | 'pending' | null;
  name?: string;
}): Promise<{ campaignId: string; advertiserId: string; creativeId: string | null }> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  let creativeId: string | null = null;
  if (opts.creative) {
    const [c] = await db
      .insert(creatives)
      .values({
        advertiserId,
        creativeType: 'video',
        storageKey: `creatives/hf4/${seq}-${Math.random().toString(16).slice(2)}`,
        durationSeconds: 10,
        validationStatus: opts.creative,
        mimeType: 'video/mp4',
      })
      .returning();
    creativeId = c?.id ?? null;
  }
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: opts.name ?? `HF4 campagne ${seq}`,
      campaignType: 'standard',
      status: (opts.status ?? 'active') as never,
      startDate: opts.start,
      endDate: opts.end,
      requestedBudget: '150.00',
      creativeId,
    })
    .returning();
  return { campaignId: c?.id ?? '', advertiserId, creativeId };
};

/** A frozen plan + one allocation for the campaign on the venue (the engagement source). */
const seedEngagement = async (
  campaignId: string,
  shId: string,
  opts: {
    rI?: number;
    s?: number;
    statut?: 'EN_ATTENTE' | 'ACCEPTE' | 'REFUSE';
    creneaux?: DispatchCreneau[];
  } = {},
): Promise<string> => {
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId,
      iCible: 10000,
      cpm: '15.000',
      sSpotSeconds: opts.s ?? 10,
      tTierCoef: '0.600',
      seuilDiffusable: 1000,
      sMin: '100',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 10000,
      nMin: 1,
      nMax: 5,
      nRetenus: 1,
    })
    .returning();
  const [a] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId: plan?.id ?? '',
      screenhostId: shId,
      iiPotentiel: 1000,
      rI: opts.rI ?? 30,
      revenuPrevisionnel: '15.0000',
      statutAcceptation: opts.statut ?? 'ACCEPTE',
      creneaux: opts.creneaux ?? [],
    })
    .returning();
  return a?.id ?? '';
};

const POOL_INPUTS = { s: 10, t: 0.6, fMaxSeconds: 300 };
const FAKE_ID = '00000000-0000-0000-0000-000000000000';

describe('CF-HF4 — the thread batch (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('the engagement matrix — window-overlap + terminal release', () => {
    it('a NON-overlapping engagement engages NOTHING (the September-vs-July fingerprint)', async () => {
      const { shId } = await seedVenue();
      const july = await seedCampaign({ ...JULY, status: 'active' });
      await seedEngagement(july.campaignId, shId, { rI: 30, s: 10 }); // 300 s = the whole F budget

      // Pricing SEPTEMBER: the July engagement is invisible — full residual, full reps.
      const sept = await assemblePool(
        db,
        { id: FAKE_ID, startDate: SEPT.start, endDate: SEPT.end },
        POOL_INPUTS,
      );
      expect(sept.pool.find((p) => p.id === shId)?.repsCap).toBe(30);

      // Pricing JULY (overlap): the same engagement saturates the venue out of the pool.
      const julyPool = await assemblePool(
        db,
        { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end },
        POOL_INPUTS,
      );
      expect(julyPool.pool.find((p) => p.id === shId)).toBeUndefined();
      expect(julyPool.candidateCount).toBeGreaterThan(0); // saturated, not untargeted
    });

    it('a PARTIAL overlap engages (per-window granularity — conservative, never overselling)', async () => {
      const { shId } = await seedVenue();
      const july = await seedCampaign({ start: '2026-07-06', end: '2026-09-07', status: 'active' });
      await seedEngagement(july.campaignId, shId, { rI: 30, s: 10 });
      const sept = await assemblePool(
        db,
        { id: FAKE_ID, startDate: SEPT.start, endDate: SEPT.end },
        POOL_INPUTS,
      );
      expect(sept.pool.find((p) => p.id === shId)).toBeUndefined(); // straddles into the window → engages
    });

    it('terminal release: an ended (completed) campaign engages nothing even in-window', async () => {
      const { shId } = await seedVenue();
      const done = await seedCampaign({ ...JULY, status: 'completed' });
      await seedEngagement(done.campaignId, shId, { rI: 30, s: 10 });
      const julyPool = await assemblePool(
        db,
        { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end },
        POOL_INPUTS,
      );
      expect(julyPool.pool.find((p) => p.id === shId)?.repsCap).toBe(30);
    });

    it('a REFUSE allocation releases its seconds; EN_ATTENTE within-window still engages (as-found, kept)', async () => {
      const { shId } = await seedVenue();
      const refused = await seedCampaign({ ...JULY, status: 'active' });
      await seedEngagement(refused.campaignId, shId, { rI: 30, s: 10, statut: 'REFUSE' });
      let pool = await assemblePool(
        db,
        { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end },
        POOL_INPUTS,
      );
      expect(pool.pool.find((p) => p.id === shId)?.repsCap).toBe(30); // released

      const pending = await seedCampaign({ ...JULY, status: 'active' });
      await seedEngagement(pending.campaignId, shId, { rI: 12, s: 10, statut: 'EN_ATTENTE' });
      pool = await assemblePool(
        db,
        { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end },
        POOL_INPUTS,
      );
      // 120 s held → residual 180 → rEff 18: the undecided allocation still holds its antenna.
      expect(pool.pool.find((p) => p.id === shId)?.repsCap).toBe(18);
    });

    it('a September cmax is UNAFFECTED by July engagements (pinned)', async () => {
      const { shId } = await seedVenue();
      const sept = await seedCampaign({ ...SEPT, status: 'draft', creative: 'approved' });
      // CPM-1 / CPM-2 — the ceiling prices at the campaign's own rates and T tiers (captured at
      // its insert).
      const [septRow] = await db.select().from(campaigns).where(eq(campaigns.id, sept.campaignId));
      const septCmaxInput = {
        id: sept.campaignId,
        startDate: SEPT.start,
        endDate: SEPT.end,
        campaignType: 'standard',
        standardCpmTnd: septRow?.standardCpmTnd ?? '',
        eventCpmTnd: septRow?.eventCpmTnd ?? '',
        t10s: septRow?.t10s ?? '',
        t20s: septRow?.t20s ?? '',
        t30s: septRow?.t30s ?? '',
      };
      const before = await computeCampaignCmax(septCmaxInput, 10);
      const july = await seedCampaign({ ...JULY, status: 'active' });
      await seedEngagement(july.campaignId, shId, { rI: 30, s: 10 });
      const after = await computeCampaignCmax(septCmaxInput, 10);
      expect(after).toEqual(before);
      expect(after.cMaxTnd).toBeGreaterThan(0);
    });

    it('the r_i=1 dispersion fingerprint: the collapse scenario now CONCENTRATES', async () => {
      // Two venues, each with an old NON-overlapping campaign holding 290 of 300 seconds — the
      // pre-fix world priced September against them: residual 10 s → rEff 1 → 1-rep slivers
      // scattered anti-concentrically. Post-fix the old engagements are invisible and the new
      // campaign concentrates on ONE venue at full reps.
      const a = await seedVenue();
      const b = await seedVenue();
      for (const v of [a, b]) {
        const old = await seedCampaign({ ...JULY, status: 'active' });
        await seedEngagement(old.campaignId, v.shId, { rI: 29, s: 10 }); // 290 s of 300
      }
      const fresh = await seedCampaign({ ...SEPT, status: 'pending', creative: 'approved' });
      // i_cible 20000 = ONE venue's full capacity (Ai=100, Hi=20, R=30, t applied by inputs):
      // capacité facturable = 100×20×30×0.6 = 36 000 ≥ 20 000 → coverable by a single venue.
      const result = await runDispatch(
        { id: fresh.campaignId, name: 'HF4 concentre', startDate: SEPT.start, endDate: SEPT.end },
        { iCible: 20000, cpm: 15, s: 10, tiers: await campaignTiersOf(fresh.campaignId) },
      );
      expect(result.status).toBe('OK');
      const [plan] = await db
        .select({ id: campaignDispatchPlan.id })
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, fresh.campaignId));
      const allocs = await db
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
      expect(allocs).toHaveLength(1); // concentration — not a sliver per venue
      // Cover-derived reps: 20 000 fact ÷ 0.6 = 33 334 physical over Hi 20 h ÷ Ai 100 → 16/h —
      // an order of magnitude above the r_i = 1 slivers of the collapse world.
      expect(allocs[0]?.rI).toBe(16);
    });
  });

  describe('the saturated ≠ empty-targeting split', () => {
    it('dispatch: saturated inventory vs nothing-matches carry different flags', async () => {
      const { shId } = await seedVenue();
      const july = await seedCampaign({ ...JULY, status: 'active' });
      await seedEngagement(july.campaignId, shId, { rI: 30, s: 10 });
      const saturated = await seedCampaign({ ...JULY, status: 'pending', creative: 'approved' });
      const result = await runDispatch(
        { id: saturated.campaignId, name: 'HF4 sature', startDate: JULY.start, endDate: JULY.end },
        { iCible: 10000, cpm: 15, s: 10, tiers: await campaignTiersOf(saturated.campaignId) },
      );
      expect(result).toEqual({ status: 'NO_ELIGIBLE', saturated: true });
    });

    it('cmax exposes targeted_count for the wizard split', async () => {
      const { shId } = await seedVenue();
      const advId = await seedUser({ role: 'advertiser' });
      const [c] = await db
        .insert(campaigns)
        .values({
          advertiserId: advId,
          name: 'HF4 cmax split',
          campaignType: 'standard',
          status: 'draft',
          startDate: SEPT.start,
          endDate: SEPT.end,
          requestedBudget: '150.00',
          creativeId: (
            await db
              .insert(creatives)
              .values({
                advertiserId: advId,
                creativeType: 'video',
                storageKey: `creatives/hf4/cmax-${seq}`,
                durationSeconds: 10,
                validationStatus: 'approved',
              })
              .returning()
          )[0]?.id,
        })
        .returning();
      const app = Fastify({ logger: false });
      await app.register(campaignsRoutes);
      await app.ready();
      try {
        mockSession(advId, 'advertiser');
        const res = await app.inject({ method: 'GET', url: `/api/campaigns/${c?.id}/cmax` });
        expect(res.statusCode).toBe(200);
        expect(res.json().targeted_count).toBeGreaterThan(0);
        expect(res.json().eligible_count).toBeGreaterThan(0);
        void shId;
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }
    });
  });

  describe('creative validation at panier-add (the derived queue gate)', () => {
    const buildQueueApp = async () => {
      const app = Fastify({ logger: false });
      await app.register(adminCreativesRoutes);
      await app.ready();
      return app;
    };

    it('upload-only → absent from the queue; panier-add → present; submitted campaign → present', async () => {
      const app = await buildQueueApp();
      try {
        const adminId = await seedUser({ role: 'admin' });
        const advId = await seedUser({ role: 'advertiser' });
        const [orphan] = await db
          .insert(creatives)
          .values({
            advertiserId: advId,
            creativeType: 'video',
            storageKey: 'creatives/hf4/orphan',
            durationSeconds: 10,
            validationStatus: 'pending',
            title: 'HF4 Orphan',
          })
          .returning();

        mockSession(adminId, 'admin');
        let res = await app.inject({ method: 'GET', url: '/api/admin/creatives?status=pending' });
        expect(res.statusCode).toBe(200);
        expect((res.json() as { id: string }[]).map((r) => r.id)).not.toContain(orphan?.id);

        // Panier-add: a DRAFT campaign linking the creative enters the cart → the spot queues.
        const [draft] = await db
          .insert(campaigns)
          .values({
            advertiserId: advId,
            name: 'HF4 Carted',
            campaignType: 'standard',
            status: 'draft',
            startDate: SEPT.start,
            endDate: SEPT.end,
            creativeId: orphan?.id,
          })
          .returning();
        await db.insert(cartItems).values({ userId: advId, campaignId: draft?.id ?? '' });
        res = await app.inject({ method: 'GET', url: '/api/admin/creatives?status=pending' });
        expect((res.json() as { id: string }[]).map((r) => r.id)).toContain(orphan?.id);

        // A SUBMITTED campaign (cart cleared, status pending) keeps the spot reviewable.
        await db.delete(cartItems).where(eq(cartItems.campaignId, draft?.id ?? ''));
        await db
          .update(campaigns)
          .set({ status: 'pending' })
          .where(eq(campaigns.id, draft?.id ?? ''));
        res = await app.inject({ method: 'GET', url: '/api/admin/creatives?status=pending' });
        expect((res.json() as { id: string }[]).map((r) => r.id)).toContain(orphan?.id);
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }
    });

    it('decided rows (approved — the CF-SK1 inherit shape) list unconditionally', async () => {
      const app = await buildQueueApp();
      try {
        const adminId = await seedUser({ role: 'admin' });
        const advId = await seedUser({ role: 'advertiser' });
        const [inherited] = await db
          .insert(creatives)
          .values({
            advertiserId: advId,
            creativeType: 'video',
            storageKey: 'creatives/hf4/inherited',
            durationSeconds: 10,
            validationStatus: 'approved', // the inherit path decides at upload — never queued
          })
          .returning();
        mockSession(adminId, 'admin');
        const res = await app.inject({
          method: 'GET',
          url: '/api/admin/creatives?status=approved',
        });
        expect((res.json() as { id: string }[]).map((r) => r.id)).toContain(inherited?.id);
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }
    });
  });

  describe('the live playlist re-push (ACCEPTE flip)', () => {
    it('the flip pushes UPDATE_PLAYLIST with the campaign to the venue sockets ONLY; disconnected = no-op', async () => {
      const app = Fastify({ logger: false });
      await app.register(screenhostsRoutes);
      await app.ready();
      const today = new Date().toISOString().slice(0, 10);
      const plus5 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      try {
        const venue = await seedVenue();
        const other = await seedVenue();
        const live = await seedCampaign({
          start: today,
          end: plus5,
          status: 'active',
          creative: 'approved',
        });
        const allocationId = await seedEngagement(live.campaignId, venue.shId, {
          statut: 'EN_ATTENTE',
          rI: 10,
          s: 10,
        });
        const [screen] = await db
          .insert(screens)
          .values({ screenhostId: venue.shId, name: 'HF4 TV' })
          .returning();
        const [otherScreen] = await db
          .insert(screens)
          .values({ screenhostId: other.shId, name: 'HF4 Other TV' })
          .returning();

        const socket = { send: vi.fn() };
        const otherSocket = { send: vi.fn() };
        screenRegistry.add(screen?.id ?? '', socket as never);
        screenRegistry.add(otherScreen?.id ?? '', otherSocket as never);
        try {
          mockSession(venue.ownerId);
          const res = await app.inject({
            method: 'POST',
            url: `/api/screenhosts/allocations/${allocationId}/accept`,
          });
          expect(res.statusCode).toBe(200);

          expect(socket.send).toHaveBeenCalledTimes(1);
          const sent = JSON.parse(socket.send.mock.calls[0]?.[0] as string) as {
            cmd: string;
            data: { videos: { id: string }[] } | { id: string }[];
          };
          expect(sent.cmd).toBe('UPDATE_PLAYLIST');
          expect(JSON.stringify(sent.data)).toContain(live.campaignId);
          expect(otherSocket.send).not.toHaveBeenCalled(); // unaffected venue untouched
        } finally {
          screenRegistry.remove(screen?.id ?? '', socket as never);
          screenRegistry.remove(otherScreen?.id ?? '', otherSocket as never);
        }

        // Disconnected venue: a second flip cycle with NO registered socket is a clean no-op.
        const live2 = await seedCampaign({
          start: today,
          end: plus5,
          status: 'active',
          creative: 'approved',
        });
        const alloc2 = await seedEngagement(live2.campaignId, venue.shId, {
          statut: 'EN_ATTENTE',
          rI: 5,
          s: 10,
        });
        const res2 = await app.inject({
          method: 'POST',
          url: `/api/screenhosts/allocations/${alloc2}/accept`,
        });
        expect(res2.statusCode).toBe(200); // no socket, no throw, the flip stands
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }
    });
  });
});
