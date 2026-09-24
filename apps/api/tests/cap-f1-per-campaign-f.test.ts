import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  screenhostAffluence,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { assemblePool } from '../src/lib/dispatch/pool.js';

import { resetAuthTables, bothHalves } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// CAP-F1 (operator ruling 2026-09-24) — F = 300 s/hour is a PER-CAMPAIGN cap (pricing-model-v3's
// own definition: « caps spot repetition rate per hour »), not a screen budget every campaign
// shares. The screen's only shared limit is the physical hour, 3600 s: twelve campaigns at their
// full F may fill it. residual(campaign, screen) = min(F, 3600 − Σ other campaigns' r_i × S).
// Before (since #103) the 300 s was shared: one campaign at 280 s left every other campaign one
// rep/hour — the prod « — » of 24/09. Fixtures = CF-HF4's (venue 8–18, affluence 100, S = 10 s).

vi.mock('../src/lib/wedooh-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/wedooh-sync.js')>();
  return { ...actual, pushApprovedOwnerLocations: vi.fn(() => Promise.resolve()) };
});

// The pricing window every test reads (a Mon–Tue).
const JULY = { start: '2026-07-06', end: '2026-07-07' }; // Mon–Tue

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `capf1-${seq}@example.com`,
      contactName: `CAP-F1 User ${seq}`,
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
      name: `CAP-F1 Venue ${seq}`,
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
  await seedInstalledScreen(shId);
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
        storageKey: `creatives/capf1/${seq}-${Math.random().toString(16).slice(2)}`,
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
      name: opts.name ?? `CAP-F1 campagne ${seq}`,
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

describe('CAP-F1 — F is per campaign; the screen holds 3600 s/hour', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  const repsCapOf = async (shId: string): Promise<number | undefined> =>
    (
      await assemblePool(db, { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end }, POOL_INPUTS)
    ).pool.find((p) => p.id === shId)?.repsCap;

  it('another campaign at its FULL F leaves a new campaign its full F (was: 0)', async () => {
    const { shId } = await seedVenue();
    const other = await seedCampaign({ ...JULY, status: 'active' });
    await seedEngagement(other.campaignId, shId, { rI: 30, s: 10 }); // 300 s — its own whole F
    expect(await repsCapOf(shId)).toBe(30); // min(3600/10, 300/10) — untouched by the other
  });

  it('THE PROD SHAPE: 280 s engaged (14 × 20 s) no longer squeezes a 20 s spot to 1 rep', async () => {
    const { shId } = await seedVenue();
    const other = await seedCampaign({ ...JULY, status: 'active' });
    await seedEngagement(other.campaignId, shId, { rI: 14, s: 20 });
    const pool = await assemblePool(
      db,
      { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end },
      { ...POOL_INPUTS, s: 20 },
    );
    expect(pool.pool.find((p) => p.id === shId)?.repsCap).toBe(15); // 300 ÷ 20, not ⌊20 ÷ 20⌋ = 1
  });

  it('eleven full campaigns leave the twelfth its full F; the thirteenth finds the hour full', async () => {
    const { shId } = await seedVenue();
    for (let i = 0; i < 11; i += 1) {
      const c = await seedCampaign({ ...JULY, status: 'active' });
      await seedEngagement(c.campaignId, shId, { rI: 30, s: 10 }); // 11 × 300 = 3300 s
    }
    expect(await repsCapOf(shId)).toBe(30); // 300 s free → the twelfth takes all of its F

    const twelfth = await seedCampaign({ ...JULY, status: 'active' });
    await seedEngagement(twelfth.campaignId, shId, { rI: 30, s: 10 }); // 3600 s: the hour is full
    const full = await assemblePool(
      db,
      { id: FAKE_ID, startDate: JULY.start, endDate: JULY.end },
      POOL_INPUTS,
    );
    expect(full.pool.find((p) => p.id === shId)).toBeUndefined();
    expect(full.candidateCount).toBeGreaterThan(0); // saturated, not untargeted
  });

  it('a partly full hour caps at what is left of the screen, below F', async () => {
    const { shId } = await seedVenue();
    const big = await seedCampaign({ ...JULY, status: 'active' });
    await seedEngagement(big.campaignId, shId, { rI: 350, s: 10 }); // 3500 s held
    expect(await repsCapOf(shId)).toBe(10); // min(300, 3600 − 3500) = 100 s → 10 reps of 10 s
  });

  it("a campaign's OWN seconds use up its own F first (cascade / boost time)", async () => {
    const { shId } = await seedVenue();
    const self = await seedCampaign({ ...JULY, status: 'active' });
    await seedEngagement(self.campaignId, shId, { rI: 30, s: 10 }); // this campaign: its full F
    const own = await assemblePool(
      db,
      { id: self.campaignId, startDate: JULY.start, endDate: JULY.end },
      POOL_INPUTS,
    );
    // The screen has 3300 s free, but THIS campaign has used its 300: nothing more for it here.
    expect(own.pool.find((p) => p.id === shId)).toBeUndefined();
    // Another campaign still gets its full F on the same screen.
    expect(await repsCapOf(shId)).toBe(30);
  });
});
