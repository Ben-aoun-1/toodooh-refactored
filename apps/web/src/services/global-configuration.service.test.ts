import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
    },
  },
}));

import {
  validateValueForKey,
  mapParsedToDoohNumbers,
  GLOBAL_CONFIGURATION_KEYS,
} from './global-configuration.service';

describe('validateValueForKey', () => {
  it('rejects billable rate outside 0..1', () => {
    const r = validateValueForKey(
      GLOBAL_CONFIGURATION_KEYS.max_billable_spot_rate_per_hour,
      '2',
      'numeric'
    );
    expect(r.ok).toBe(false);
  });

  it('accepts valid integer', () => {
    const r = validateValueForKey(GLOBAL_CONFIGURATION_KEYS.max_spots_per_hour, '12', 'integer');
    expect(r).toEqual({ ok: true, valueText: '12' });
  });
});

describe('mapParsedToDoohNumbers', () => {
  it('falls back to defaults for missing keys', () => {
    const n = mapParsedToDoohNumbers({});
    expect(n.standard_campaign_cpm_tnd).toBeGreaterThan(0);
    expect(n.max_spots_per_hour).toBeGreaterThan(0);
  });
});
