import { describe, expect, it } from 'vitest';

import {
  displayImpressionsInFlight,
  displayImpressionsSettled,
  predictedImpressions,
  predictedImpressionsOf,
} from '../src/lib/impressions-display.js';
import { slotKey, valueAllocation } from '../src/lib/reconcile/valuation.js';

// NET-IMP1 — « Impressions affichées = Impressions prédites − Impressions perdues » (Mejri
// 2026-08-04, ruled). PURE pins over THE ONE api display home; the bucketing is E6's own
// detector, so these fixtures speak the engine's language: PHYSICAL impressions, Tunis créneaux,
// binary delivery per slot.

// 2026-07-01T14:30Z = 15:30 Tunis → nowSlot { 2026-07-01, 15 }: hours < 15 are elapsed, the
// 15h créneau is IN PROGRESS (neither elapsed nor placeable), later hours are future.
const NOW = new Date('2026-07-01T14:30:00Z');

describe('displayImpressionsSettled (R2 — the closed-campaign identity)', () => {
  it('affichées = expected − manquement = delivered, straight from reconcile’s own arithmetic', () => {
    const creneaux = [
      { date: '2026-07-01', hour: 10, impressions: 300 },
      { date: '2026-07-01', hour: 11, impressions: 300 },
      { date: '2026-07-02', hour: 10, impressions: 400 },
    ];
    // Two of three slots aired — the third is the manquement (redispatched elsewhere).
    const deliveredSlots = new Set([slotKey('2026-07-01', 10), slotKey('2026-07-02', 10)]);
    const valuation = valueAllocation({ screenhostId: 'sh-a', creneaux, deliveredSlots }, 15, 0.6);
    expect(valuation.expectedImp).toBe(1000);
    expect(valuation.manquementImp).toBe(300);
    const display = displayImpressionsSettled({
      expectedImp: valuation.expectedImp,
      deliveredImp: valuation.deliveredImp,
    });
    expect(display).toBe(valuation.expectedImp - valuation.manquementImp); // prédites − perdues
    expect(display).toBe(valuation.deliveredImp); // = delivered: converges to reality at clôture
    expect(display).toBe(700);
  });

  it('no manquement → affichées = prédites, untouched', () => {
    expect(displayImpressionsSettled({ expectedImp: 5000, deliveredImp: 5000 })).toBe(5000);
  });
});

describe('displayImpressionsInFlight (R2 — predicted minus missed-so-far)', () => {
  it('future créneaux still count as predicted; only elapsed-∧-undelivered subtract', () => {
    const allocations = [
      {
        screenhostId: 'sh-a',
        creneaux: [
          { date: '2026-07-01', hour: 10, impressions: 300 }, // elapsed, delivered
          { date: '2026-07-01', hour: 11, impressions: 300 }, // elapsed, MISSED
          { date: '2026-07-01', hour: 15, impressions: 200 }, // IN PROGRESS — not elapsed
          { date: '2026-07-02', hour: 10, impressions: 400 }, // future
        ],
      },
    ];
    const deliveredBySh = new Map([['sh-a', new Set([slotKey('2026-07-01', 10)])]]);
    const [row] = displayImpressionsInFlight(allocations, deliveredBySh, NOW);
    expect(row).toEqual({
      screenhostId: 'sh-a',
      predictedImp: 1200,
      missedImp: 300, // ONLY the elapsed undelivered slot — never the in-progress hour
      displayImp: 900,
    });
  });

  it('no manquement so far → affichées = full prédites', () => {
    const allocations = [
      {
        screenhostId: 'sh-a',
        creneaux: [
          { date: '2026-07-01', hour: 10, impressions: 300 }, // elapsed, delivered
          { date: '2026-07-02', hour: 10, impressions: 400 }, // future
        ],
      },
    ];
    const deliveredBySh = new Map([['sh-a', new Set([slotKey('2026-07-01', 10)])]]);
    const [row] = displayImpressionsInFlight(allocations, deliveredBySh, NOW);
    expect(row?.displayImp).toBe(700);
    expect(row?.missedImp).toBe(0);
  });

  // R5 — redispatched-and-placed impressions belong to the RECEIVING venue's predicted: they
  // arrive there as real plan créneaux, so the home needs no special handling. Conservation:
  // campaign total = original − missed + placed = original − residual.
  it('two-venue redispatch conserves the campaign total minus the residual (R5)', () => {
    const ORIGINAL_A = 1000; // 4 × 250
    const ORIGINAL_B = 600; // 2 × 300, all future
    const MISSED = 500; // A's two elapsed undelivered slots
    const PLACED = 450; // what the round placed onto B as NEW future créneaux
    const RESIDUAL = MISSED - PLACED; // 50 — unplaceable, left for the next round/reconcile

    const allocations = [
      {
        screenhostId: 'sh-loser',
        creneaux: [
          { date: '2026-07-01', hour: 9, impressions: 250 }, // elapsed, MISSED
          { date: '2026-07-01', hour: 10, impressions: 250 }, // elapsed, MISSED
          { date: '2026-07-02', hour: 10, impressions: 250 }, // future
          { date: '2026-07-02', hour: 11, impressions: 250 }, // future
        ],
      },
      {
        screenhostId: 'sh-receiver',
        creneaux: [
          { date: '2026-07-02', hour: 12, impressions: 300 }, // original future
          { date: '2026-07-02', hour: 13, impressions: 300 }, // original future
          { date: '2026-07-03', hour: 10, impressions: 450 }, // the PLACED rattrapage créneau
        ],
      },
    ];
    const deliveredBySh = new Map<string, Set<string>>(); // nothing aired yet on either side
    const rows = displayImpressionsInFlight(allocations, deliveredBySh, NOW);
    const loser = rows.find((r) => r.screenhostId === 'sh-loser');
    const receiver = rows.find((r) => r.screenhostId === 'sh-receiver');

    expect(loser?.displayImp).toBe(ORIGINAL_A - MISSED); // 500 — drops by the missed quantity
    expect(receiver?.displayImp).toBe(ORIGINAL_B + PLACED); // 1050 — rises by the placed quantity
    const total = (loser?.displayImp ?? 0) + (receiver?.displayImp ?? 0);
    expect(total).toBe(ORIGINAL_A + ORIGINAL_B - MISSED + PLACED);
    expect(total).toBe(ORIGINAL_A + ORIGINAL_B - RESIDUAL); // conserved minus the residual
  });

  it('empty input → empty output', () => {
    expect(displayImpressionsInFlight([], new Map(), NOW)).toEqual([]);
  });
});

// IMP-EST1 — « prédites » has ONE computation home: the dry-run estimate
// (lib/impressions-estimate.ts) sums a SIMULATED plan with the very function the in-flight
// display sums a frozen one with, so the estimate and the owner-facing figure cannot drift apart.
describe('predictedImpressions — THE one « prédites » sum', () => {
  const allocations = [
    {
      screenhostId: 'sh-a',
      creneaux: [
        { date: '2026-07-01', hour: 10, impressions: 300 },
        { date: '2026-07-02', hour: 11, impressions: 250 },
      ],
    },
    {
      screenhostId: 'sh-b',
      creneaux: [{ date: '2026-07-02', hour: 12, impressions: 450 }],
    },
  ];

  it('per allocation, it is exactly the predictedImp the in-flight display reports', () => {
    const rows = displayImpressionsInFlight(allocations, new Map(), NOW);
    for (const a of allocations) {
      const row = rows.find((r) => r.screenhostId === a.screenhostId);
      expect(predictedImpressionsOf(a)).toBe(row?.predictedImp);
    }
  });

  it('over a plan, it is Σ of those same per-venue figures', () => {
    const rows = displayImpressionsInFlight(allocations, new Map(), NOW);
    const sumOfHome = rows.reduce((sum, r) => sum + r.predictedImp, 0);
    expect(predictedImpressions(allocations)).toBe(sumOfHome);
    expect(predictedImpressions(allocations)).toBe(1000);
    expect(predictedImpressions([])).toBe(0);
  });
});
