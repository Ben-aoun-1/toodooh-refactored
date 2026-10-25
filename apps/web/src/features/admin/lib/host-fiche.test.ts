import { describe, expect, it } from 'vitest';

import type { HostOwner, HostVenue } from '@/features/admin/services/admin-host.service';

import {
  buildOwnerPatch,
  buildVenuePatch,
  historyChanges,
  mapServerFieldErrors,
  ownerFormFrom,
  parseCoordinate,
  venueFormFrom,
} from './host-fiche';

const venue: HostVenue = {
  id: 'v1',
  name: 'Café Test',
  address: '1 rue X',
  city: 'Tunis',
  postal_code: '1000',
  governorate_id: null,
  zone: null,
  latitude: 36.8,
  longitude: 10.18,
  is_active: true,
  demo_only: false,
  screen_count: 1,
  room_count: null,
  wifi_ssid: null,
  wifi_password_set: false,
  export_status: 'exported',
  exported_at: null,
  locked_fields: [],
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const owner: HostOwner = {
  id: 'u1',
  email: 'a@b.tn',
  role: 'individual_owner',
  status: 'approved',
  business_name: 'Chez Ali',
  tax_number: null,
  contact_name: 'Ali',
  contact_phone: '+21612345678',
  fonction: null,
  street_address: null,
  city: null,
  postal_code: null,
  governorate_id: null,
  zone: null,
  venues_count: 1,
};

describe('HOST-EDIT1 venue form', () => {
  it('an untouched form is an empty patch', () => {
    expect(buildVenuePatch(venue, venueFormFrom(venue))).toEqual({ patch: {} });
  });

  it('sends only the dirty fields, trimmed, blanks as null', () => {
    const form = { ...venueFormFrom(venue), name: '  Café Neuf ', address: '  ', zone: 'Lac 2' };
    expect(buildVenuePatch(venue, form)).toEqual({
      patch: { name: 'Café Neuf', address: null, zone: 'Lac 2' },
    });
  });

  it('accepts a comma decimal and refuses a half or out-of-range position', () => {
    expect(parseCoordinate('36,85')).toBe(36.85);
    expect(parseCoordinate('abc')).toBeUndefined();
    expect(buildVenuePatch(venue, { ...venueFormFrom(venue), latitude: '36,85' })).toEqual({
      patch: { latitude: 36.85 },
    });
    const half = buildVenuePatch(venue, { ...venueFormFrom(venue), longitude: '' });
    expect('errors' in half && half.errors.longitude).toBeTruthy();
    const far = buildVenuePatch(venue, { ...venueFormFrom(venue), latitude: '95' });
    expect('errors' in far && far.errors.latitude).toBeTruthy();
  });

  it('refuses an empty name and a bad postal code', () => {
    const draft = buildVenuePatch(venue, { ...venueFormFrom(venue), name: ' ', postal_code: '12' });
    expect('errors' in draft && Object.keys(draft.errors).sort()).toEqual(['name', 'postal_code']);
  });
});

describe('HOST-EDIT1 owner form', () => {
  it('normalises the matricule and the phone, and sends only what moved', () => {
    const form = {
      ...ownerFormFrom(owner),
      tax_number: '1234567/a/m/m/000',
      contact_phone: '+216 12 345 678',
    };
    expect(buildOwnerPatch(owner, form)).toEqual({ patch: { tax_number: '1234567AMM000' } });
  });

  it('a required field that is set cannot be blanked; one that was never set stays absent', () => {
    const blanked = buildOwnerPatch(owner, { ...ownerFormFrom(owner), business_name: '' });
    expect('errors' in blanked && blanked.errors.business_name).toBeTruthy();
    // street_address was null and stays blank → not sent.
    expect(buildOwnerPatch(owner, { ...ownerFormFrom(owner), fonction: 'Gérant' })).toEqual({
      patch: { fonction: 'Gérant' },
    });
  });

  it('refuses a bad matricule and a non-E.164 phone', () => {
    const draft = buildOwnerPatch(owner, {
      ...ownerFormFrom(owner),
      tax_number: '123',
      contact_phone: '12345',
    });
    expect('errors' in draft && Object.keys(draft.errors).sort()).toEqual([
      'contact_phone',
      'tax_number',
    ]);
  });

  it('maps a taken matricule from the server', () => {
    expect(
      mapServerFieldErrors([{ field: 'tax_number', reason: 'already registered' }], ['tax_number']),
    ).toEqual({ tax_number: 'Ce matricule est déjà utilisé par un autre compte.' });
  });
});

describe('HOST-EDIT1 trail rendering', () => {
  const names = { governorates: new Map([['g1', 'Tunis']]), sectors: new Map<string, string>() };

  it('labels the fields and resolves names', () => {
    expect(
      historyChanges(
        {
          section: 'venue',
          before: { name: 'A', governorate_id: null },
          after: { name: 'B', governorate_id: 'g1' },
        },
        names,
      ),
    ).toEqual([
      { label: 'Nom', before: 'A', after: 'B' },
      { label: 'Gouvernorat', before: '—', after: 'Tunis' },
    ]);
  });

  it('reads an unavailability row as the day', () => {
    expect(
      historyChanges(
        {
          section: 'unavailability',
          before: { '2026-11-02': false },
          after: { '2026-11-02': true },
        },
        names,
      ),
    ).toEqual([{ label: 'Jour du 02/11/2026', before: 'Disponible', after: 'Indisponible' }]);
  });
});
