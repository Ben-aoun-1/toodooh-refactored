import { describe, expect, it } from 'vitest';

import type { ScreenhostEligibility } from '@/features/admin/services/admin-screenhost.service';
import { HOURS_ORDER_HINT } from '@/features/screenhost/lib/venue-hours';

import {
  CAPACITY_ERROR,
  ELIGIBILITY_CONSEQUENCE_NOTE,
  HOURS_PAIR_ERROR,
  SECTOR_INVALID_ERROR,
  buildEligibilityPatch,
  formStateFromView,
  mapEligibilityServerErrors,
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

  it('rejects ouverture ≥ fermeture with the H2 order hint (strict <, same copy)', () => {
    const inverted = { ...formStateFromView(emptyView), openingHour: 22, closingHour: 8 };
    expect(validateEligibilityForm(inverted)).toEqual({ closing_hour: HOURS_ORDER_HINT });
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
  it('pins the null-clearing consequence note (charter verbatim)', () => {
    expect(ELIGIBILITY_CONSEQUENCE_NOTE).toBe(
      "Sans horaires ou capacité, l'établissement est exclu des prochaines campagnes.",
    );
  });
});
