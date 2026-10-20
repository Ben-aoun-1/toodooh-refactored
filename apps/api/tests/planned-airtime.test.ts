import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  creatives,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { classicAirtimeSeconds, plannedAirtimeByCampaign } from '../src/lib/planned-airtime.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// DUR-1 (Myriam 2026-10-20) — « Durée totale de diffusion » is the airtime the plan buys:
// Σ reps × the spot's length over the non-REFUSE allocations (it was impressions × 30 s).

const C = (reps: number, impressions = 999): DispatchCreneau => ({
  date: '2026-11-02',
  hour: 10,
  reps,
  impressions,
});

describe('DUR-1 — planned airtime', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('pure: Σ reps × spot length, never the impressions', () => {
    expect(classicAirtimeSeconds([C(10), C(4)], 15)).toBe(210);
    expect(classicAirtimeSeconds([], 15)).toBe(0);
  });

  it('a plan: accepted and pending venues count, a refused one does not', async () => {
    const [adv] = await db
      .insert(users)
      .values({
        email: 'dur1@example.com',
        contactName: 'A',
        role: 'advertiser',
        status: 'approved',
      })
      .returning();
    const [owner] = await db
      .insert(users)
      .values({
        email: 'dur1o@example.com',
        contactName: 'O',
        role: 'individual_owner',
        status: 'approved',
      })
      .returning();
    const [v1] = await db
      .insert(screenhosts)
      .values({ name: 'V1', ownerId: owner?.id ?? '' })
      .returning();
    const [v2] = await db
      .insert(screenhosts)
      .values({ name: 'V2', ownerId: owner?.id ?? '' })
      .returning();
    const [v3] = await db
      .insert(screenhosts)
      .values({ name: 'V3', ownerId: owner?.id ?? '' })
      .returning();
    const [spot] = await db
      .insert(creatives)
      .values({
        advertiserId: adv?.id ?? '',
        storageKey: 'k',
        durationSeconds: 20,
        validationStatus: 'approved',
      })
      .returning();
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId: adv?.id ?? '',
        name: 'X',
        campaignType: 'standard',
        status: 'active',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        creativeId: spot?.id ?? null,
      })
      .returning();
    const [notPlanned] = await db
      .insert(campaigns)
      .values({ advertiserId: adv?.id ?? '', name: 'Y', campaignType: 'standard', status: 'draft' })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId: c?.id ?? '',
        iCible: 1,
        cpm: '10',
        sSpotSeconds: 20,
        tTierCoef: '1',
        seuilDiffusable: 1,
        sMin: '1',
        gJour: '1',
        fMaxSeconds: 300,
        rMinEfficace: 1,
        couvert: 1,
        nMin: 1,
        nMax: 3,
        nRetenus: 3,
      })
      .returning();
    const alloc = (
      screenhostId: string,
      statut: 'ACCEPTE' | 'EN_ATTENTE' | 'REFUSE',
      creneaux: DispatchCreneau[],
    ) => ({
      planId: plan?.id ?? '',
      screenhostId,
      iiPotentiel: 1,
      rI: 1,
      revenuPrevisionnel: '1',
      statutAcceptation: statut,
      creneaux,
    });
    await db
      .insert(campaignDispatchAllocation)
      .values([
        alloc(v1?.id ?? '', 'ACCEPTE', [C(10), C(5)]),
        alloc(v2?.id ?? '', 'EN_ATTENTE', [C(3)]),
        alloc(v3?.id ?? '', 'REFUSE', [C(100)]),
      ]);
    const map = await plannedAirtimeByCampaign([c?.id ?? '', notPlanned?.id ?? '']);
    expect(map.get(c?.id ?? '')).toBe((10 + 5 + 3) * 20);
    expect(map.has(notPlanned?.id ?? '')).toBe(false);
  });
});
