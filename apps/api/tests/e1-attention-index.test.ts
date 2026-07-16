import { describe, expect, it } from 'vitest';

import {
  capaciteUtile,
  computeR,
  facturableFromPhysical,
  physicalFromFacturable,
} from '../src/lib/dispatch/eligibility.js';
import { buildPlan, type PoolEntry, type WindowDay } from '../src/lib/dispatch/plan.js';
import { DISPATCH_CONFIG_DEFAULTS, tForDuration } from '../src/lib/dispatch/thresholds.js';
import { reconcileCampaign } from '../src/lib/reconcile/valuation.js';
import {
  G_MOIS_TND,
  PCT_SH,
  S_MIN_TND,
  SEUIL_DIFFUSABLE,
  VALEUR_MIN_SH_TND,
} from '../src/lib/vf-constants.js';

// E1 (VF) — the attention index T + the VF business constants. Pure math, no DB.

const T_CFG = { t10s: 0.6, t20s: 0.7, t30s: 0.8 };

describe('tForDuration — the duration→bucket rule (S ≤ 10 / ≤ 20 / else)', () => {
  it.each([
    [1, 0.6],
    [10, 0.6], // inclusive upper edge of the first bucket
    [11, 0.7],
    [20, 0.7], // inclusive upper edge of the second bucket
    [21, 0.8],
    [25, 0.8],
    [30, 0.8], // CF-SH1 caps S at 30 upstream — the last bucket is genuinely 21–30
  ])('S=%is → T=%d', (s, expected) => {
    expect(tForDuration(s, T_CFG)).toBe(expected);
  });

  it('photos price like equivalent videos — their diffusion slots hit the same buckets', () => {
    expect(tForDuration(10, T_CFG)).toBe(0.6); // photo slot 10
    expect(tForDuration(20, T_CFG)).toBe(0.7); // photo slot 20
    expect(tForDuration(30, T_CFG)).toBe(0.8); // photo slot 30
  });

  it('reads the CONFIG values, not literals (a recalibrated bucket flows through)', () => {
    expect(tForDuration(10, { t10s: 0.5, t20s: 0.65, t30s: 0.9 })).toBe(0.5);
    expect(tForDuration(30, { t10s: 0.5, t20s: 0.65, t30s: 0.9 })).toBe(0.9);
  });
});

describe('capacity × T — Ii = Ii_brut × T (facturable), same T back-converts (US-2.9)', () => {
  it('pins a venue’s facturable capacity at each attention bucket', () => {
    // Ai=100, Hi=20 broadcastable slots, S→R physical = MIN[3600/S, 300/S].
    const brut10 = capaciteUtile(100, 20, computeR(10, 300)); // R=30 → 60000 physical
    expect(brut10).toBe(60000);
    expect(facturableFromPhysical(brut10, tForDuration(10, T_CFG))).toBe(36000); // ×0.6
    const brut20 = capaciteUtile(100, 20, computeR(20, 300)); // R=15 → 30000 physical
    expect(facturableFromPhysical(brut20, tForDuration(20, T_CFG))).toBe(21000); // ×0.7
    const brut30 = capaciteUtile(100, 20, computeR(30, 300)); // R=10 → 20000 physical
    expect(facturableFromPhysical(brut30, tForDuration(30, T_CFG))).toBe(16000); // ×0.8
  });

  it('round-trips: facturable → physical → facturable through the SAME T', () => {
    for (const t of [0.6, 0.7, 0.8, 1]) {
      expect(facturableFromPhysical(physicalFromFacturable(21000, t), t)).toBeCloseTo(21000, 9);
      expect(physicalFromFacturable(facturableFromPhysical(50000, t), t)).toBeCloseTo(50000, 9);
    }
    expect(physicalFromFacturable(1000, 0)).toBe(0); // guarded — never a division blow-up
  });

  it('buildPlan sizes the physical slots from the facturable allocation ÷ T', () => {
    const windowDays: WindowDay[] = [
      { date: '2026-07-06', dayOfWeek: 1 },
      { date: '2026-07-13', dayOfWeek: 1 },
    ];
    const pool: PoolEntry[] = [
      {
        id: 'A',
        sps: 9,
        anciennete: 0,
        revenuJour: 0,
        activeToday: false,
        avgAffluence: 100,
        hours: 24,
        capaciteUtile: 36000, // FACTURABLE (already ×0.6)
        residualCapacity: 36000,
        repsCap: 30,
        slots: Array.from({ length: 12 }, (_, i) => ({
          dayOfWeek: 1,
          hour: 8 + i,
          affluence: 100,
        })),
      },
    ];
    const plan = buildPlan({
      iCible: 18000,
      cpm: 10,
      s: 10,
      t: 0.6,
      seuilDiffusable: 1000,
      gMois: 100,
      joursActifs: 30,
      rMinEfficace: 2,
      fMaxSeconds: 300,
      windowDays,
      pool,
    });
    // 18000 facturable ÷ 0.6 = 30000 physical → r_i = clamp(30000/(100·24)=12.5, 2, 30) → 12.
    expect(plan.allocations[0]?.iiPotentiel).toBe(18000);
    expect(plan.allocations[0]?.rI).toBe(12);
  });
});

describe('refund gate — the VF fixed S_min (20 TND) at the exact boundary', () => {
  // One 1-imp créneau delivered per campaign; the manquement rides a single undelivered créneau
  // sized so P_perte = manquement × cpm/1000 lands exactly at 19.99 / 20 / 20.01 TND (cpm 10).
  const gateCase = (manquementImp: number) =>
    reconcileCampaign(
      [
        {
          screenhostId: 's',
          creneaux: [
            { date: '2026-07-01', hour: 8, impressions: 100000 },
            { date: '2026-07-01', hour: 9, impressions: manquementImp },
          ],
          deliveredSlots: new Set(['2026-07-01:8']),
        },
      ],
      10,
      S_MIN_TND,
    );

  it('P_perte = 19.99 TND → RÉUSSIE (below the gate, no refund)', () => {
    const v = gateCase(1999); // 1999 × 10/1000 = 19.99
    expect(v.pPerteTnd).toBe(19.99);
    expect(v.status).toBe('reussie');
    expect(v.refundTnd).toBe(0);
  });

  it('P_perte = 20 TND → PARTIAL (the gate is ≥, inclusive)', () => {
    const v = gateCase(2000); // exactly 20
    expect(v.pPerteTnd).toBe(20);
    expect(v.status).toBe('partial');
    expect(v.refundTnd).toBeGreaterThan(0);
  });

  it('P_perte = 20.01 TND → PARTIAL', () => {
    const v = gateCase(2001);
    expect(v.pPerteTnd).toBe(20.01);
    expect(v.status).toBe('partial');
  });
});

describe('VF business constants (the legend, pinned)', () => {
  it('anti-miette / no-crumbs seuil = 5 000 impressions', () => {
    expect(SEUIL_DIFFUSABLE).toBe(5000);
  });

  it('the money constants: S_min 20, G_mois 100, valeur min SH 20, %SH 50%', () => {
    expect(S_MIN_TND).toBe(20);
    expect(G_MOIS_TND).toBe(100);
    expect(VALEUR_MIN_SH_TND).toBe(20);
    expect(PCT_SH).toBe(0.5);
  });

  it('the calibratable POC config still carries ITS values (reconciled by later lanes)', () => {
    // E1 exports the VF canon; the seeded dispatch_config keeps seuil 1000 / g_mois 100 today —
    // no third behavior change rides this lane (only capacity ×T and the refund gate moved).
    expect(DISPATCH_CONFIG_DEFAULTS.seuilDiffusable).toBe(1000);
    expect(DISPATCH_CONFIG_DEFAULTS.gMois).toBe(G_MOIS_TND);
  });
});
