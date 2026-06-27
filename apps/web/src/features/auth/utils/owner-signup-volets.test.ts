import { describe, expect, it } from 'vitest';

import {
  emptyOwnerVolets,
  missingOwnerVolets,
  ownerVoletsComplete,
  type OwnerVoletFiles,
} from './owner-signup-volets';

const file = () => new File(['x'], 'doc.pdf', { type: 'application/pdf' });

// R7/N4 — client validation mirrors the C5 server: individual_owner needs CIN recto+verso + bank;
// fleet_owner needs RNE + bank; advertisers/agencies need nothing.
describe('owner signup volets validation', () => {
  it('individual_owner: needs both CIN faces + bank', () => {
    const both = (): OwnerVoletFiles => ({
      ...emptyOwnerVolets(),
      cinRecto: file(),
      cinVerso: file(),
    });
    expect(missingOwnerVolets('individual_owner', emptyOwnerVolets())).toEqual([
      'cin_recto',
      'cin_verso',
      'bank',
    ]);
    // missing verso (one CIN face) → flagged
    expect(
      missingOwnerVolets('individual_owner', { ...both(), cinVerso: null, bank: file() }),
    ).toEqual(['cin_verso']);
    // missing bank → flagged
    expect(missingOwnerVolets('individual_owner', both())).toEqual(['bank']);
    // complete
    expect(ownerVoletsComplete('individual_owner', { ...both(), bank: file() })).toBe(true);
  });

  it('fleet_owner: needs RNE + bank (not CIN)', () => {
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

// Kais QA 2026-06-24 — these helpers are now a NON-BLOCKING completeness signal: documents are OPTIONAL
// at signup. An incomplete/empty set is reported as such (drives an informational hint) but no longer
// blocks submit — the SignUpForm gate was removed (the "submit allows finishing without docs" path is
// component-level, build-verified). The completeness rule (both CIN faces + RIB) is unchanged.
describe('owner signup volets — completeness is a non-blocking signal (docs optional)', () => {
  it('no documents → reported incomplete (informational only; submit is still allowed)', () => {
    expect(ownerVoletsComplete('individual_owner', emptyOwnerVolets())).toBe(false);
    expect(missingOwnerVolets('individual_owner', emptyOwnerVolets())).toEqual([
      'cin_recto',
      'cin_verso',
      'bank',
    ]);
  });

  it('a partial set (only the CIN recto) → still incomplete, only the attached volet counts as provided', () => {
    const partial: OwnerVoletFiles = { ...emptyOwnerVolets(), cinRecto: file() };
    expect(missingOwnerVolets('individual_owner', partial)).toEqual(['cin_verso', 'bank']);
    expect(ownerVoletsComplete('individual_owner', partial)).toBe(false);
  });
});
