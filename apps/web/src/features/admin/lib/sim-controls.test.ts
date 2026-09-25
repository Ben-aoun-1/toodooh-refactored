import { describe, expect, it } from 'vitest';

import { eventBody, launchBody, pricingError, pricingPatch } from './sim-controls';

// SIM-6 phase 3 — the launch form and the sandbox pricing editor, as pure rules.
const form = {
  advertiserId: '',
  startInDays: 2,
  durationDays: 7,
  spotSeconds: 10,
  budgetMode: 'share' as const,
  budget: 40,
  sectorId: '',
  cls: '' as const,
};
const pricing = {
  standard_cpm_tnd: 6.2,
  event_cpm_tnd: 12,
  t_10s: 0.7,
  t_20s: 0.8,
  t_30s: 0.9,
  f_max_seconds: 300,
};

describe('launchBody', () => {
  it('a share budget is sent as a fraction, and nothing chosen means no targeting line', () => {
    expect(launchBody(form)).toEqual({
      start_in_days: 2,
      duration_days: 7,
      spot_seconds: 10,
      budget_share: 0.4,
    });
  });

  it('a TND budget, an advertiser and a class-only line (sector « toutes » = null)', () => {
    expect(
      launchBody({ ...form, budgetMode: 'tnd', budget: 250, advertiserId: 'a1', cls: 'premium' }),
    ).toEqual({
      start_in_days: 2,
      duration_days: 7,
      spot_seconds: 10,
      budget_tnd: 250,
      advertiser_id: 'a1',
      targeting: [{ category_id: null, class: 'premium' }],
    });
  });
});

describe('eventBody', () => {
  it('carries the kickoff hour and the budget mode', () => {
    expect(
      eventBody({
        inDays: 3,
        durationHours: 2,
        kickoffHour: 18,
        spotSeconds: 20,
        budgetMode: 'share',
        budget: 50,
      }),
    ).toEqual({
      in_days: 3,
      duration_hours: 2,
      kickoff_hour: 18,
      spot_seconds: 20,
      budget_share: 0.5,
    });
  });
});

describe('pricingError / pricingPatch', () => {
  it('accepts the defaults and refuses reversed attention indices or an out-of-range F', () => {
    expect(pricingError(pricing)).toBeNull();
    expect(pricingError({ ...pricing, t_10s: 0.95 })).toBe('Il faut T10 ≤ T20 ≤ T30.');
    expect(pricingError({ ...pricing, f_max_seconds: 4000 })).toBe(
      'F doit être un entier entre 10 et 3600 s.',
    );
    expect(pricingError({ ...pricing, event_cpm_tnd: 0 })).toBe('Les CPM doivent être positifs.');
  });

  it('sends only what changed', () => {
    expect(pricingPatch(pricing, { ...pricing, standard_cpm_tnd: 9, f_max_seconds: 600 })).toEqual({
      standard_cpm_tnd: 9,
      f_max_seconds: 600,
    });
    expect(pricingPatch(pricing, pricing)).toEqual({});
  });
});
