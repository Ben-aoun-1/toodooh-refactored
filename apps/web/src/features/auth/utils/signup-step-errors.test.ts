import { describe, expect, it } from 'vitest';

import { AGENT_CODE_ERROR } from './agent-code';
import { PHONE_FORMAT_ERROR } from './phone';
import {
  EMAIL_FORMAT_ERROR,
  FLEET_MIN_ERROR,
  HOURS_WINDOW_ERROR,
  PASSWORD_MATCH_ERROR,
  PASSWORD_POLICY_ERROR,
  POSTAL_CODE_ERROR,
  PROFILE_REQUIRED_ERROR,
  REQUIRED_FIELD_ERROR,
  TAX_NUMBER_ERROR,
  stepFieldErrors,
  type StepErrorCtx,
} from './signup-step-errors';

// The always-clickable Suivant's error matrix — mirrors the old canGoNext() gate EXACTLY
// (empty map ⟺ the old gate was satisfied), but names WHICH condition failed, in French.

const baseCtx = (over: Partial<StepErrorCtx> = {}): StepErrorCtx => ({
  profileType: 'advertiser',
  lastName: 'Ben Salah',
  firstName: 'Amine',
  fonction: 'Gérant',
  email: 'amine@societe.tn',
  phone: '+21622333444',
  agentCode: 'SC123456',
  password: 'Motdepasse1',
  confirmPassword: 'Motdepasse1',
  etablissementName: 'Café Central',
  taxNumber: '1234567A',
  businessSectorId: 'sector-1',
  etablissementScreens: '2',
  etablissementRooms: '3',
  hoursLater: false,
  hoursValid: true,
  businessName: 'Société Horizon',
  companySize: '0 - 10',
  streetAddress: '12 rue de Carthage',
  city: 'Tunis',
  zone: 'Lafayette',
  postalCode: '1002',
  governorateId: 'gov-1',
  fleetCount: 1,
  ...over,
});

describe('step 0 — profil', () => {
  it('no profile → the profile message; picked → clean', () => {
    expect(stepFieldErrors(0, baseCtx({ profileType: null }))).toEqual({
      profile: PROFILE_REQUIRED_ERROR,
    });
    expect(stepFieldErrors(0, baseCtx())).toEqual({});
  });
});

describe('step 1 — responsable', () => {
  it('a fully valid identity is clean', () => {
    expect(stepFieldErrors(1, baseCtx())).toEqual({});
  });

  it('every unsatisfied condition names its field', () => {
    const errors = stepFieldErrors(
      1,
      baseCtx({
        lastName: ' ',
        firstName: '',
        fonction: '',
        email: 'pas-un-email',
        phone: '22-333-44', // 7 digits — a REAL stuck-gate input
        agentCode: '',
        password: 'court',
        confirmPassword: 'autre',
      }),
    );
    expect(errors).toEqual({
      lastName: REQUIRED_FIELD_ERROR,
      firstName: REQUIRED_FIELD_ERROR,
      fonction: REQUIRED_FIELD_ERROR,
      email: EMAIL_FORMAT_ERROR,
      phone: PHONE_FORMAT_ERROR,
      agentCode: REQUIRED_FIELD_ERROR,
      password: PASSWORD_POLICY_ERROR,
    });
  });

  it('phone accepts every real-world spelling (the normalization layer feeds the gate)', () => {
    for (const phone of ['22 333 444', '22-333-444', '00216 22 333 444', '216 22 333 444']) {
      expect(stepFieldErrors(1, baseCtx({ phone }))).toEqual({});
    }
  });

  it('a malformed agent code carries the agent-code message', () => {
    expect(stepFieldErrors(1, baseCtx({ agentCode: '12 34' }))['agentCode']).toBe(AGENT_CODE_ERROR);
  });

  it('a valid password with a mismatched confirm names confirmPassword', () => {
    expect(stepFieldErrors(1, baseCtx({ confirmPassword: 'Autremotdepasse1' }))).toEqual({
      confirmPassword: PASSWORD_MATCH_ERROR,
    });
  });
});

describe('step 2 — individual_owner établissement', () => {
  const ownerCtx = (over: Partial<StepErrorCtx> = {}) =>
    baseCtx({ profileType: 'individual_owner', ...over });

  it('a complete établissement is clean', () => {
    expect(stepFieldErrors(2, ownerCtx())).toEqual({});
  });

  it('missing/invalid fields name themselves (tax format, hours window)', () => {
    const errors = stepFieldErrors(
      2,
      ownerCtx({
        etablissementName: '',
        taxNumber: 'AB',
        businessSectorId: '',
        etablissementScreens: '',
        etablissementRooms: '',
        hoursValid: false,
      }),
    );
    expect(errors).toEqual({
      etablissementName: REQUIRED_FIELD_ERROR,
      taxNumber: TAX_NUMBER_ERROR,
      businessSector: REQUIRED_FIELD_ERROR,
      screens: REQUIRED_FIELD_ERROR,
      rooms: REQUIRED_FIELD_ERROR,
      hours: HOURS_WINDOW_ERROR,
    });
  });

  it('« Préciser plus tard » bypasses the hours window (H1 untouched)', () => {
    expect(stepFieldErrors(2, ownerCtx({ hoursLater: true, hoursValid: false }))).toEqual({});
  });
});

describe('step 2 — entreprise (advertiser / agency / fleet)', () => {
  it('advertiser: complete is clean; agency skips the sector', () => {
    expect(stepFieldErrors(2, baseCtx())).toEqual({});
    expect(stepFieldErrors(2, baseCtx({ profileType: 'agency', businessSectorId: '' }))).toEqual(
      {},
    );
  });

  it('advertiser without a sector is held; fleet_owner postal is format-gated', () => {
    expect(stepFieldErrors(2, baseCtx({ businessSectorId: '' }))['businessSector']).toBe(
      REQUIRED_FIELD_ERROR,
    );
    expect(
      stepFieldErrors(2, baseCtx({ profileType: 'fleet_owner', postalCode: '12' }))['postalCode'],
    ).toBe(POSTAL_CODE_ERROR);
    expect(stepFieldErrors(2, baseCtx({ postalCode: '12' }))).toEqual({}); // advertiser: no postal gate here
  });
});

describe('step 3 — adresse / parc', () => {
  it('fleet_owner needs at least one établissement', () => {
    expect(stepFieldErrors(3, baseCtx({ profileType: 'fleet_owner', fleetCount: 0 }))).toEqual({
      fleet: FLEET_MIN_ERROR,
    });
    expect(stepFieldErrors(3, baseCtx({ profileType: 'fleet_owner', fleetCount: 2 }))).toEqual({});
  });

  it('individual_owner address gate (zone included); advertiser gate has no zone', () => {
    const owner = stepFieldErrors(
      3,
      baseCtx({ profileType: 'individual_owner', zone: '', postalCode: '' }),
    );
    expect(owner['zone']).toBe(REQUIRED_FIELD_ERROR);
    expect(owner['postalCode']).toBe(POSTAL_CODE_ERROR);
    const adv = stepFieldErrors(3, baseCtx({ zone: '' }));
    expect(adv).toEqual({}); // advertiser step 3 never gated on zone
  });
});

describe('step 4 — submit owns its own gate', () => {
  it('always empty', () => {
    expect(stepFieldErrors(4, baseCtx({ profileType: null }))).toEqual({});
  });
});
