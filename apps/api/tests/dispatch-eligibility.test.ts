import { describe, expect, it } from 'vitest';

import {
  broadcastableHours,
  capaciteUtile,
  computeR,
  computeRi,
  screenhostMatchesTargeting,
  screenhostMatchesZones,
} from '../src/lib/dispatch/eligibility.js';

describe('screenhostMatchesTargeting — category × class with NULL = "toutes"', () => {
  const restaurant = { businessSectorId: 'cat-r', class: 'premium' };

  it('matches an exact category × class line', () => {
    expect(
      screenhostMatchesTargeting(restaurant, [{ categoryId: 'cat-r', class: 'premium' }]),
    ).toBe(true);
    expect(
      screenhostMatchesTargeting(restaurant, [{ categoryId: 'cat-x', class: 'premium' }]),
    ).toBe(false);
    expect(screenhostMatchesTargeting(restaurant, [{ categoryId: 'cat-r', class: 'moyen' }])).toBe(
      false,
    );
  });

  it('a NULL axis on the line means "toutes" on that axis', () => {
    expect(screenhostMatchesTargeting(restaurant, [{ categoryId: null, class: 'premium' }])).toBe(
      true,
    );
    expect(screenhostMatchesTargeting(restaurant, [{ categoryId: 'cat-r', class: null }])).toBe(
      true,
    );
  });

  it('the null/null line is the whole network (matches every screenhost)', () => {
    expect(screenhostMatchesTargeting(restaurant, [{ categoryId: null, class: null }])).toBe(true);
    expect(
      screenhostMatchesTargeting({ businessSectorId: null, class: null }, [
        { categoryId: null, class: null },
      ]),
    ).toBe(true);
  });

  it('an uncategorised screenhost only matches lines that are "toutes" on the null axis', () => {
    const uncategorised = { businessSectorId: null, class: 'premium' };
    expect(
      screenhostMatchesTargeting(uncategorised, [{ categoryId: 'cat-r', class: 'premium' }]),
    ).toBe(false);
    expect(
      screenhostMatchesTargeting(uncategorised, [{ categoryId: null, class: 'premium' }]),
    ).toBe(true);
  });

  it('matches if ANY line matches; no lines → not eligible', () => {
    expect(
      screenhostMatchesTargeting(restaurant, [
        { categoryId: 'cat-x', class: 'moyen' },
        { categoryId: 'cat-r', class: 'premium' },
      ]),
    ).toBe(true);
    expect(screenhostMatchesTargeting(restaurant, [])).toBe(false);
  });
});

describe('broadcastableHours — intra-day horaires window [opening, closing)', () => {
  it('expands a valid window', () => {
    expect(broadcastableHours(8, 12)).toEqual([8, 9, 10, 11]);
  });
  it('is empty when unset or non-positive (V1: no overnight)', () => {
    expect(broadcastableHours(null, 12)).toEqual([]);
    expect(broadcastableHours(8, null)).toEqual([]);
    expect(broadcastableHours(20, 8)).toEqual([]);
    expect(broadcastableHours(10, 10)).toEqual([]);
  });
});

describe('computeR — R = MIN[(3600/S)·T, F/S] (floored)', () => {
  it('is capped by F/S when the tier term is larger', () => {
    expect(computeR(10, 0.8, 300)).toBe(30); // min(288, 30)
    expect(computeR(10, 0.5, 300)).toBe(30); // min(180, 30)
  });
  it('is capped by the tier term when F/S is larger', () => {
    expect(computeR(60, 0.5, 300)).toBe(5); // min(30, 5)
    expect(computeR(120, 0.8, 300)).toBe(2); // min(24, 2.5) → floor 2
  });

  it('caps at residual_seconds/S when passed a per-screen residual budget (F-cap fix)', () => {
    // The third arg is a generic seconds budget: with other campaigns engaged the caller passes the
    // residual (F − engaged) instead of F → R_eff = MIN[(3600/S)·T, ⌊residual/S⌋].
    expect(computeR(10, 0.8, 120)).toBe(12); // min(288, 12) — residual 120s, 10s spot
    expect(computeR(10, 0.8, 95)).toBe(9); // min(288, ⌊9.5⌋) → 9
    expect(computeR(10, 0.8, 0)).toBe(0); // a full screen (residual 0) → no reps
  });
});

describe('capaciteUtile + computeRi (A.5)', () => {
  it('capacité_utile = Ai·Hi·R', () => {
    expect(capaciteUtile(100, 12, 30)).toBe(36000);
  });

  it('R_i = clamp(a_i/(Ai·Hi), R_min_efficace, R), floored', () => {
    // 18000 / (100·12) = 15 → within [2, 30]
    expect(computeRi(18000, 100, 12, 2, 30)).toBe(15);
  });
  it('floors to the R_min_efficace floor when the raw rate is below it', () => {
    // 600 / 1200 = 0.5 → clamped up to R_min_efficace 2
    expect(computeRi(600, 100, 12, 2, 30)).toBe(2);
  });
  it('caps at R when the raw rate exceeds it', () => {
    expect(computeRi(1_000_000, 100, 12, 2, 30)).toBe(30);
  });
  it('yields R when R_min_efficace > R (venue cannot reach the efficient floor)', () => {
    expect(computeRi(18000, 100, 12, 40, 30)).toBe(30);
  });
});

// ── CF-Z1 (VF US-2.1) — the zone eligibility clause ───────────────────────────────────────────
describe('screenhostMatchesZones', () => {
  const GT = '2c8e5a1e-4b7d-4f3a-9c6e-1a2b3c4d5e6f';
  const SFAX = '99999999-9999-4999-8999-999999999999';

  it('match: the venue zone is among the campaign zones', () => {
    expect(screenhostMatchesZones(GT, [GT])).toBe(true);
    expect(screenhostMatchesZones(GT, [SFAX, GT])).toBe(true);
  });

  it('no-match: a zoned campaign excludes venues in other zones', () => {
    expect(screenhostMatchesZones(GT, [SFAX])).toBe(false);
  });

  it('no-zones-pass: a campaign without zones passes every venue (whole network)', () => {
    expect(screenhostMatchesZones(GT, [])).toBe(true);
    expect(screenhostMatchesZones(null, [])).toBe(true);
  });

  it('a NULL venue zone fails any ZONED campaign', () => {
    expect(screenhostMatchesZones(null, [GT])).toBe(false);
  });
});
