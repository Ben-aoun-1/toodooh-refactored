import { describe, expect, it } from 'vitest';

import {
  type PoolEntry,
  type WindowDay,
  buildPlan,
  computeBounds,
} from '../src/lib/dispatch/plan.js';

const CFG = {
  seuilDiffusable: 1000,
  gMois: 100,
  joursActifs: 30,
  rMinEfficace: 2,
  fMaxSeconds: 300,
};
// Two Mondays — the broadcastable weekday slots repeat per matching window day.
const WINDOW: WindowDay[] = [
  { date: '2026-07-06', dayOfWeek: 1 },
  { date: '2026-07-13', dayOfWeek: 1 },
];
const monSlots = (affluence: number, from = 8, to = 20): PoolEntry['slots'] =>
  Array.from({ length: to - from }, (_, i) => ({ dayOfWeek: 1, hour: from + i, affluence }));

const poolEntry = (
  id: string,
  sps: number,
  o: {
    residual: number;
    cap?: number;
    ai?: number;
    hi?: number;
    repsCap?: number;
    slots?: PoolEntry['slots'];
  },
): PoolEntry => ({
  days: WINDOW,
  id,
  sps,
  anciennete: 0,
  revenuJour: 0,
  activeToday: false,
  avgAffluence: o.ai ?? 100,
  hours: o.hi ?? 24,
  capaciteUtile: o.cap ?? o.residual,
  residualCapacity: o.residual,
  // Default = the unconstrained F-based PHYSICAL R for s=10 (computeR(10,300)=30) — first-campaign
  // behavior, so these pre-F-cap-fix tests keep their semantics. A constrained screen overrides it.
  repsCap: o.repsCap ?? 30,
  slots: o.slots ?? [],
});

// t = the E1 attention index (buildPlan is pure — the DB layer derives it via tForDuration).
const base = { iCible: 20000, cpm: 10, s: 10, t: 0.8, ...CFG, windowDays: WINDOW };

describe('computeBounds (A.4)', () => {
  it('N_min = ⌈I_cible/max capacité_utile⌉, N_max = ⌊I_cible/seuil_diffusable⌋ (CPM cancels)', () => {
    expect(computeBounds(20000, 72000, 1000)).toEqual({ nMin: 1, nMax: 20 });
    expect(computeBounds(1500, 600, 1000)).toEqual({ nMin: 3, nMax: 1 });
  });

  it('N_max is the exact integer floor (no FP off-by-one) and 0 when seuil ≤ 0', () => {
    expect(computeBounds(3000, 999999, 1000).nMax).toBe(3); // ⌊3000/1000⌋ — exact, CPM-free
    expect(computeBounds(2500, 1, 1000).nMax).toBe(2); // ⌊2500/1000⌋
    expect(computeBounds(1000, 1, 0).nMax).toBe(0); // guarded against seuil ≤ 0
  });
});

describe('buildPlan — happy path (covers I_cible, A.5/A.6 honoured)', () => {
  const plan = buildPlan({
    ...base,
    pool: [
      poolEntry('A', 9, { residual: 72000, ai: 100, hi: 24, slots: monSlots(100) }),
      poolEntry('B', 8, { residual: 72000, ai: 100, hi: 24, slots: monSlots(100) }),
    ],
  });

  it('covers I_cible by concentrating on the top SPS (N is the output)', () => {
    expect(plan.couvert).toBe(20000);
    expect(plan.nRetenus).toBe(1); // A alone covers it
    expect(plan.isPartial).toBe(false);
    expect(plan.isTooThin).toBe(false);
    expect(plan.allocations[0]?.screenhostId).toBe('A');
    expect(plan.allocations[0]?.iiPotentiel).toBe(20000);
  });

  it('computes the seuil RELATIONS (S_min, G_jour) — not literals', () => {
    expect(plan.sMin).toBe(10); // 1000 × 10 / 1000
    expect(plan.gJour).toBeCloseTo(100 / 30, 5);
    expect(plan.nMin).toBe(1);
    expect(plan.nMax).toBe(20);
    expect(plan.r).toBe(30); // PHYSICAL MIN[3600/10, 300/10] = min(360,30) — E1: T is not in R
  });

  it('keeps R_i in [R_min_efficace, R] and never oversells the F second-cap', () => {
    const a = plan.allocations[0];
    expect(a).toBeDefined();
    // E1 back-conversion: the 20000 FACTURABLE allocation needs 20000/0.8 = 25000 physical
    // impressions → clamp(25000/(100·24)=10.42, 2, 30) → floor 10.
    expect(a!.rI).toBe(10);
    expect(a!.rI).toBeGreaterThanOrEqual(CFG.rMinEfficace);
    expect(a!.rI).toBeLessThanOrEqual(plan.r);
    expect(a!.rI * base.s).toBeLessThanOrEqual(CFG.fMaxSeconds); // Σ campaign-seconds/h ≤ F
    expect(a!.iiPotentiel).toBeLessThanOrEqual(72000); // never oversells residual
  });

  it('builds date×hour créneaux (cadence): reps = R_i, impressions = affluence × R_i', () => {
    const a = plan.allocations[0];
    expect(a!.creneaux).toHaveLength(24); // 2 Mondays × 12 hours
    const c = a!.creneaux[0];
    expect(c!.reps).toBe(a!.rI);
    expect(c!.impressions).toBe(100 * a!.rI);
    expect(3600 / a!.rI).toBeGreaterThan(0); // espacement = 3600 / R_i
  });
});

describe('buildPlan — clôture 1 (PARTIAL: pool cannot cover I_cible)', () => {
  it('flags is_partial when the pool is exhausted below I_cible', () => {
    const plan = buildPlan({
      ...base,
      pool: [
        poolEntry('A', 9, {
          residual: 5000,
          cap: 5000,
          ai: 100,
          hi: 5,
          slots: monSlots(100, 8, 13),
        }),
      ],
    });
    expect(plan.couvert).toBe(5000);
    expect(plan.isPartial).toBe(true);
    expect(plan.isTooThin).toBe(false); // N_min ⌈20000/5000⌉=4 ≤ N_max 20
  });
});

// E3 (Mariem 2026-07-15 amendment) — the post-selection storage matrix: a sub-seuil uncovered
// remainder is a crumb → STORED for E6 (not a clôture-1); a remainder ≥ seuil stays the existing
// partial path (nothing stored); full coverage stores nothing.
describe('buildPlan — reliquat stocké (E3 amendment storage matrix)', () => {
  it('CRUMB: 0 < V − couvert < seuil → stored, NOT partial', () => {
    // A covers 19 500 of 20 000 → reliquat 500 < seuil 1000, no headroom anywhere to absorb.
    const plan = buildPlan({
      ...base,
      pool: [poolEntry('A', 9, { residual: 19500, ai: 100, hi: 24, slots: monSlots(100) })],
    });
    expect(plan.couvert).toBe(19500);
    expect(plan.reliquatStocke).toBe(500);
    expect(plan.isPartial).toBe(false); // immaterial (< S_min) — E6 revalidates on the TOTAL
  });

  it('NON-CRUMB: V − couvert ≥ seuil → the existing partial path, reliquat NOT stored', () => {
    const plan = buildPlan({
      ...base,
      pool: [poolEntry('A', 9, { residual: 5000, cap: 5000, ai: 100, hi: 5 })],
    });
    expect(plan.couvert).toBe(5000); // reliquat 15 000 ≥ seuil 1000
    expect(plan.reliquatStocke).toBe(0);
    expect(plan.isPartial).toBe(true);
  });

  it('EXACT-SEUIL remainder is NOT a crumb (boundary: reliquat === seuil → partial path)', () => {
    // A covers 19 000 of 20 000 → reliquat exactly 1000 = seuil → material → partial, not stored.
    const plan = buildPlan({
      ...base,
      pool: [poolEntry('A', 9, { residual: 19000, ai: 100, hi: 24, slots: monSlots(100) })],
    });
    expect(plan.couvert).toBe(19000);
    expect(plan.reliquatStocke).toBe(0);
    expect(plan.isPartial).toBe(true);
  });

  it('ZERO remainder: covered plans store nothing and stay non-partial', () => {
    const plan = buildPlan({
      ...base,
      pool: [poolEntry('A', 9, { residual: 72000, ai: 100, hi: 24, slots: monSlots(100) })],
    });
    expect(plan.couvert).toBe(20000);
    expect(plan.reliquatStocke).toBe(0);
    expect(plan.isPartial).toBe(false);
  });
});

describe('buildPlan — clôture 2 (TOO THIN: N_min > N_max → renvoi curseur)', () => {
  it('flags is_too_thin when covering I_cible would force more SH than materiality allows', () => {
    const plan = buildPlan({
      ...base,
      iCible: 1500,
      pool: [
        poolEntry('A', 9, { residual: 600, cap: 600, ai: 100, hi: 6, slots: monSlots(100, 8, 14) }),
      ],
    });
    // N_min ⌈1500/600⌉=3 > N_max ⌊(1500·10/1000)/10⌋=1 → too thin.
    expect(plan.nMin).toBe(3);
    expect(plan.nMax).toBe(1);
    expect(plan.isTooThin).toBe(true);
  });

  it('flags too thin (and empty allocations) for an empty eligible pool', () => {
    const plan = buildPlan({ ...base, pool: [] });
    expect(plan.isTooThin).toBe(true);
    expect(plan.allocations).toHaveLength(0);
    expect(plan.couvert).toBe(0);
  });
});
