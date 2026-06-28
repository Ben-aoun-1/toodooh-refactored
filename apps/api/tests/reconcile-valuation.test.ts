import { describe, expect, it } from 'vitest';

import {
  type AllocationInput,
  type ReconCreneau,
  reconcileCampaign,
  slotKey,
  valueAllocation,
} from '../src/lib/reconcile/valuation.js';

const CPM = 10; // → 0.01 TND / impression
const S_MIN = 10; // TND, from the plan snapshot

// N créneaux on one date, consecutive hours from 8, each `imp` impressions.
const creneaux = (date: string, count: number, imp: number): ReconCreneau[] =>
  Array.from({ length: count }, (_, i) => ({ date, hour: 8 + i, impressions: imp }));
const delivered = (date: string, hours: number[]): Set<string> =>
  new Set(hours.map((h) => slotKey(date, h)));

describe('valueAllocation — binary per créneau (FIX A: spam-resistant)', () => {
  const cren = creneaux('2024-01-01', 10, 1000); // 10 slots × 1000 = 10000

  it('delivered = Σ impressions of DELIVERED slots only', () => {
    // proofs landed in 2 of the 10 scheduled créneau-hours → exactly those 2 hours' impressions.
    const v = valueAllocation(
      { screenhostId: 's', creneaux: cren, deliveredSlots: delivered('2024-01-01', [8, 9]) },
      CPM,
    );
    expect(v).toMatchObject({
      expectedImp: 10000,
      deliveredImp: 2000,
      manquementImp: 8000,
      earningsTnd: 20,
    });
  });

  it('a slot delivered counts ONCE regardless of how many proofs hit it (Set semantics)', () => {
    // deliveredSlots is already deduped by hour upstream — one key ⇒ one slot's impressions.
    const v = valueAllocation(
      { screenhostId: 's', creneaux: cren, deliveredSlots: delivered('2024-01-01', [8]) },
      CPM,
    );
    expect(v.deliveredImp).toBe(1000); // not inflated by repeat proofs in hour 8
  });

  it('full delivery → full potential + full earnings; nothing delivered → 0', () => {
    const all = delivered('2024-01-01', [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(
      valueAllocation({ screenhostId: 's', creneaux: cren, deliveredSlots: all }, CPM),
    ).toMatchObject({ deliveredImp: 10000, manquementImp: 0, earningsTnd: 100 });
    expect(
      valueAllocation({ screenhostId: 's', creneaux: cren, deliveredSlots: new Set() }, CPM),
    ).toMatchObject({ deliveredImp: 0, earningsTnd: 0 });
  });
});

describe('reconcileCampaign — B.4 + money conservation (FIX B)', () => {
  const alloc = (id: string, cren: ReconCreneau[], deliveredHours: number[]): AllocationInput => ({
    screenhostId: id,
    creneaux: cren,
    deliveredSlots: delivered('2024-01-01', deliveredHours),
  });

  it('fully delivered → réussie, P_perte 0, no refund, spend = budget', () => {
    const cren = creneaux('2024-01-01', 10, 1000);
    const v = reconcileCampaign(
      [alloc('s', cren, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17])],
      CPM,
      S_MIN,
    );
    expect(v).toMatchObject({
      expectedImp: 10000,
      deliveredImp: 10000,
      manquementImp: 0,
      pPerteTnd: 0,
      refundTnd: 0,
      spendTnd: 100,
      status: 'reussie',
    });
  });

  it('partial (P_perte ≥ S_min) → spend == Σ earnings EXACTLY (conserves)', () => {
    const cren = creneaux('2024-01-01', 10, 1000);
    const v = reconcileCampaign([alloc('s', cren, [8, 9, 10, 11, 12])], CPM, S_MIN); // 5/10 delivered
    expect(v).toMatchObject({
      deliveredImp: 5000,
      manquementImp: 5000,
      refundTnd: 50,
      spendTnd: 50,
      status: 'partial',
    });
    expect(v.spendTnd).toBe(v.perScreenhost.reduce((s, p) => s + p.earningsTnd, 0));
  });

  it('shortfall below S_min → réussie, refund 0, spend = budget (platform keeps the micro-gap)', () => {
    const cren: ReconCreneau[] = [
      { date: '2024-01-01', hour: 8, impressions: 9900 },
      { date: '2024-01-01', hour: 9, impressions: 100 },
    ];
    const v = reconcileCampaign([alloc('s', cren, [8])], CPM, S_MIN); // miss the 100-imp slot
    expect(v).toMatchObject({
      deliveredImp: 9900,
      manquementImp: 100,
      pPerteTnd: 1, // 100 × 10/1000 < S_min 10
      refundTnd: 0,
      spendTnd: 100, // budget, NOT refunded
      status: 'reussie',
    });
  });

  it('CONSERVATION with a non-round CPM + multi-SH partial: spend == Σ earnings to the cent', () => {
    const cpm = 12.345;
    const sh1 = alloc('a', creneaux('2024-01-01', 10, 1000), [8, 9, 10, 11, 12, 13]); // 6000 delivered
    const sh2 = alloc('b', creneaux('2024-01-01', 7, 1000), [8, 9, 10]); // 3000 delivered
    const v = reconcileCampaign([sh1, sh2], cpm, S_MIN);
    expect(v).toMatchObject({
      expectedImp: 17000,
      deliveredImp: 9000,
      manquementImp: 8000,
      status: 'partial',
    });
    // Conservation is to the cent (round4); the service rounds the sum, so compare at 4dp.
    const sumEarnings =
      Math.round(v.perScreenhost.reduce((s, p) => s + p.earningsTnd, 0) * 1e4) / 1e4;
    expect(v.spendTnd).toBe(sumEarnings); // exact conservation despite the non-round CPM rounding
    expect(v.perScreenhost[0]?.earningsTnd).toBe(74.07); // 6000 × 12.345/1000
    expect(v.perScreenhost[1]?.earningsTnd).toBe(37.035); // 3000 × 12.345/1000
  });
});
