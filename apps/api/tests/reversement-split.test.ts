import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REVERSEMENT_PCTS,
  computeReversement,
  millimesToTnd,
  reversementBaseMillimes,
  tndToMillimes,
} from '../src/lib/reversement/split.js';

// E7 — the pure 50/44/3/3 reversement rail (VF EPIC 5). Money in integer MILLIMES so the four
// lines always sum EXACTLY to the base; the floor residue lands on the Toodooh line (pinned).

describe('computeReversement — exact-sum split', () => {
  it('splits a clean base 50/44/3/3 (1 TND = 1000 millimes)', () => {
    expect(computeReversement(1000)).toEqual({
      baseMillimes: 1000,
      shMillimes: 500,
      toodoohMillimes: 440,
      agentShMillimes: 30,
      agentScMillimes: 30,
    });
  });

  it('routes the rounding residue to the Toodooh line', () => {
    // 1001: sh floor 500, agents floor 30 each → toodooh takes 441 (440 + the 1-millime residue).
    expect(computeReversement(1001)).toEqual({
      baseMillimes: 1001,
      shMillimes: 500,
      toodoohMillimes: 441,
      agentShMillimes: 30,
      agentScMillimes: 30,
    });
    // 33: sh 16, agents 0 each → toodooh 17.
    expect(computeReversement(33)).toEqual({
      baseMillimes: 33,
      shMillimes: 16,
      toodoohMillimes: 17,
      agentShMillimes: 0,
      agentScMillimes: 0,
    });
  });

  it('sums the four lines EXACTLY to the base across a sweep (the conservation pin)', () => {
    for (let base = 0; base < 5000; base += 7) {
      const s = computeReversement(base);
      expect(s.shMillimes + s.toodoohMillimes + s.agentShMillimes + s.agentScMillimes).toBe(base);
    }
  });

  it('handles the zero base (all-zero lines)', () => {
    expect(computeReversement(0)).toEqual({
      baseMillimes: 0,
      shMillimes: 0,
      toodoohMillimes: 0,
      agentShMillimes: 0,
      agentScMillimes: 0,
    });
  });

  it('accepts custom percentages that sum to 100', () => {
    const s = computeReversement(1000, { sh: 60, toodooh: 40, agentSh: 0, agentSc: 0 });
    expect(s.shMillimes).toBe(600);
    expect(s.toodoohMillimes).toBe(400);
    expect(s.agentShMillimes).toBe(0);
    expect(s.agentScMillimes).toBe(0);
  });

  it('rejects percentages that do not sum to 100', () => {
    expect(() => computeReversement(1000, { sh: 50, toodooh: 45, agentSh: 3, agentSc: 3 })).toThrow(
      /100/,
    );
  });

  it('rejects a negative percentage', () => {
    expect(() =>
      computeReversement(1000, { sh: 104, toodooh: -10, agentSh: 3, agentSc: 3 }),
    ).toThrow();
  });

  it('rejects a non-integer or negative base', () => {
    expect(() => computeReversement(10.5)).toThrow();
    expect(() => computeReversement(-1)).toThrow();
  });

  it('pins the default percentages at 50/44/3/3', () => {
    expect(DEFAULT_REVERSEMENT_PCTS).toEqual({ sh: 50, toodooh: 44, agentSh: 3, agentSc: 3 });
  });
});

describe('reversementBaseMillimes — the SPEC revenue base (delivered ÷ target) × C_cible', () => {
  it('is proportional to the target value', () => {
    // Half delivered of a 100 TND target → 50 TND = 50 000 millimes.
    expect(reversementBaseMillimes(5000, 10000, 100)).toBe(50000);
  });

  it('equals delivered × CPM/1000 when C_cible = I_cible × CPM/1000 (the pinned equivalence)', () => {
    const iCible = 20000;
    const cpm = 10;
    const cCible = (iCible * cpm) / 1000; // 200 TND
    for (const delivered of [0, 1, 4321, 10000, 20000]) {
      expect(reversementBaseMillimes(delivered, iCible, cCible)).toBe(
        tndToMillimes((delivered * cpm) / 1000),
      );
    }
  });

  it('returns 0 on a zero/invalid target (no divide-by-zero)', () => {
    expect(reversementBaseMillimes(1000, 0, 100)).toBe(0);
  });
});

describe('millime ↔ TND helpers', () => {
  it('round-trips', () => {
    expect(tndToMillimes(12.345)).toBe(12345);
    expect(millimesToTnd(12345)).toBe(12.345);
    expect(tndToMillimes(millimesToTnd(441))).toBe(441);
  });
});

describe('D51 — origin neutrality (module-boundary pin)', () => {
  it('imports NOTHING campaign- or event-shaped (the Event engine reuses this rail verbatim)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/lib/reversement/split.ts', import.meta.url)),
      'utf8',
    );
    // The pure rail may not import from the schema, the campaign libs, or the DB layer.
    expect(source).not.toMatch(/from '.*schema/);
    expect(source).not.toMatch(/from '.*campaign/i);
    expect(source).not.toMatch(/from '.*event/i);
    expect(source).not.toMatch(/from '.*db\//);
    expect(source).not.toMatch(/\bimport\s+\{[^}]*campaign/i);
  });
});
