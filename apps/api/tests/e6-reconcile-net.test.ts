import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type DispatchCreneau,
  type NewUser,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaignRedispatchRounds,
  campaigns,
  creatives,
  proofOfPlay,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import { reconcileCampaignById } from '../src/lib/reconcile/reconcile-service.js';
import {
  type AllocationInput,
  reconcileCampaign,
  slotKey,
} from '../src/lib/reconcile/valuation.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// E6 commit 2 — the NET reconciliation (money-critical). Value space is FACTURABLE (physical ×
// the plan's frozen T); the loss is NET of redispatch placements, so a replaced-and-delivered
// slot can never be refunded twice; the stored reliquat is part of the promise AND of the gap by
// construction. CONSERVATION IDENTITY, pinned on every case below:
//   refund > 0  ⇒  spend == Σ payouts                      (a refunding settlement debits exactly
//                                                           what the screenhosts earned)
//   refund == 0 ⇒  spend == Σ payouts + net gap value      (the sub-S_min remainder stays with
//                                                           the platform)
// Fixtures: cpm 10, T 0.6, S_min 20 TND.

const CPM = 10;
const T = 0.6;
const S_MIN = 20;

// N slots of `imp` physical impressions each; `deliveredCount` of them delivered.
const alloc = (
  shId: string,
  slots: number,
  imp: number,
  deliveredCount: number,
): AllocationInput => {
  const creneaux = Array.from({ length: slots }, (_, i) => ({
    date: '2026-07-13',
    hour: 8 + i,
    impressions: imp,
  }));
  const delivered = new Set<string>();
  for (let i = 0; i < deliveredCount; i += 1) delivered.add(slotKey('2026-07-13', 8 + i));
  return { screenhostId: shId, creneaux, deliveredSlots: delivered };
};

const sumEarnings = (v: ReturnType<typeof reconcileCampaign>): number =>
  Math.round(v.perScreenhost.reduce((s, p) => s + p.earningsTnd, 0) * 1e4) / 1e4;

const assertConservation = (v: ReturnType<typeof reconcileCampaign>): void => {
  if (v.refundTnd > 0) {
    expect(v.spendTnd).toBe(sumEarnings(v)); // spend == Σ payouts EXACTLY
  } else {
    expect(v.spendTnd).toBe(Math.round((sumEarnings(v) + v.pPerteTnd) * 1e4) / 1e4);
  }
};

describe('reconcileCampaign — NET valuation (pure)', () => {
  it('(a) NO redispatch: the classic partial — refund the gap, spend = Σ payouts', () => {
    // A: 10 slots × 3 000 phys, 6 delivered+4 missed → gross gap 12 000 phys = 7 200 fact = 72 TND.
    const v = reconcileCampaign([alloc('A', 10, 3000, 6)], CPM, S_MIN, { t: T });
    expect(v.pPerteTnd).toBe(72);
    expect(v.status).toBe('partial');
    // budget 30 000×0.6×0.01 = 180; Σ earn 18 000×0.6×0.01 = 108 → refund 72, spend 108.
    expect(v.refundTnd).toBe(72);
    expect(v.spendTnd).toBe(108);
    assertConservation(v);
  });

  it('(b) REPLACED AND DELIVERED: net loss 0 — the OLD gross math would refund here (pinned)', () => {
    // A missed 5 000 phys (3 000 fact); the round re-placed 3 000 fact onto C, which DELIVERED.
    const inputs = [alloc('A', 2, 5000, 1), alloc('C', 1, 5000, 1)];
    const v = reconcileCampaign(inputs, CPM, S_MIN, { t: T, replacedMissedFact: 3000 });
    expect(v.pPerteTnd).toBe(0); // gross 3 000 fact − replaced 3 000 = 0
    expect(v.refundTnd).toBe(0);
    expect(v.status).toBe('reussie');
    // budget (15 000×0.6 − 3 000)×0.01 = 60 = Σ earn (10 000×0.6×0.01) — the advertiser pays the
    // ORIGINAL promise once, the replacement slot is not double-billed either.
    expect(v.spendTnd).toBe(60);
    expect(sumEarnings(v)).toBe(60);
    assertConservation(v);

    // THE DIFFERENCE, pinned: the pre-E6 GROSS math (no net context) still sees A's missed slot
    // (50 TND at T=1) and REFUNDS a loss the replacement already made good.
    const oldGross = reconcileCampaign(inputs, CPM, S_MIN);
    expect(oldGross.refundTnd).toBeGreaterThan(0);
  });

  it('(c) REPLACED BUT THE REPLACEMENT ALSO FAILED: the loss survives ONCE, not twice', () => {
    // A missed 5 000 phys (3 000 fact, replaced); C (the replacement, 3 000 fact promise) aired 0.
    const v = reconcileCampaign([alloc('A', 2, 5000, 1), alloc('C', 1, 5000, 0)], CPM, S_MIN, {
      t: T,
      replacedMissedFact: 3000,
    });
    // gross gap = (5 000 + 5 000)×0.6 = 6 000 fact; net = 6 000 − 3 000 = 3 000 fact = 30 TND.
    expect(v.pPerteTnd).toBe(30);
    expect(v.refundTnd).toBe(30); // budget 60 − Σ earn 30
    expect(v.spendTnd).toBe(30); // = Σ payouts (A's delivered slot alone)
    assertConservation(v);
  });

  it('(d) SUB-S_MIN residue: no refund, the platform keeps the micro-gap (identity holds)', () => {
    // A: 10 slots × 1 000 phys, 9 delivered → gap 1 000 phys = 600 fact = 6 TND < 20.
    const v = reconcileCampaign([alloc('A', 10, 1000, 9)], CPM, S_MIN, { t: T });
    expect(v.pPerteTnd).toBe(6);
    expect(v.refundTnd).toBe(0);
    expect(v.status).toBe('reussie');
    expect(v.spendTnd).toBe(60); // Σ earn 54 + the kept 6
    assertConservation(v);
  });

  it('the STORED reliquat is part of the net gap by construction (never delivered, never replaced)', () => {
    // Everything allocated was delivered; a 1 500-fact crumb stayed stored → gap = 15 TND < 20:
    // the advertiser pays it (RÉUSSIE keeps sub-S_min gaps) — spend − Σ earn == the reliquat value.
    const under = reconcileCampaign([alloc('A', 5, 5000, 5)], CPM, S_MIN, {
      t: T,
      reliquatStockeFact: 1500,
    });
    expect(under.pPerteTnd).toBe(15);
    expect(under.refundTnd).toBe(0);
    expect(under.spendTnd - sumEarnings(under)).toBe(15);
    assertConservation(under);

    // Grown past S_min (accumulated cascade shortfalls): the crumb value is REFUNDED.
    const over = reconcileCampaign([alloc('A', 5, 5000, 5)], CPM, S_MIN, {
      t: T,
      reliquatStockeFact: 2500,
    });
    expect(over.pPerteTnd).toBe(25);
    expect(over.refundTnd).toBe(25);
    expect(over.spendTnd).toBe(sumEarnings(over));
    assertConservation(over);
  });

  it('defaults reproduce the pre-E6 math exactly (t 1, no reliquat, nothing replaced)', () => {
    const inputs = [alloc('A', 10, 3000, 6)];
    const v = reconcileCampaign(inputs, CPM, S_MIN);
    expect(v.pPerteTnd).toBe(120); // 12 000 phys × 10/1000, T-less
    expect(v.spendTnd).toBe(180);
  });
});

// ── the service wiring: T + reliquat + rounds ledger flow from the DB ──────────────────────────
type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `e6n-${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const creneauxAt = (imp: number, hours: number[]): DispatchCreneau[] =>
  hours.map((h) => ({ date: '2026-07-13', hour: h, reps: 2, impressions: imp }));

describe('reconcileCampaignById — NET context wired from the plan + rounds ledger (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterAll(async () => {
    await sql.end();
  });

  it('reads T, the current reliquat and Σ missed-sourced placements; payouts keep their basis', async () => {
    const admin = await seedUser({ role: 'admin' });
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: admin, role: 'admin', status: 'approved' },
    } as unknown as GetSessionResult);
    const advertiser = await seedUser({ role: 'advertiser' });
    const owner = await seedUser({ role: 'individual_owner' });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        advertiserId: advertiser,
        name: 'E6 Net',
        campaignType: 'standard',
        status: 'completed',
        startDate: '2026-07-13',
        endDate: '2026-07-13',
      })
      .returning();
    const campaignId = campaign?.id ?? '';
    const [shA] = await db.insert(screenhosts).values({ name: 'A', ownerId: owner }).returning();
    const [shC] = await db.insert(screenhosts).values({ name: 'C', ownerId: owner }).returning();
    const [screenA] = await db
      .insert(screens)
      .values({ screenhostId: shA?.id ?? '', name: 'TV-A' })
      .returning();
    const [screenC] = await db
      .insert(screens)
      .values({ screenhostId: shC?.id ?? '', name: 'TV-C' })
      .returning();
    const [creative] = await db
      .insert(creatives)
      .values({
        advertiserId: advertiser,
        creativeType: 'video',
        storageKey: `creatives/e6n/${campaignId}`,
        durationSeconds: 10,
        validationStatus: 'approved',
      })
      .returning();
    const [plan] = await db
      .insert(campaignDispatchPlan)
      .values({
        campaignId,
        iCible: 9500,
        cpm: '10',
        sSpotSeconds: 10,
        tTierCoef: '0.6', // ← the frozen T the valuation must read
        seuilDiffusable: 2000,
        sMin: '20',
        gJour: '3.3333',
        fMaxSeconds: 300,
        rMinEfficace: 2,
        couvert: 9000,
        nMin: 1,
        nMax: 4,
        nRetenus: 2,
        reliquatStocke: 500, // ← never delivered, never replaced — must land in the gap
      })
      .returning();
    const planId = plan?.id ?? '';
    // A: 2 slots × 5 000 phys — aired hour 8, MISSED hour 9 (3 000 fact gross, replaced below).
    await db.insert(campaignDispatchAllocation).values({
      planId,
      screenhostId: shA?.id ?? '',
      iiPotentiel: 6000,
      rI: 2,
      revenuPrevisionnel: '60',
      creneaux: creneauxAt(5000, [8, 9]),
      statutAcceptation: 'ACCEPTE',
    });
    // C: the redispatch placement (1 slot × 5 000 phys = 3 000 fact) — DELIVERED.
    await db.insert(campaignDispatchAllocation).values({
      planId,
      screenhostId: shC?.id ?? '',
      iiPotentiel: 3000,
      rI: 2,
      revenuPrevisionnel: '30',
      creneaux: creneauxAt(5000, [12]),
      statutAcceptation: 'ACCEPTE',
    });
    await db.insert(campaignRedispatchRounds).values({
      campaignId,
      planId,
      reliquatConsumedFact: 0,
      missedFact: 3000,
      missedFrom: [{ screenhost_id: shA?.id ?? '', slots: 1, imp_physical: 5000 }],
      placedFact: 3000,
      placedTo: [{ screenhost_id: shC?.id ?? '', added_fact: 3000, merged: false }],
      residualFact: 0,
    });
    // Proofs: A hour 8 (Tunis) = 07:15 UTC; C hour 12 = 11:15 UTC.
    const proof = (screenId: string, shId: string, utcHour: string) =>
      db.insert(proofOfPlay).values({
        screenId,
        screenhostId: shId,
        campaignId,
        creativeId: creative?.id ?? '',
        videoIdAsSent: campaignId,
        eventType: 'VIDEO_ENDED' as const,
        receivedAt: new Date(`2026-07-13T${utcHour}:15:00Z`),
      });
    await proof(screenA?.id ?? '', shA?.id ?? '', '07');
    await proof(screenC?.id ?? '', shC?.id ?? '', '11');

    const result = await reconcileCampaignById(campaignId, admin);
    expect(result.status).toBe('OK');
    if (result.status !== 'OK') return;

    // NET: gross gap 5 000×0.6 = 3 000 fact − replaced 3 000 = 0, + reliquat 500 → 5 TND < 20 →
    // RÉUSSIE (the OLD gross math would have refunded A's missed hour despite C delivering it).
    expect(result.valuation.pPerteTnd).toBe(5);
    expect(result.valuation.refundTnd).toBe(0);
    // budget = (15 000×0.6 − 3 000 + 500)×0.01 = 65; Σ earn = 10 000×0.6×0.01 = 60 → spend 65.
    expect(result.valuation.spendTnd).toBe(65);
    // Payouts keep their BASIS: each SH is paid its own delivered créneaux only.
    const byShId = new Map(result.payouts.map((p) => [p.screenhostId, Number(p.earningsTnd)]));
    expect(byShId.get(shA?.id ?? '')).toBe(30); // A: 5 000 phys × 0.6 × 0.01
    expect(byShId.get(shC?.id ?? '')).toBe(30); // C: its replacement slot
    const [persisted] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(persisted).toBeDefined();
  });
});
