import { describe, expect, it } from 'vitest';

import {
  type AllocationInput,
  deliveryRatio,
  reconcileCampaign,
  valueAllocation,
} from '../src/lib/reconcile/valuation.js';

const CPM = 10; // → 0.01 TND / impression
const S_MIN = 10; // TND (seuil_diffusable 1000 × cpm/1000), from the plan snapshot

describe('deliveryRatio', () => {
  it('is delivered/expected, capped at 1, 0 when nothing was planned', () => {
    expect(deliveryRatio(100, 200)).toBe(0.5);
    expect(deliveryRatio(200, 200)).toBe(1);
    expect(deliveryRatio(500, 200)).toBe(1); // over-delivery never exceeds 1
    expect(deliveryRatio(0, 200)).toBe(0);
    expect(deliveryRatio(5, 0)).toBe(0); // divide-by-zero guard
  });
});

describe('valueAllocation — per-screenhost delivered + earnings', () => {
  const base: AllocationInput = {
    screenhostId: 'sh',
    iiPotentiel: 20000,
    expectedPlays: 200,
    deliveredPlays: 200,
  };
  it('full delivery → full potential delivered + full earnings', () => {
    expect(valueAllocation(base, CPM)).toMatchObject({
      deliveredImp: 20000,
      manquementImp: 0,
      earningsTnd: 200,
    });
  });
  it('partial delivery → ratio applied (floored) + proportional earnings', () => {
    expect(valueAllocation({ ...base, deliveredPlays: 100 }, CPM)).toMatchObject({
      deliveredImp: 10000,
      manquementImp: 10000,
      earningsTnd: 100,
    });
  });
  it('a defaulting screenhost earns NOTHING on its undiffused part', () => {
    expect(valueAllocation({ ...base, deliveredPlays: 0 }, CPM)).toMatchObject({
      deliveredImp: 0,
      manquementImp: 20000,
      earningsTnd: 0,
    });
  });
});

describe('reconcileCampaign — B.4 P_perte / refund / spend / status', () => {
  const alloc = (deliveredPlays: number, iiPotentiel = 20000): AllocationInput => ({
    screenhostId: 's',
    iiPotentiel,
    expectedPlays: 200,
    deliveredPlays,
  });

  it('fully delivered → réussie, P_perte 0, no refund, spend = budget', () => {
    const v = reconcileCampaign([alloc(200)], CPM, S_MIN);
    expect(v).toMatchObject({
      expectedImp: 20000,
      deliveredImp: 20000,
      manquementImp: 0,
      pPerteTnd: 0,
      refundTnd: 0,
      spendTnd: 200, // budget 200 − refund 0 = delivered spend
      status: 'reussie',
    });
  });

  it('partial with P_perte ≥ S_min → partial, refund = residual, spend = delivered value', () => {
    const v = reconcileCampaign([alloc(100)], CPM, S_MIN);
    expect(v).toMatchObject({
      deliveredImp: 10000,
      manquementImp: 10000,
      pPerteTnd: 100, // 10000 × 10/1000
      refundTnd: 100, // ≥ S_min → refunded
      spendTnd: 100, // budget 200 − refund 100 = delivered 10000 × 10/1000
      status: 'partial',
    });
  });

  it('shortfall below S_min → RÉUSSIE, refund 0, advertiser pays full budget (micro-gap absorbed)', () => {
    const v = reconcileCampaign([alloc(199)], CPM, S_MIN);
    expect(v).toMatchObject({
      deliveredImp: 19900,
      manquementImp: 100,
      pPerteTnd: 1, // 100 × 10/1000 = 1 < S_min 10
      refundTnd: 0,
      spendTnd: 200, // budget, NOT refunded
      status: 'reussie',
    });
  });

  it('multi-SH with one defaulting: aggregates, defaulting SH earns 0', () => {
    const v = reconcileCampaign([alloc(200, 20000), alloc(0, 10000)], CPM, S_MIN);
    expect(v).toMatchObject({
      expectedImp: 30000,
      deliveredImp: 20000,
      manquementImp: 10000,
      pPerteTnd: 100,
      refundTnd: 100,
      spendTnd: 200, // 300 budget − 100 refund = 200 delivered value
      status: 'partial',
    });
    expect(v.perScreenhost[1]).toMatchObject({ deliveredImp: 0, earningsTnd: 0 });
    expect(v.perScreenhost[0]).toMatchObject({ deliveredImp: 20000, earningsTnd: 200 });
    // The advertiser's net spend equals the sum of screenhost earnings (delivered value).
    expect(v.spendTnd).toBe(v.perScreenhost.reduce((s, p) => s + p.earningsTnd, 0));
  });
});
