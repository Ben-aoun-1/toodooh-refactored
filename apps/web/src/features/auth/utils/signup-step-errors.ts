import { isValidAgentCode, AGENT_CODE_ERROR } from '@/features/auth/utils/agent-code';
import { isValidPassword } from '@/features/auth/utils/password';
import { PHONE_FORMAT_ERROR, isValidTunisiaPhone } from '@/features/auth/utils/phone';

import { TAX_NUMBER_ERROR, normalizeTaxNumber, validateTaxNumber } from './tax-number';

/**
 * Per-step, per-field gate messages for the signup wizard (prod-blocker lane). Mirrors the old
 * `canGoNext()` conditions EXACTLY — same fields, same validators, per profile type — but returns
 * WHICH condition failed, in French, keyed by field. The Suivant button is always clickable;
 * clicking with an unsatisfied gate surfaces these inline instead of the silent gray, which also
 * self-diagnoses any residual device variance (a stuck field names itself).
 *
 * FORMAT/PRESENCE only — the async availability layer (email taken, matricule taken) keeps its
 * own dedicated states and runs after this map comes back empty (ruling 2026-06-10: format first,
 * availability second).
 */

export type SignupProfileType = 'advertiser' | 'agency' | 'individual_owner' | 'fleet_owner';

/** field key → French message; empty object = the step's gate is satisfied. */
export type StepErrors = Record<string, string>;

export const REQUIRED_FIELD_ERROR = 'Ce champ est requis.';
export const PROFILE_REQUIRED_ERROR = 'Sélectionnez un profil pour continuer.';
export const EMAIL_FORMAT_ERROR = 'Format email invalide';
export const PASSWORD_POLICY_ERROR =
  'Mot de passe invalide — 10 caractères minimum, avec majuscule, minuscule et chiffre.';
export const PASSWORD_MATCH_ERROR = 'Les mots de passe ne correspondent pas.';
export const HOURS_WINDOW_ERROR = "Horaires invalides — la fermeture doit être après l'ouverture.";
export const FLEET_MIN_ERROR = 'Ajoutez au moins un établissement pour continuer.';
// Moved verbatim from SignUpForm (C5 #8a) — the backend matricule/postal mirrors keep one home.
// SIGN-3 — the matricule definition now lives in ONE place (`./tax-number`, byte-mirrored from
// the api and pinned by a cross-package test); these re-exports keep every existing consumer
// working without a second copy of the rule.
export { TAX_NUMBER_ERROR, normalizeTaxNumber };
export const POSTAL_CODE_ERROR = 'Code postal invalide (4 chiffres).';

export const isValidTaxNumber = (value: string): boolean => validateTaxNumber(value);
export const isValidPostalCode = (value: string): boolean => /^\d{4}$/.test(value);
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StepErrorCtx {
  profileType: SignupProfileType | null;
  // step 1 — responsable
  lastName: string;
  firstName: string;
  fonction: string;
  email: string;
  phone: string;
  agentCode: string;
  password: string;
  confirmPassword: string;
  // step 2 — établissement / entreprise
  etablissementName: string;
  taxNumber: string;
  businessSectorId: string;
  etablissementScreens: string;
  etablissementRooms: string;
  hoursLater: boolean;
  hoursValid: boolean;
  businessName: string;
  companySize: string;
  streetAddress: string;
  city: string;
  zone: string;
  postalCode: string;
  governorateId: string;
  // step 3 — adresse / parc
  fleetCount: number;
}

const requireText = (errors: StepErrors, key: string, value: string): void => {
  if (!value.trim()) errors[key] = REQUIRED_FIELD_ERROR;
};

export const stepFieldErrors = (step: number, ctx: StepErrorCtx): StepErrors => {
  const errors: StepErrors = {};

  if (step === 0) {
    if (!ctx.profileType) errors['profile'] = PROFILE_REQUIRED_ERROR;
    return errors;
  }

  if (step === 1) {
    requireText(errors, 'lastName', ctx.lastName);
    requireText(errors, 'firstName', ctx.firstName);
    requireText(errors, 'fonction', ctx.fonction);
    if (!ctx.agentCode.trim()) errors['agentCode'] = REQUIRED_FIELD_ERROR;
    else if (!isValidAgentCode(ctx.agentCode.trim())) errors['agentCode'] = AGENT_CODE_ERROR;
    if (!ctx.email.trim() || !EMAIL_REGEX.test(ctx.email.trim())) {
      errors['email'] = EMAIL_FORMAT_ERROR;
    }
    if (!isValidTunisiaPhone(ctx.phone)) errors['phone'] = PHONE_FORMAT_ERROR;
    if (!ctx.password || !isValidPassword(ctx.password)) {
      errors['password'] = PASSWORD_POLICY_ERROR;
    } else if (ctx.password !== ctx.confirmPassword) {
      errors['confirmPassword'] = PASSWORD_MATCH_ERROR;
    }
    return errors;
  }

  if (step === 2) {
    if (ctx.profileType === 'individual_owner') {
      requireText(errors, 'etablissementName', ctx.etablissementName);
      if (!ctx.taxNumber.trim()) errors['taxNumber'] = REQUIRED_FIELD_ERROR;
      else if (!isValidTaxNumber(ctx.taxNumber)) errors['taxNumber'] = TAX_NUMBER_ERROR;
      if (!ctx.businessSectorId) errors['businessSector'] = REQUIRED_FIELD_ERROR;
      if (!ctx.etablissementScreens) errors['screens'] = REQUIRED_FIELD_ERROR;
      requireText(errors, 'rooms', ctx.etablissementRooms);
      // H1 — the hour selects only misvalidate on fermeture ≤ ouverture; « plus tard » bypasses.
      if (!ctx.hoursLater && !ctx.hoursValid) errors['hours'] = HOURS_WINDOW_ERROR;
      return errors;
    }
    requireText(errors, 'businessName', ctx.businessName);
    if (!ctx.taxNumber.trim()) errors['taxNumber'] = REQUIRED_FIELD_ERROR;
    else if (!isValidTaxNumber(ctx.taxNumber)) errors['taxNumber'] = TAX_NUMBER_ERROR;
    if (ctx.profileType !== 'agency' && !ctx.businessSectorId) {
      errors['businessSector'] = REQUIRED_FIELD_ERROR;
    }
    if (!ctx.companySize) errors['companySize'] = REQUIRED_FIELD_ERROR;
    // SIGN-DUP1 — step 2 is company identity only; the address moved to the « Adresse » step,
    // which used to ask for it a SECOND time off the same formData keys. A fleet_owner is the
    // exception: its step 3 is the parc list, never renderStep3, so step 2 is the only address
    // it is ever asked for and its gate stays here, unchanged.
    if (ctx.profileType === 'fleet_owner') {
      requireText(errors, 'streetAddress', ctx.streetAddress);
      requireText(errors, 'city', ctx.city);
      requireText(errors, 'zone', ctx.zone);
      if (!isValidPostalCode(ctx.postalCode.trim())) errors['postalCode'] = POSTAL_CODE_ERROR;
      if (!ctx.governorateId) errors['governorate'] = REQUIRED_FIELD_ERROR;
    }
    return errors;
  }

  if (step === 3) {
    if (ctx.profileType === 'fleet_owner') {
      if (ctx.fleetCount < 1) errors['fleet'] = FLEET_MIN_ERROR;
      return errors;
    }
    if (ctx.profileType === 'individual_owner') {
      requireText(errors, 'streetAddress', ctx.streetAddress);
      requireText(errors, 'city', ctx.city);
      if (!isValidPostalCode(ctx.postalCode.trim())) errors['postalCode'] = POSTAL_CODE_ERROR;
      requireText(errors, 'zone', ctx.zone);
      if (!ctx.governorateId) errors['governorate'] = REQUIRED_FIELD_ERROR;
      return errors;
    }
    // advertiser / agency — the ONLY address gate for these profiles now (SIGN-DUP1). Zone joins
    // it here: it used to be gated on step 2, so gating it nowhere would let it through empty.
    requireText(errors, 'streetAddress', ctx.streetAddress);
    requireText(errors, 'city', ctx.city);
    if (!isValidPostalCode(ctx.postalCode.trim())) errors['postalCode'] = POSTAL_CODE_ERROR;
    requireText(errors, 'zone', ctx.zone);
    if (!ctx.governorateId) errors['governorate'] = REQUIRED_FIELD_ERROR;
    return errors;
  }

  return errors; // step 4 — the submit button owns its own gate (terms + certification)
};
