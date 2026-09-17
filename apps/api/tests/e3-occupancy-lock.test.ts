import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  campaignTargeting,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { runDispatch } from '../src/lib/dispatch/dispatch-service.js';
import { OCCUPANCY_LOCK_NAMESPACE } from '../src/lib/dispatch/pool.js';

import { campaignTiersOf } from './helpers/cpm-config.js';
import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';

// E3 / US-4.4 — pessimistic occupancy locking, real Postgres. The engaged-seconds read now runs
// INSIDE the freeze transaction under per-screenhost pg_advisory_xact_lock (sorted ids), so two
// dispatches racing over a shared screen serialize: the second blocks until the first commits,
// then reads the committed engagement — the 300s/hour broadcast budget can never be jointly
// oversold (the pre-E3 code read engagement OUTSIDE the tx: both readers saw zero engagement).

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `lock${seq}@example.com`,
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

// An eligible venue: horaires 8–18, capacity present, affluence 100 on Mon+Tue (fixture identical
// to campaign-dispatch.test.ts so capacities match its pinned arithmetic).
const seedEligibleScreenhost = async (ownerId: string, categoryId: string): Promise<string> => {
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: 'Shared Venue',
      ownerId,
      businessSectorId: categoryId,
      class: 'premium' as never,
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
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

const totalSecondsOn = async (screenhostId: string): Promise<number> => {
  const allocs = await db
    .select({
      rI: campaignDispatchAllocation.rI,
      s: campaignDispatchPlan.sSpotSeconds,
    })
    .from(campaignDispatchAllocation)
    .innerJoin(campaignDispatchPlan, eq(campaignDispatchAllocation.planId, campaignDispatchPlan.id))
    .where(eq(campaignDispatchAllocation.screenhostId, screenhostId));
  return allocs.reduce((sum, a) => sum + a.rI * a.s, 0);
};

const settle = <T>(p: Promise<T>): Promise<'pending' | 'settled'> =>
  Promise.race([
    p.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 300)),
  ]);

describe('E3 occupancy locking (US-4.4, real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('a dispatch BLOCKS on a held screenhost lock and completes after release (forced interleaving)', async () => {
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shId = await seedEligibleScreenhost(owner, cat);
    const campaignId = await seedCampaign(advertiser, 'Blocked');
    await db.insert(campaignTargeting).values({ campaignId, categoryId: cat, class: null });
    const tiers = await campaignTiersOf(campaignId);

    // Hold THIS screenhost's occupancy lock from a side transaction.
    let acquired!: () => void;
    const acquiredP = new Promise<void>((resolve) => (acquired = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const holder = sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${shId}))`;
      acquired();
      await released;
    });
    await acquiredP;

    // The dispatch must NOT complete while the lock is held (it blocks before the engagement read)…
    const dispatchP = runDispatch(
      { id: campaignId, name: 'Blocked', startDate: '2024-01-01', endDate: '2024-01-02' },
      { iCible: 20000, cpm: 10, s: 10, tiers },
    );
    expect(await settle(dispatchP)).toBe('pending');

    // …and completes normally once the holder commits.
    release();
    await holder;
    const result = await dispatchP;
    expect(result.status).toBe('OK');
    expect(await totalSecondsOn(shId)).toBeLessThanOrEqual(300);
  });

  it('two dispatches RACING over a shared screen cannot jointly exceed the 300s/hour budget', async () => {
    const advA = await seedUser({ role: 'advertiser' });
    const advB = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shId = await seedEligibleScreenhost(owner, cat);
    const a = await seedCampaign(advA, 'Race A');
    await db.insert(campaignTargeting).values({ campaignId: a, categoryId: cat, class: null });
    const b = await seedCampaign(advB, 'Race B');
    await db.insert(campaignTargeting).values({ campaignId: b, categoryId: cat, class: null });

    // A (s=30) wants the whole hour (i_cible ≥ capacity → r_i 10 → 300s); B (s=10) wants 160s.
    // Pre-E3, both read zero engagement outside any tx → 300s + 160s = 460s on one screen. With
    // the advisory lock the loser blocks until the winner commits, then nets the winner's seconds.
    // The tiers are read BEFORE the race so both dispatches start together.
    const [tiersA, tiersB] = [await campaignTiersOf(a), await campaignTiersOf(b)];
    const [resA, resB] = await Promise.all([
      runDispatch(
        { id: a, name: 'Race A', startDate: '2024-01-01', endDate: '2024-01-02' },
        { iCible: 20000, cpm: 10, s: 30, tiers: tiersA },
      ),
      runDispatch(
        { id: b, name: 'Race B', startDate: '2024-01-01', endDate: '2024-01-02' },
        { iCible: 20000, cpm: 10, s: 10, tiers: tiersB },
      ),
    ]);

    // Whichever order the lock imposed, the INVARIANT holds: Σ(r_i × S) ≤ 300 on the shared screen…
    expect(await totalSecondsOn(shId)).toBeLessThanOrEqual(300);
    // …and the loser either fit into the residual (OK) or hit a clôture: NO_ELIGIBLE (some pool,
    // no allocation) or TOO_THIN (a fully-consumed screen drops out → EMPTY pool → clôture 2).
    // Never a double-booked hour.
    expect(['OK', 'NO_ELIGIBLE', 'TOO_THIN']).toContain(resA.status);
    expect(['OK', 'NO_ELIGIBLE', 'TOO_THIN']).toContain(resB.status);
    expect([resA.status, resB.status]).toContain('OK');
  });

  it('the advisory lock releases on ROLLBACK (a failed dispatch never wedges the screen)', async () => {
    const owner = await seedUser({ role: 'individual_owner' });
    const cat = await ownerSectorId();
    const shId = await seedEligibleScreenhost(owner, cat);

    // A transaction takes the lock then rolls back…
    await sql
      .begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${shId}))`;
        throw new Error('forced rollback');
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== 'forced rollback') throw err;
      });

    // …and the lock is immediately acquirable again (try-lock, no blocking).
    const rows = await sql.begin(
      (tx) =>
        tx`select pg_try_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${shId})) as ok`,
    );
    expect((rows as unknown as { ok: boolean }[])[0]?.ok).toBe(true);
  });
});
