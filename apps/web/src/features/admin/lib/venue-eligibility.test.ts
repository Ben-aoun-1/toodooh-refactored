import { describe, expect, it } from 'vitest';

import type { ScreenhostEligibility } from '@/features/admin/services/admin-screenhost.service';
import { HOURS_ORDER_HINT } from '@/features/screenhost/lib/venue-hours';

import {
  CAPACITY_ERROR,
  CAPACITY_FIELD_HINT,
  CAPACITY_FIELD_LABEL,
  CAPACITY_FIELD_PLACEHOLDER,
  ELIGIBILITY_CONSEQUENCE_NOTE,
  HOURS_PAIR_ERROR,
  READINESS_ELIGIBLE_LABEL,
  SECTOR_INVALID_ERROR,
  buildEligibilityPatch,
  eligibilityReadiness,
  formStateFromView,
  mapEligibilityServerErrors,
  readinessBadgeLabel,
  validateEligibilityForm,
} from './venue-eligibility';

const emptyView: ScreenhostEligibility = {
  business_sector_id: null,
  class: null,
  opening_hour: null,
  closing_hour: null,
  broadcast_capacity: null,
  sps: 50,
};

const fullView: ScreenhostEligibility = {
  business_sector_id: 'sec-1',
  class: 'premium',
  opening_hour: 8,
  closing_hour: 22,
  broadcast_capacity: 40,
  sps: 50,
};

describe('formStateFromView', () => {
  it('maps a NULL-everything view to the empty form (capacity as blank text)', () => {
    expect(formStateFromView(emptyView)).toEqual({
      businessSectorId: null,
      venueClass: null,
      openingHour: null,
      closingHour: null,
      capacityInput: '',
    });
  });

  it('prefills a populated view (capacity stringified for the input)', () => {
    expect(formStateFromView(fullView)).toEqual({
      businessSectorId: 'sec-1',
      venueClass: 'premium',
      openingHour: 8,
      closingHour: 22,
      capacityInput: '40',
    });
  });
});

describe('validateEligibilityForm — the client-side mirror of the PATCH rules', () => {
  it('accepts the all-cleared form (clearing every field is legal)', () => {
    expect(validateEligibilityForm(formStateFromView(emptyView))).toEqual({});
  });

  it('accepts a fully-set, coherent form', () => {
    expect(validateEligibilityForm(formStateFromView(fullView))).toEqual({});
  });

  it('rejects an ouverture without fermeture (set-together, error on the missing side)', () => {
    const form = { ...formStateFromView(emptyView), openingHour: 8 };
    expect(validateEligibilityForm(form)).toEqual({ closing_hour: HOURS_PAIR_ERROR });
  });

  it('rejects a fermeture without ouverture (set-together, error on the missing side)', () => {
    const form = { ...formStateFromView(emptyView), closingHour: 22 };
    expect(validateEligibilityForm(form)).toEqual({ opening_hour: HOURS_PAIR_ERROR });
  });

  it('HOURS-X1: accepts an inverted pair (overnight) and rejects only the equal one (same copy as H2)', () => {
    const inverted = { ...formStateFromView(emptyView), openingHour: 22, closingHour: 8 };
    expect(validateEligibilityForm(inverted)).toEqual({});
    const equal = { ...formStateFromView(emptyView), openingHour: 8, closingHour: 8 };
    expect(validateEligibilityForm(equal)).toEqual({ closing_hour: HOURS_ORDER_HINT });
  });

  it.each(['0', '-3', '3.5', 'abc'])('rejects the non-positive-int capacity %j', (input) => {
    const form = { ...formStateFromView(emptyView), capacityInput: input };
    expect(validateEligibilityForm(form)).toEqual({ broadcast_capacity: CAPACITY_ERROR });
  });

  it('accepts a positive integer capacity and the blank (= clear) input', () => {
    expect(
      validateEligibilityForm({ ...formStateFromView(emptyView), capacityInput: '12' }),
    ).toEqual({});
    expect(validateEligibilityForm({ ...formStateFromView(emptyView), capacityInput: '' })).toEqual(
      {},
    );
  });
});

describe('buildEligibilityPatch — dirty fields only (the partial-PATCH contract)', () => {
  it('returns an empty patch when nothing changed', () => {
    expect(buildEligibilityPatch(fullView, formStateFromView(fullView))).toEqual({});
  });

  it('sends only the changed field (set on a NULL view)', () => {
    const form = { ...formStateFromView(emptyView), businessSectorId: 'sec-9' };
    expect(buildEligibilityPatch(emptyView, form)).toEqual({ business_sector_id: 'sec-9' });
  });

  it('clears a field with an explicit null (capacity emptied)', () => {
    const form = { ...formStateFromView(fullView), capacityInput: '' };
    expect(buildEligibilityPatch(fullView, form)).toEqual({ broadcast_capacity: null });
  });

  it('sends the full hours pair when it is set from scratch', () => {
    const form = { ...formStateFromView(emptyView), openingHour: 8, closingHour: 22 };
    expect(buildEligibilityPatch(emptyView, form)).toEqual({ opening_hour: 8, closing_hour: 22 });
  });

  it('treats a whitespace-padded, numerically-equal capacity as unchanged', () => {
    const form = { ...formStateFromView(fullView), capacityInput: ' 40 ' };
    expect(buildEligibilityPatch(fullView, form)).toEqual({});
  });

  it('clears class and category together when both are reset to « — »', () => {
    const form = { ...formStateFromView(fullView), businessSectorId: null, venueClass: null };
    expect(buildEligibilityPatch(fullView, form)).toEqual({
      business_sector_id: null,
      class: null,
    });
  });
});

describe('mapEligibilityServerErrors — server field errors surfaced in French', () => {
  it('maps the owner-sector rejection onto the catégorie field', () => {
    expect(
      mapEligibilityServerErrors([
        { field: 'business_sector_id', reason: 'must be a valid venue category' },
      ]),
    ).toEqual({ business_sector_id: SECTOR_INVALID_ERROR });
  });

  it('maps capacity and hour rejections onto their fields with the mirror copy', () => {
    const mapped = mapEligibilityServerErrors([
      { field: 'broadcast_capacity', reason: 'Too small' },
      { field: 'opening_hour', reason: 'Too big' },
    ]);
    expect(mapped.broadcast_capacity).toBe(CAPACITY_ERROR);
    expect(typeof mapped.opening_hour).toBe('string');
  });

  it('ignores unknown fields and handles the fields-less error shape', () => {
    expect(mapEligibilityServerErrors([{ field: 'nope', reason: 'x' }])).toEqual({});
    expect(mapEligibilityServerErrors(undefined)).toEqual({});
  });
});

describe('pinned copy', () => {
  it('pins the null-clearing consequence note (CAP-EVT1: horaires gate both, capacité events only)', () => {
    expect(ELIGIBILITY_CONSEQUENCE_NOTE).toBe(
      "Sans horaires, l'établissement est exclu des prochaines campagnes et des événements. Sans capacité de diffusion, il est exclu des événements seulement.",
    );
  });

  it('CAP-EVT1 — the capacity field says it is the event switch (operator copy)', () => {
    expect(CAPACITY_FIELD_LABEL).toBe('Capacité de diffusion (événements)');
    expect(CAPACITY_FIELD_HINT).toBe(
      "Rend l'établissement éligible aux événements (ex. 1). Sans effet sur les campagnes classiques.",
    );
    expect(CAPACITY_FIELD_PLACEHOLDER).toBe('Vide = hors événements');
  });
});

describe('eligibilityReadiness — the badge matrix (catégorie × horaires)', () => {
  const withFields = (sector: boolean, hours: boolean, capacity: boolean) => ({
    ...emptyView,
    business_sector_id: sector ? 'sec-1' : null,
    opening_hour: hours ? 8 : null,
    closing_hour: hours ? 22 : null,
    broadcast_capacity: capacity ? 40 : null,
  });

  it('is eligible when catégorie and horaires are present', () => {
    expect(eligibilityReadiness(withFields(true, true, true))).toEqual({
      eligible: true,
      missing: [],
    });
  });

  it('CAP-EVT1 — an empty capacité never makes a venue « Incomplet » (it is the event switch)', () => {
    expect(eligibilityReadiness(withFields(true, true, false))).toEqual({
      eligible: true,
      missing: [],
    });
    for (const sector of [true, false])
      for (const hours of [true, false]) {
        expect(eligibilityReadiness(withFields(sector, hours, false)).missing).not.toContain(
          'capacité',
        );
        expect(eligibilityReadiness(withFields(sector, hours, false))).toEqual(
          eligibilityReadiness(withFields(sector, hours, true)),
        );
      }
  });

  it.each([
    [false, true, ['catégorie']],
    [true, false, ['horaires']],
    [false, false, ['catégorie', 'horaires']],
  ])(
    'lists the missing fields in fixed order (sector=%s hours=%s → %j)',
    (sector, hours, missing) => {
      expect(eligibilityReadiness(withFields(sector, hours, true))).toEqual({
        eligible: false,
        missing,
      });
    },
  );

  it('counts a half-set hours pair as missing horaires', () => {
    expect(eligibilityReadiness({ ...withFields(true, false, true), opening_hour: 8 })).toEqual({
      eligible: false,
      missing: ['horaires'],
    });
  });

  it('HOURS-X1: an inverted window (22 → 8) is an overnight window and COUNTS as horaires', () => {
    expect(
      eligibilityReadiness({
        ...withFields(true, false, true),
        opening_hour: 22,
        closing_hour: 8,
      }),
    ).toEqual({ eligible: true, missing: [] });
  });

  it('counts a zero-width window (ouverture = fermeture) as missing horaires — mirrors the pool gate', () => {
    expect(
      eligibilityReadiness({
        ...withFields(true, false, true),
        opening_hour: 8,
        closing_hour: 8,
      }),
    ).toEqual({ eligible: false, missing: ['horaires'] });
  });
});

describe('readinessBadgeLabel', () => {
  it('labels the eligible state', () => {
    expect(readinessBadgeLabel({ eligible: true, missing: [] })).toBe(READINESS_ELIGIBLE_LABEL);
    expect(READINESS_ELIGIBLE_LABEL).toBe('Éligible au dispatch');
  });

  it('lists the missing fields after « Incomplet — »', () => {
    expect(readinessBadgeLabel({ eligible: false, missing: ['catégorie', 'horaires'] })).toBe(
      'Incomplet — catégorie, horaires',
    );
  });
});
