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

  it('a TOO-FULL screenhost is SKIPPED, not a stop: lower-SPS venues are still reached (CAP-F1)', () => {
    // C's residual (80) cannot host even one seuil(100) share while 200 remain to place. The
    // literal A.3 stopped here (the old pin: couvert 800, D never reached). Operator ruling
    // 2026-09-24: a venue too full to take a share is skipped — the queue continues to D.
    const { retenus, couvert } = selection(
      [sh('A', 9, 400), sh('B', 8, 400), sh('C', 7, 80), sh('D', 6, 500)],
      1000,
      TH,
    );
    expect(retenus).toEqual([
      { id: 'A', ai: 400 },
      { id: 'B', ai: 400 },
      { id: 'D', ai: 200 },
    ]);
    expect(couvert).toBe(1000);
  });

  it('THE PROD CASE (24/09): a nearly full TOP-SPS venue no longer empties the whole selection', () => {
    // toodooh (SPS 94) had 568 left under « Test Mariem »; seuil 2000 at CPM 10. The old ARRÊT
    // retained NOBODY → SATURATED → « — » on the draft, while resto and fffrfr had ~21 000 each.
    const E = [sh('toodooh', 94, 568), sh('resto', 72.67, 20_958), sh('fffrfr', 63.5, 21_861)];
    const th = { seuilDiffusable: 2_000, gJour: 0 };
    expect(selection(E, 15_700, th)).toEqual({
      retenus: [{ id: 'resto', ai: 15_700 }],
      couvert: 15_700,
    });
    expect(selection(E, 43_300, th).retenus.map((r) => r.id)).toEqual(['resto', 'fffrfr']);
  });

  it('a sub-seuil REMAINDER still stops the selection — a roomy venue is not opened for a miette', () => {
    // A takes 400, B 590 (both capacity-capped): 10 remain, below seuil(100). C has room but a
    // 10-impression line would be a miette → C is NOT opened; nobody has headroom to absorb the
    // 10, so couvert stays 990. The skip rule applies only to a too-FULL venue, never to a small
    // remainder (the tail rule is unchanged).
    const { retenus, couvert } = selection(
      [sh('A', 9, 400), sh('B', 8, 590), sh('C', 7, 500)],
      1000,
      TH,
    );
    expect(retenus).toEqual([
      { id: 'A', ai: 400 },
      { id: 'B', ai: 590 },
    ]);
    expect(couvert).toBe(990);
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
