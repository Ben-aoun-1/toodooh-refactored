import { describe, expect, it } from 'vitest';

import { IBAN_ERROR, RIB_ERROR, isValidIban, isValidRib } from './bank-validation';
import {
  PAYOUT_DOC_PREVIEW_CLASS,
  PAYOUT_DOC_PREVIEW_MIN_HEIGHT_PX,
  payoutMethodIsRecorded,
} from './payout-method';

// REV1 — the « Mes Revenus » consultation popup. apps/web has no page-render harness, so the two
// decisions the popup makes are extracted into pure functions and pinned here.

describe('payoutMethodIsRecorded — both coordinates, or none', () => {
  it('is recorded only when RIB and IBAN are both present', () => {
    expect(payoutMethodIsRecorded('1'.repeat(20), `TN${'2'.repeat(22)}`)).toBe(true);
  });

  it('treats a HALF-filled account as absent — it cannot receive money', () => {
    // Showing a partial mode would tell the owner they are set up when they are not.
    expect(payoutMethodIsRecorded('1'.repeat(20), '')).toBe(false);
    expect(payoutMethodIsRecorded('', `TN${'2'.repeat(22)}`)).toBe(false);
  });

  it('treats null, undefined and whitespace-only as absent (the profile stores free text)', () => {
    expect(payoutMethodIsRecorded(null, null)).toBe(false);
    expect(payoutMethodIsRecorded(undefined, undefined)).toBe(false);
    expect(payoutMethodIsRecorded('   ', '   ')).toBe(false);
    expect(payoutMethodIsRecorded('1'.repeat(20), '   ')).toBe(false);
  });

  it('does not validate FORMAT — that is the validators’ job, not the popup’s', () => {
    // The popup asks "is something on file?", not "is it well-formed?". A legacy row predating the
    // format ruling must still render as a recorded mode rather than vanish into the empty state.
    expect(payoutMethodIsRecorded('legacy-value', 'legacy-value')).toBe(true);
  });
});

describe('the identity-document preview is READABLE, not a thumbnail', () => {
  it('is full-width and tall enough to read without downloading', () => {
    // The spec: « affiché en aperçu dans une taille suffisamment grande pour être lisible sans
    // avoir à le télécharger (pas une simple vignette miniscule) ».
    expect(PAYOUT_DOC_PREVIEW_CLASS).toContain('w-full');
    const height = /h-\[(\d+)px\]/.exec(PAYOUT_DOC_PREVIEW_CLASS);
    expect(height).not.toBeNull();
    expect(Number(height?.[1])).toBeGreaterThanOrEqual(PAYOUT_DOC_PREVIEW_MIN_HEIGHT_PX);
  });

  it('carries no thumbnail-sized utility class', () => {
    // Shrinking it back to a vignette has to fail a test, not pass silently.
    for (const thumbnail of ['h-8', 'h-10', 'h-12', 'h-16', 'h-20', 'h-24', 'w-16', 'w-24']) {
      expect(PAYOUT_DOC_PREVIEW_CLASS.split(' ')).not.toContain(thumbnail);
    }
  });
});

// The web validators are a MIRROR of the api's. REV1 gave the api one home (lib/bank-validation.ts)
// and pinned its matrix; this is the same matrix run against the client copy, so the two cannot
// drift apart silently — they previously agreed by luck rather than by construction.
describe('validator parity with the api matrix', () => {
  it('RIB: 20 digits accepted; 19 and 21 rejected; a letter rejected', () => {
    expect(isValidRib('1'.repeat(20))).toBe(true);
    expect(isValidRib('1'.repeat(19))).toBe(false);
    expect(isValidRib('1'.repeat(21))).toBe(false);
    expect(isValidRib(`${'1'.repeat(19)}A`)).toBe(false);
    expect(isValidRib('')).toBe(false);
  });

  it('IBAN: TN + 22 digits accepted; TN+21/23 rejected; lowercase tn rejected', () => {
    expect(isValidIban(`TN${'2'.repeat(22)}`)).toBe(true);
    expect(isValidIban(`TN${'2'.repeat(21)}`)).toBe(false);
    expect(isValidIban(`TN${'2'.repeat(23)}`)).toBe(false);
    expect(isValidIban(`tn${'2'.repeat(22)}`)).toBe(false);
  });

  it('IBAN: no LETTER after the prefix', () => {
    expect(isValidIban(`TNA${'2'.repeat(21)}`)).toBe(false);
    expect(isValidIban(`TN${'2'.repeat(21)}B`)).toBe(false);
  });

  it('mirrors the api’s two V1 decisions exactly', () => {
    // Check digits are not arithmetically verified…
    expect(isValidIban(`TN00${'0'.repeat(20)}`)).toBe(true);
    // …and the IBAN tail need not match the RIB.
    expect(isValidRib('0'.repeat(20))).toBe(true);
    expect(isValidIban(`TN59${'7'.repeat(20)}`)).toBe(true);
  });

  it('carries the same French messages the api returns', () => {
    expect(RIB_ERROR).toBe('RIB invalide (exactement 20 chiffres).');
    expect(IBAN_ERROR).toBe('IBAN invalide (TN suivi de 22 chiffres).');
  });
});
