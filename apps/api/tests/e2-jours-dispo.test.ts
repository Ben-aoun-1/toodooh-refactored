import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignTargeting,
  campaigns,
  creatives,
  screenhostAffluence,
  screenhostUnavailability,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { runBoost } from '../src/lib/boost.js';
import { computeCampaignCmax } from '../src/lib/campaign-cmax.js';
import { plusCalendarDays, premiereDateDisponible } from '../src/lib/campaign-dates.js';
import { getDispatchConfig } from '../src/lib/dispatch/config.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';
import {
  REDISPATCH_HEARTBEAT_TOLERANCE_MS,
  runRedispatchRound,
} from '../src/lib/dispatch/redispatch.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E2 (VF jours_dispo_i) — owner-declared per-day unavailability: capacity/créneaux/C_max respect
// it through ONE day source (PoolEntry.days); a fully-unavailable venue drops from the pool;
// FROZEN plans are never rewritten (ruling 2) and E6 still counts their manquements. Real
// Postgres; session mocked. No business_sectors/zones rows added (the fixture footgun).

const NOW = new Date('2026-07-20T12:30:00Z'); // Tunis 13:30 — hours 8..12 have ELAPSED
const MON = '2026-07-20';
const TUE = '2026-07-21';
const WED = '2026-07-22';

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

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `e2-${seq}@example.com`,
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

/** A venue with hours 8–18; affluence on the given ISO weekdays (default Mon+Tue). */
const seedVenue = async (
  cat: string,
  opts: { ownerId?: string; sps?: number; dows?: number[]; liveness?: 'alive' | 'dead' } = {},
): Promise<{ shId: string; ownerId: string }> => {
  const ownerId = opts.ownerId ?? (await seedUser({ role: 'individual_owner' }));
  seq += 1;
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `E2 Venue ${seq}`,
      ownerId,
      businessSectorId: cat,
      class: 'premium' as never,
      sps: String(opts.sps ?? 80),
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  const shId = sh?.id ?? '';
  const rows = [];
  for (const dow of opts.dows ?? [1, 2])
    for (let h = 8; h < 18; h += 1)
      rows.push({ screenhostId: shId, dayOfWeek: dow, hour: h, estimatedImpressions: 100 });
  await db.insert(screenhostAffluence).values(rows);
  if (opts.liveness) {
    const lastSeenAt =
      opts.liveness === 'alive'
        ? new Date(NOW.getTime() - 60_000)
        : new Date(NOW.getTime() - REDISPATCH_HEARTBEAT_TOLERANCE_MS - 60_000);
    await db.insert(screens).values({ screenhostId: shId, name: 'TV', lastSeenAt });
  }
  return { shId, ownerId };
};

const declare = (shId: string, day: string) =>
  db.insert(screenhostUnavailability).values({ screenhostId: shId, day }).onConflictDoNothing();

const seedCampaign = async (opts: {
  start: string;
  end: string;
  cat: string;
  status?: string;
  budget?: string;
}): Promise<{ campaignId: string; advertiserId: string; creativeId: string }> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/e2/${seq}-${Math.random().toString(16).slice(2)}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `E2 campagne ${seq}`,
      campaignType: 'standard',
      status: (opts.status ?? 'pending') as never,
      startDate: opts.start,
      endDate: opts.end,
      requestedBudget: opts.budget ?? '150.00',
      creativeId: creative?.id ?? null,
    })
    .returning();
  const campaignId = c?.id ?? '';
  await db.insert(campaignTargeting).values({ campaignId, categoryId: opts.cat, class: null });
  return { campaignId, advertiserId, creativeId: creative?.id ?? '' };
};

const creneauxFor = (dates: string[], impPerSlot: number, reps: number): DispatchCreneau[] => {
  const out: DispatchCreneau[] = [];
  for (const date of dates)
    for (let h = 8; h < 18; h += 1) out.push({ date, hour: h, reps, impressions: impPerSlot });
  return out;
};

const buildApp = () => Fastify({ logger: false });

describe('E2 — jours_dispo_i (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
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

  describe('the owner endpoints', () => {
    const put = (shId: string, day: string, unavailable: boolean) =>
      app.inject({
        method: 'PUT',
        url: `/api/screenhosts/${shId}/unavailability`,
        payload: { day, unavailable },
      });

    it('PUT matrix: future declare/undeclare idempotent both ways; past/today 400; foreign 404', async () => {
      const cat = await ownerSectorId();
      const venue = await seedVenue(cat);
      mockSession(venue.ownerId);
      const today = new Date().toISOString().slice(0, 10);
      const future = plusCalendarDays(today, 5);
      const future2 = plusCalendarDays(today, 6);

      // Declare, twice (idempotent — one row).
      expect((await put(venue.shId, future, true)).statusCode).toBe(200);
      expect((await put(venue.shId, future, true)).statusCode).toBe(200);
      const rows = await db
        .select()
        .from(screenhostUnavailability)
        .where(eq(screenhostUnavailability.screenhostId, venue.shId));
      expect(rows).toHaveLength(1);

      // Undeclare, twice (idempotent — zero rows, still 200).
      expect((await put(venue.shId, future, false)).statusCode).toBe(200);
      expect((await put(venue.shId, future, false)).statusCode).toBe(200);
      expect(
        await db
          .select()
          .from(screenhostUnavailability)
          .where(eq(screenhostUnavailability.screenhostId, venue.shId)),
      ).toHaveLength(0);

      // Past and today refuse — frozen history is the detector's business, not the owner's.
      const past = await put(venue.shId, '2020-01-01', true);
      expect(past.statusCode).toBe(400);
      expect(past.json<{ error: string }>().error).toBe('PAST_OR_TODAY');
      const todayRes = await put(venue.shId, today, true);
      expect(todayRes.statusCode).toBe(400);
      expect(todayRes.json<{ error: string }>().error).toBe('PAST_OR_TODAY');

      // Foreign venue ≡ missing.
      const stranger = await seedUser({ role: 'individual_owner' });
      mockSession(stranger);
      expect((await put(venue.shId, future2, true)).statusCode).toBe(404);
    });

    it('GET returns the declared days inside [from, to], sorted', async () => {
      const cat = await ownerSectorId();
      const venue = await seedVenue(cat);
      const today = new Date().toISOString().slice(0, 10);
      const d1 = plusCalendarDays(today, 3);
      const d2 = plusCalendarDays(today, 8);
      const outside = plusCalendarDays(today, 40);
      await declare(venue.shId, d2);
      await declare(venue.shId, d1);
      await declare(venue.shId, outside);
      mockSession(venue.ownerId);
      const res = await app.inject({
        method: 'GET',
        url: `/api/screenhosts/${venue.shId}/unavailability?from=${today}&to=${plusCalendarDays(today, 30)}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ days: string[] }>().days).toEqual([d1, d2]); // sorted, range-bounded
    });
  });

  describe('the engine — one day source', () => {
    it('THE VF SCENARIO: a declared day shrinks capacity EXACTLY ∝ and the entry days drop it', async () => {
      const cat = await ownerSectorId();
      const venue = await seedVenue(cat);
      const f = await seedCampaign({ start: MON, end: TUE, cat });
      await declare(venue.shId, TUE);

      const { pool } = await assemblePool(
        db,
        { id: f.campaignId, startDate: MON, endDate: TUE },
        { s: 10, t: 0.6, fMaxSeconds: 300 },
      );
      const entry = pool.find((p) => p.id === venue.shId);
      // 1 of 2 days declared → Hi 10 (was 20), capacity 18 000 (was 36 000) — exactly ∝.
      expect(entry?.hours).toBe(10);
      expect(entry?.capaciteUtile).toBe(18_000);
      expect(entry?.days.map((d) => d.date)).toEqual([MON]);
    });

    it('dispatch créneaux NEVER land on a declared day (capacity and créneaux share the day source)', async () => {
      const cat = await ownerSectorId();
      const venue = await seedVenue(cat);
      const f = await seedCampaign({ start: MON, end: TUE, cat });
      await declare(venue.shId, TUE);

      const result = await runDispatch(
        { id: f.campaignId, name: 'E2', startDate: MON, endDate: TUE },
        { iCible: 10_000, cpm: 15, s: 10 },
      );
      expect(result.status).toBe('OK');
      const [plan] = await db
        .select({ id: campaignDispatchPlan.id })
        .from(campaignDispatchPlan)
        .where(eq(campaignDispatchPlan.campaignId, f.campaignId));
      const allocs = await db
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
      expect(allocs.length).toBeGreaterThan(0);
      for (const a of allocs) {
        expect(a.creneaux.length).toBeGreaterThan(0);
        for (const c of a.creneaux) expect(c.date).toBe(MON); // TUE is declared — nothing there
      }
    });

    it('US-2.1: a venue unavailable across the ENTIRE window drops from the pool → the dispatch refuses', async () => {
      const cat = await ownerSectorId();
      const venue = await seedVenue(cat);
      const f = await seedCampaign({ start: MON, end: TUE, cat });
      await declare(venue.shId, MON);
      await declare(venue.shId, TUE);

      const { pool } = await assemblePool(
        db,
        { id: f.campaignId, startDate: MON, endDate: TUE },
        { s: 10, t: 0.6, fMaxSeconds: 300 },
      );
      expect(pool.find((p) => p.id === venue.shId)).toBeUndefined();

      const result = await runDispatch(
        { id: f.campaignId, name: 'E2', startDate: MON, endDate: TUE },
        { iCible: 10_000, cpm: 15, s: 10 },
      );
      // An EMPTY pool maps to TOO_THIN by the engine's existing clôture semantics (buildPlan:
      // pool.length === 0 → isTooThin) — the refusal, not its label, is the US-2.1 requirement.
      expect(result.status).toBe('TOO_THIN');
    });

    it('C_max shrinks with the declaration — the pinned delta (540 → 270)', async () => {
      const cat = await ownerSectorId();
      // A REAL-FUTURE window (cmax uses the campaign dates as-is; the venue seeds all 7 dows).
      const lead = (await getDispatchConfig()).campaignLeadWorkingDays;
      const start = premiereDateDisponible(new Date(), lead);
      const end = plusCalendarDays(start, 1);
      const venue = await seedVenue(cat, { dows: [1, 2, 3, 4, 5, 6, 7] });
      const f = await seedCampaign({ start, end, cat, status: 'draft' });

      const before = await computeCampaignCmax(
        { id: f.campaignId, startDate: start, endDate: end, campaignType: 'standard' },
        10,
      );
      expect(before.cMaxTnd).toBe(540); // 2 days × 18 000 fact at CPM 15

      await declare(venue.shId, end); // 1 of the 2 days
      const after = await computeCampaignCmax(
        { id: f.campaignId, startDate: start, endDate: end, campaignType: 'standard' },
        10,
      );
      expect(after.cMaxTnd).toBe(270); // exactly half — the VF proportionality
      expect(after.eligibleCount).toBe(1); // still in the pool (partial, not excluded)
    });

    it('the boost preview respects declared days (the ceiling prices only available days)', async () => {
      const cat = await ownerSectorId();
      const venue = await seedVenue(cat, { dows: [1, 2, 3] });
      const f = await seedCampaign({ start: MON, end: TUE, cat, status: 'active' });
      await db.insert(campaignDispatchPlan).values({
        campaignId: f.campaignId,
        iCible: 10_000,
        cpm: '15',
        sSpotSeconds: 10,
        tTierCoef: '0.6',
        seuilDiffusable: 1334,
        sMin: '20',
        gJour: '3.3333',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 10_000,
        nMin: 1,
        nMax: 10,
        nRetenus: 1,
      });

      // Extending MON..TUE to WED: undeclared, WED adds a full day to the ceiling…
      const open = await runBoost(
        f.campaignId,
        f.advertiserId,
        { newEndDate: WED },
        { previewOnly: true, now: NOW },
      );
      expect(open.status).toBe('PREVIEW');
      // …declared, the added day contributes NOTHING (the merged pool prices without it).
      await declare(venue.shId, WED);
      const closed = await runBoost(
        f.campaignId,
        f.advertiserId,
        { newEndDate: WED },
        { previewOnly: true, now: NOW },
      );
      expect(closed.status).toBe('PREVIEW');
      if (open.status !== 'PREVIEW' || closed.status !== 'PREVIEW') return;
      expect(closed.cMaxBoostTnd).toBeLessThan(open.cMaxBoostTnd);
    });

    it('RULING 2 CHAIN: declare-after-freeze rewrites NOTHING, manquements still count, and the rattrapage skips the replacement venue’s OWN declared days', async () => {
      const cat = await ownerSectorId();
      // A (dead, sps 90) carries the frozen plan on MON+TUE; B (alive, sps 80) is the target —
      // and B has ITSELF declared TUE, so the rattrapage may only place its delta on MON.
      const A = await seedVenue(cat, { sps: 90, liveness: 'dead' });
      const B = await seedVenue(cat, { sps: 80, liveness: 'alive' });
      const advertiserId = await seedUser({ role: 'advertiser' });
      const [c] = await db
        .insert(campaigns)
        .values({
          advertiserId,
          name: 'E2 Chain',
          campaignType: 'standard',
          status: 'active',
          startDate: MON,
          endDate: TUE,
        })
        .returning();
      const campaignId = c?.id ?? '';
      await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });
      const [plan] = await db
        .insert(campaignDispatchPlan)
        .values({
          campaignId,
          iCible: 20_000,
          cpm: '10',
          sSpotSeconds: 10,
          tTierCoef: '0.6',
          seuilDiffusable: 2000,
          sMin: '20',
          gJour: '3.3333',
          fMaxSeconds: 300,
          rMinEfficace: 2,
          couvert: 20_000,
          nMin: 1,
          nMax: 10,
          nRetenus: 1,
        })
        .returning();
      const frozen = creneauxFor([MON, TUE], 1600, 16);
      const [alloc] = await db
        .insert(campaignDispatchAllocation)
        .values({
          planId: plan?.id ?? '',
          screenhostId: A.shId,
          iiPotentiel: 20_000,
          rI: 16,
          revenuPrevisionnel: '200',
          creneaux: frozen,
          statutAcceptation: 'ACCEPTE',
        })
        .returning();

      // The owner declares TUE on A AFTER the freeze — and B has its own TUE declaration.
      await declare(A.shId, TUE);
      await declare(B.shId, TUE);

      // Ruling 2: the frozen créneaux are byte-identical after the declaration.
      const [after] = await db
        .select({ creneaux: campaignDispatchAllocation.creneaux })
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.id, alloc?.id ?? ''));
      expect(after?.creneaux).toEqual(frozen);

      // A delivered nothing: at Tunis 13:30 the elapsed MON hours 8..12 are ALL manquements —
      // the declaration did not erase them (5 × 1 600 phys × 0.6 = 4 800 fact).
      const outcome = await runRedispatchRound(
        { id: campaignId, name: 'E2 Chain', startDate: MON, endDate: TUE },
        NOW,
      );
      expect(outcome.status).toBe('PLACED');
      if (outcome.status !== 'PLACED') return;
      expect(outcome.vFact).toBe(4800);
      expect(outcome.placedTo).toEqual([
        { screenhost_id: B.shId, added_fact: expect.any(Number) as number, merged: false },
      ]);

      // The replacement's créneaux skip B's OWN declared TUE: future-only MON slots only.
      const allocs = await db
        .select()
        .from(campaignDispatchAllocation)
        .where(eq(campaignDispatchAllocation.planId, plan?.id ?? ''));
      const placed = allocs.find((a) => a.screenhostId === B.shId);
      expect(placed?.statutAcceptation).toBe('EN_ATTENTE');
      expect(placed?.creneaux.length).toBeGreaterThan(0);
      for (const cr of placed?.creneaux ?? []) {
        expect(cr.date).toBe(MON); // never TUE — B's own declaration holds for NEW placements
        expect(cr.hour).toBeGreaterThan(13); // and future-only (Tunis 13:30)
      }
    });
  });
});
