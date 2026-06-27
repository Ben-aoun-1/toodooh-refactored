import { describe, expect, it } from 'vitest';

import { boundDurationMs } from '../src/lib/playout/ingest.js';

describe('boundDurationMs — bound the billing duration (anti-spam)', () => {
  it('clamps an absurd value to creative_duration × 1000 × tolerance', () => {
    expect(boundDurationMs(999_999_999, 30)).toBe(60_000); // 30s × 1000 × 2
    expect(boundDurationMs(12_345, 30)).toBe(12_345); // within bound → unchanged
  });
  it('falls back to a hard ceiling when the creative duration is unknown', () => {
    expect(boundDurationMs(999_999_999, null)).toBe(600_000); // 300s × 1000 × 2
  });
  it('treats null/negative as null', () => {
    expect(boundDurationMs(null, 30)).toBeNull();
    expect(boundDurationMs(-5, 30)).toBeNull();
  });
});
