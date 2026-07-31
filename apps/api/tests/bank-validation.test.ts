import { describe, expect, it } from 'vitest';

import {
  IBAN_ERROR,
  IBAN_LENGTH,
  RIB_ERROR,
  RIB_LENGTH,
  validateIbanTn,
  validateRib,
} from '../src/lib/bank-validation.js';

// REV1 — the ruled matrix for the Tunisian payout coordinates, pinned in the ONE api home.
// Before this lane the regexes lived inline in routes/profile.ts and were independently
// duplicated in the web bundle; they agreed by luck rather than by construction.

const D20 = '1'.repeat(20);
const D22 = '2'.repeat(22);

describe('validateRib — exactly 20 digits', () => {
  it('accepts exactly 20 digits', () => {
    expect(validateRib(D20)).toBe(true);
    expect(validateRib('07098050014527001379')).toBe(true);
    expect(RIB_LENGTH).toBe(20);
  });

  it('rejects 19 and 21 digits — the boundary is exact on both sides', () => {
    expect(validateRib('1'.repeat(19))).toBe(false);
    expect(validateRib('1'.repeat(21))).toBe(false);
  });

  it('rejects a letter anywhere inside an otherwise 20-char value', () => {
    expect(validateRib(`${'1'.repeat(19)}A`)).toBe(false);
    expect(validateRib(`A${'1'.repeat(19)}`)).toBe(false);
    expect(validateRib(`${'1'.repeat(10)}X${'1'.repeat(9)}`)).toBe(false);
  });

  it('rejects separators and padding — 20 DIGITS, not 20 characters', () => {
    // A grouped RIB is how a bank statement prints it; the client normalizes before submitting,
    // so the server sees digits only. Spaces reaching here mean the normalization was skipped.
    expect(validateRib('07098 05001 45270 01379')).toBe(false);
    expect(validateRib(` ${D20}`)).toBe(false);
    expect(validateRib(`${D20} `)).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(validateRib('')).toBe(false);
  });

  it('carries a French message', () => {
    expect(RIB_ERROR).toBe('RIB invalide (exactement 20 chiffres).');
  });
});

describe('validateIbanTn — exactly 24 chars: TN + 22 digits', () => {
  it('accepts TN followed by exactly 22 digits', () => {
    expect(validateIbanTn(`TN${D22}`)).toBe(true);
    expect(`TN${D22}`).toHaveLength(24);
    expect(IBAN_LENGTH).toBe(24);
  });

  it('rejects TN + 21 and TN + 23 digits', () => {
    expect(validateIbanTn(`TN${'2'.repeat(21)}`)).toBe(false);
    expect(validateIbanTn(`TN${'2'.repeat(23)}`)).toBe(false);
  });

  it('rejects a lowercase or mixed-case prefix — the literal is uppercase TN', () => {
    expect(validateIbanTn(`tn${D22}`)).toBe(false);
    expect(validateIbanTn(`Tn${D22}`)).toBe(false);
    expect(validateIbanTn(`tN${D22}`)).toBe(false);
  });

  it('rejects any LETTER after the prefix — the spec forbids one explicitly', () => {
    expect(validateIbanTn(`TNA${'2'.repeat(21)}`)).toBe(false);
    expect(validateIbanTn(`TN${'2'.repeat(21)}B`)).toBe(false);
    expect(validateIbanTn(`TN${'2'.repeat(10)}X${'2'.repeat(11)}`)).toBe(false);
  });

  it('rejects a non-TN country prefix', () => {
    expect(validateIbanTn(`FR${D22}`)).toBe(false);
  });

  it('rejects the empty string and a bare prefix', () => {
    expect(validateIbanTn('')).toBe(false);
    expect(validateIbanTn('TN')).toBe(false);
  });

  it('carries a French message', () => {
    expect(IBAN_ERROR).toBe('IBAN invalide (TN suivi de 22 chiffres).');
  });
});

describe('the two V1 decisions, pinned deliberately', () => {
  it('ACCEPTS structurally valid check digits that are arithmetically wrong (no mod-97 in V1)', () => {
    // '00' and '99' are both structurally fine; neither is verified against the account body.
    // Pinned so a future ISO 7064 pass is a DELIBERATE change with a failing test, not a surprise.
    expect(validateIbanTn(`TN00${D20}`)).toBe(true);
    expect(validateIbanTn(`TN99${D20}`)).toBe(true);
  });

  it('ACCEPTS an IBAN whose 20-digit tail does NOT match the RIB (no cross-consistency in V1)', () => {
    // A conforming Tunisian pair embeds the RIB in the IBAN, but the spec does not require the
    // check and rejecting a mismatch would be inventing a rule. Both validate independently.
    const rib = '0'.repeat(20);
    const ibanWithDifferentTail = `TN59${'7'.repeat(20)}`;
    expect(validateRib(rib)).toBe(true);
    expect(validateIbanTn(ibanWithDifferentTail)).toBe(true);
    expect(ibanWithDifferentTail.slice(4)).not.toBe(rib);
  });
});
