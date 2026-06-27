import { describe, expect, it } from 'vitest';

import { type EligibleScreenhost, orderedQueue, selection } from '../src/lib/dispatch/selection.js';

// Pins the spec A.3 invariants exhaustively. Heart of the dispatcher — pure + deterministic.
const sh = (
  id: string,
  sps: number,
  residualCapacity: number,
  opts: Partial<EligibleScreenhost> = {},
): EligibleScreenhost => ({
  id,
  sps,
  anciennete: opts.anciennete ?? 0,
  residualCapacity,
  revenuJour: opts.revenuJour ?? 0,
  activeToday: opts.activeToday ?? false,
});

const TH = { seuilDiffusable: 100, gJour: 10 };

describe('SÉLECTION — concentration (N is an OUTPUT, stop at couvert ≥ V)', () => {
  it('fills high-SPS first and caps the last at the remaining (couvert = V)', () => {
    const { retenus, couvert } = selection([sh('A', 9, 600), sh('B', 8, 600)], 1000, TH);
    expect(couvert).toBe(1000);
    expect(retenus).toEqual([
      { id: 'A', ai: 600 },
      { id: 'B', ai: 400 }, // capped by remaining
    ]);
  });

  it('stops as soon as V is covered — not one screenhost more', () => {
    const { retenus, couvert } = selection([sh('A', 9, 1000), sh('B', 8, 500)], 1000, TH);
    expect(couvert).toBe(1000);
    expect(retenus).toEqual([{ id: 'A', ai: 1000 }]); // B never opened
  });
});

describe('SÉLECTION — ordering (SPS desc; ancienneté breaks EXACT ties only)', () => {
  it('orders by SPS descending', () => {
    const { retenus } = selection([sh('low', 2, 1000), sh('high', 9, 1000)], 500, TH);
    expect(retenus[0]?.id).toBe('high');
  });

  it('breaks an exact SPS tie by ancienneté (oldest last-service first)', () => {
    const q = orderedQueue(
      [sh('X', 5, 1000, { anciennete: 200 }), sh('Y', 5, 1000, { anciennete: 100 })],
      TH.gJour,
    );
    expect(q.map((s) => s.id)).toEqual(['Y', 'X']); // Y older (100 < 200) → first
  });

  it('NEVER lets ancienneté override SPS (only exact ties)', () => {
    const q = orderedQueue(
      [
        sh('older-lowsps', 5, 1000, { anciennete: 1 }),
        sh('newer-highsps', 6, 1000, { anciennete: 999 }),
      ],
      TH.gJour,
    );
    expect(q[0]?.id).toBe('newer-highsps'); // higher SPS wins despite being newer
  });
});

describe('SÉLECTION — dignity (active today & revenu_jour < G_jour → head)', () => {
  it('moves a dignity screenhost to the head despite lower SPS', () => {
    const { retenus } = selection(
      [sh('A', 9, 500), sh('B', 3, 500, { activeToday: true, revenuJour: 5 })],
      400,
      TH,
    );
    expect(retenus[0]?.id).toBe('B'); // B is active today & under G_jour (5 < 10)
  });

  it('does NOT prioritise a screenhost already at/above G_jour', () => {
    const q = orderedQueue(
      [sh('A', 9, 500), sh('B', 3, 500, { activeToday: true, revenuJour: 15 })],
      TH.gJour,
    );
    expect(q[0]?.id).toBe('A'); // B revenuJour 15 ≥ 10 → not dignity
  });

  it('does NOT prioritise a screenhost not active today (nothing started to finish)', () => {
    const q = orderedQueue(
      [sh('A', 9, 500), sh('B', 3, 500, { activeToday: false, revenuJour: 5 })],
      TH.gJour,
    );
    expect(q[0]?.id).toBe('A');
  });
});

describe('SÉLECTION — jamais de miette (no sub-seuil allocation)', () => {
  it('never opens a sub-seuil line; an unabsorbable tail reliquat leaves couvert < V', () => {
    // A takes 950 (residual-capped). The 50 tail is < seuil(100); A has no headroom (950/950) and
    // there is no other retained SH with capacity → the reliquat is NOT placed (no oversell) and
    // NOT opened as a miette on B. couvert stays 950 → the pipeline reports this as partial.
    const { retenus, couvert } = selection([sh('A', 9, 950), sh('B', 8, 500)], 1000, TH);
    expect(retenus).toEqual([{ id: 'A', ai: 950 }]); // B not opened (would be a 50-impression miette)
    expect(couvert).toBe(950);
  });

  it('a sub-seuil screenhost triggers ARRÊT (concentration) rather than reaching lower-SPS venues', () => {
    // C's residual (80) is below seuil(100); per A.3 a_i < seuil → ARRÊT. The reliquat can't be
    // absorbed (A,B are residual-capped → no headroom), so couvert stays 800 (partial) and the
    // lower-SPS D is NOT reached — concentration on the top of the pool. (Flagged in CF-9: the
    // literal A.3 stops here rather than "skipping" C.)
    const { retenus, couvert } = selection(
      [sh('A', 9, 400), sh('B', 8, 400), sh('C', 7, 80), sh('D', 6, 500)],
      1000,
      TH,
    );
    expect(retenus).toEqual([
      { id: 'A', ai: 400 },
      { id: 'B', ai: 400 },
    ]);
    expect(couvert).toBe(800);
  });

  it('never allocates a screenhost more than its residual capacity (no survente)', () => {
    const { retenus } = selection([sh('A', 9, 300), sh('B', 8, 300)], 1000, TH);
    for (const r of retenus) {
      const cap = r.id === 'A' ? 300 : 300;
      expect(r.ai).toBeLessThanOrEqual(cap);
    }
  });
});

describe('SÉLECTION — reuse with a non-empty plan (redispatch call shape)', () => {
  it('allocates an increment over pre-reduced residual capacities (same function)', () => {
    // E here reflects a current plan: residualCapacity is already net of engagements; V is the
    // increment to (re)cover. Identical function, different inputs.
    const { retenus, couvert } = selection([sh('A', 9, 200), sh('B', 8, 300)], 400, TH);
    expect(couvert).toBe(400);
    expect(retenus).toEqual([
      { id: 'A', ai: 200 },
      { id: 'B', ai: 200 },
    ]);
  });
});
