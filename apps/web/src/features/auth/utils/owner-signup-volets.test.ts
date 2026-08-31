import { describe, expect, it } from 'vitest';

import {
  emptyOwnerVolets,
  missingOwnerVolets,
  ownerVoletsComplete,
  type OwnerVoletFiles,
} from './owner-signup-volets';

const file = () => new File(['x'], 'doc.pdf', { type: 'application/pdf' });

// SIGN-2 (operator ruling 2026-08-31) — the CIN intake is REMOVED FROM SIGNUP. An individual owner
// is asked for the RIB only; fleet_owner still gives RNE + RIB; advertisers/agencies give nothing.
// CIN is not abolished — it becomes provide-later (admin request / post-signin upload), which lives
// on a different path entirely and is untouched by these helpers.
describe('owner signup volets validation', () => {
  it('individual_owner: the RIB is the only volet signup asks for', () => {
    expect(missingOwnerVolets('individual_owner', emptyOwnerVolets())).toEqual(['bank']);
    expect(missingOwnerVolets('individual_owner', { ...emptyOwnerVolets(), bank: file() })).toEqual(
      [],
    );
    expect(ownerVoletsComplete('individual_owner', { ...emptyOwnerVolets(), bank: file() })).toBe(
      true,
    );
  });

  it('individual_owner: an RNE is not asked for and never makes the set complete', () => {
    const rneOnly: OwnerVoletFiles = { ...emptyOwnerVolets(), rne: file() };
    expect(missingOwnerVolets('individual_owner', rneOnly)).toEqual(['bank']);
    expect(ownerVoletsComplete('individual_owner', rneOnly)).toBe(false);
  });

  it('fleet_owner: needs RNE + bank', () => {
    expect(missingOwnerVolets('fleet_owner', emptyOwnerVolets())).toEqual(['rne', 'bank']);
    expect(missingOwnerVolets('fleet_owner', { ...emptyOwnerVolets(), rne: file() })).toEqual([
      'bank',
    ]);
    expect(
      ownerVoletsComplete('fleet_owner', { ...emptyOwnerVolets(), rne: file(), bank: file() }),
    ).toBe(true);
  });

  it('advertiser / agency / undefined: no documents required', () => {
    expect(missingOwnerVolets('advertiser', emptyOwnerVolets())).toEqual([]);
    expect(missingOwnerVolets('agency', emptyOwnerVolets())).toEqual([]);
    expect(missingOwnerVolets(undefined, emptyOwnerVolets())).toEqual([]);
    expect(ownerVoletsComplete('advertiser', emptyOwnerVolets())).toBe(true);
  });
});

// Kais QA 2026-06-24 — these helpers are a NON-BLOCKING completeness signal: documents are OPTIONAL
// at signup. An incomplete/empty set is reported as such (drives an informational hint) but never
// blocks submit.
describe('owner signup volets — completeness is a non-blocking signal (docs optional)', () => {
  it('no documents → reported incomplete (informational only; submit is still allowed)', () => {
    expect(ownerVoletsComplete('individual_owner', emptyOwnerVolets())).toBe(false);
    expect(missingOwnerVolets('individual_owner', emptyOwnerVolets())).toEqual(['bank']);
    expect(ownerVoletsComplete('fleet_owner', emptyOwnerVolets())).toBe(false);
  });
});
