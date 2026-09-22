import { describe, expect, it } from 'vitest';

import { DECLARED_COUNT_ERROR } from '@/lib/screen-declaration';

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
  taxNumber: '1234567AMM000', // SIGN-3 canonical: 7 digits + 3 letters + 3 digits
  businessSectorId: 'sector-1',
  etablissementScreens: '2',
  etablissementRooms: '3',
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

  it('SCR-DECL1: the screen and room counts are exact whole numbers from 1 to 99', () => {
    for (const bad of ['0', '100', '2.5', '6-10', '10+', 'deux']) {
      expect(
        stepFieldErrors(2, ownerCtx({ etablissementScreens: bad, etablissementRooms: bad })),
      ).toEqual({ screens: DECLARED_COUNT_ERROR, rooms: DECLARED_COUNT_ERROR });
    }
    expect(
      stepFieldErrors(2, ownerCtx({ etablissementScreens: '12', etablissementRooms: '1' })),
    ).toEqual({});
  });

  it('HOURS-M1: the hours window is always required — the former « préciser plus tard » bypass is gone', () => {
    expect(stepFieldErrors(2, ownerCtx({ hoursValid: false }))).toEqual({
      hours: HOURS_WINDOW_ERROR,
    });
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

  it('individual_owner AND advertiser both gate zone on step 3 (moved by SIGN-DUP1)', () => {
    const owner = stepFieldErrors(
      3,
      baseCtx({ profileType: 'individual_owner', zone: '', postalCode: '' }),
    );
    expect(owner['zone']).toBe(REQUIRED_FIELD_ERROR);
    expect(owner['postalCode']).toBe(POSTAL_CODE_ERROR);
    // SIGN-DUP1 — this line used to assert `{}`, pinning the pre-move gate where the advertiser's
    // Zone lived on step 2. The field moved to step 3 with the rest of the address, so its gate
    // moved with it; leaving the old assertion would have pinned the duplicate in place.
    expect(stepFieldErrors(3, baseCtx({ zone: '' }))).toEqual({ zone: REQUIRED_FIELD_ERROR });
  });
});

describe('step 4 — submit owns its own gate', () => {
  it('always empty', () => {
    expect(stepFieldErrors(4, baseCtx({ profileType: null }))).toEqual({});
  });
});

// ── SIGN-DUP1 (Mejri 07/09) ───────────────────────────────────────────────────────────────────
// Signup asked for Adresse/Ville/Gouvernorat on step 2 « Entreprise », then AGAIN on step 3
// « Adresse » — both steps bound the same formData keys, so step 3 arrived pre-filled and the only
// genuinely new field was Code postal. The address is now asked once. The trap: a fleet_owner's
// step 3 is the parc list (renderEtablissement), never renderStep3, so step 2 is the ONLY address
// it is ever asked for and its gate must stay exactly where it was.

const ADDRESS_ERROR_KEYS = ['streetAddress', 'city', 'zone', 'postalCode', 'governorate'];

/** Which address fields `step` complains about when the whole address is blank. */
const addressKeysGatedOn = (step: number, profileType: StepErrorCtx['profileType']): string[] => {
  const blank = baseCtx({
    profileType,
    streetAddress: '',
    city: '',
    zone: '',
    postalCode: '',
    governorateId: '',
  });
  const errors = stepFieldErrors(step, blank);
  return ADDRESS_ERROR_KEYS.filter((key) => key in errors);
};

describe('SIGN-DUP1 — the address is asked exactly once', () => {
  it('an advertiser gives it on « Adresse » (step 3), never on « Entreprise » (step 2)', () => {
    expect(addressKeysGatedOn(2, 'advertiser')).toEqual([]);
    expect(addressKeysGatedOn(3, 'advertiser')).toEqual(ADDRESS_ERROR_KEYS);
  });

  it('an agency likewise', () => {
    expect(addressKeysGatedOn(2, 'agency')).toEqual([]);
    expect(addressKeysGatedOn(3, 'agency')).toEqual(ADDRESS_ERROR_KEYS);
  });

  it('an individual_owner likewise — its step 2 is the établissement form', () => {
    expect(addressKeysGatedOn(2, 'individual_owner')).toEqual([]);
    expect(addressKeysGatedOn(3, 'individual_owner')).toEqual(ADDRESS_ERROR_KEYS);
  });

  it('a fleet_owner still gives it on step 2 — its step 3 is the parc, not an address', () => {
    expect(addressKeysGatedOn(2, 'fleet_owner')).toEqual(ADDRESS_ERROR_KEYS);
    expect(addressKeysGatedOn(3, 'fleet_owner')).toEqual([]);
  });

  it('no profile is ever asked for the same address field on two steps', () => {
    const profiles: StepErrorCtx['profileType'][] = [
      'advertiser',
      'agency',
      'individual_owner',
      'fleet_owner',
    ];
    for (const profileType of profiles) {
      const onStep2 = addressKeysGatedOn(2, profileType);
      const onStep3 = addressKeysGatedOn(3, profileType);
      expect(onStep2.filter((key) => onStep3.includes(key))).toEqual([]);
      // and it IS asked somewhere — dropping the block entirely would also pass a disjointness test
      expect([...onStep2, ...onStep3].sort()).toEqual([...ADDRESS_ERROR_KEYS].sort());
    }
  });

  it('Zone survives for the advertiser — the field it would have lost with a naive delete', () => {
    expect(stepFieldErrors(3, baseCtx({ profileType: 'advertiser', zone: '' }))).toEqual({
      zone: REQUIRED_FIELD_ERROR,
    });
    expect(stepFieldErrors(3, baseCtx({ profileType: 'advertiser' }))).toEqual({});
  });

  it("a fleet_owner's step-2 gate is otherwise untouched — identity fields still required", () => {
    expect(stepFieldErrors(2, baseCtx({ profileType: 'fleet_owner', businessName: '' }))).toEqual({
      businessName: REQUIRED_FIELD_ERROR,
    });
    expect(stepFieldErrors(2, baseCtx({ profileType: 'fleet_owner', postalCode: '12' }))).toEqual({
      postalCode: POSTAL_CODE_ERROR,
    });
  });
});
