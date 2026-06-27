import { describe, expect, it } from 'vitest';

import { documentPresence } from '../src/lib/user-documents.js';

// ITEM 4 (Kais QA 2026-06-24) — the onboarding "Pour bien commencer / Complétez votre profil"
// done-state reads documents.cin, which is documentPresence's CIN flag. CIN counts COMPLETE only when
// BOTH semantic faces are on file — recto (position 1) AND verso (position 2) (Kais N5). A single face
// must read INCOMPLETE so a partial CIN is never shown as done. Owner documents being optional at
// signup makes this directly reachable: an owner can land with only one face on file.
describe('documentPresence — CIN both-faces completeness (N5, ITEM 4)', () => {
  it('one CIN face (recto only) → cin INCOMPLETE', () => {
    expect(documentPresence([{ category: 'cin', position: 1 }]).cin).toBe(false);
  });

  it('one CIN face (verso only) → cin INCOMPLETE', () => {
    expect(documentPresence([{ category: 'cin', position: 2 }]).cin).toBe(false);
  });

  it('both CIN faces (recto + verso) → cin COMPLETE', () => {
    expect(
      documentPresence([
        { category: 'cin', position: 1 },
        { category: 'cin', position: 2 },
      ]).cin,
    ).toBe(true);
  });

  it('no CIN rows → cin INCOMPLETE', () => {
    expect(documentPresence([]).cin).toBe(false);
  });

  it('registration (rne) and bank are present-if-any-row, independent of CIN', () => {
    const p = documentPresence([
      { category: 'rne', position: 1 },
      { category: 'bank', position: 1 },
    ]);
    expect(p.registration).toBe(true);
    expect(p.bank).toBe(true);
    expect(p.cin).toBe(false);
  });
});
