import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// SIGN-DUP1 — the GATE move is pinned in signup-step-errors.test.ts; this pins the RENDER, which is
// what Mejri actually saw. Loosening the gates without moving the inputs would still show her the
// same fields twice. apps/web has no render harness, so the wizard's shape is read off the source.

const SIGNUP_FORM = join(__dirname, 'components', 'SignUpForm.tsx');

const stripComments = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const FLEET_GUARD = "{selectedProfileType === 'fleet_owner' && (";
/** The step-2 address inputs — the block that used to render for advertiser/agency too. */
const STEP2_ADDRESS_IDS = ['street-address', 'city', 'zone', 'postal-code', 'governorate-id'];

describe('SIGN-DUP1 — the signup address block', () => {
  const src = stripComments(readFileSync(SIGNUP_FORM, 'utf8'));

  it("step 2's address block renders only behind the fleet_owner guard", () => {
    const guard = src.indexOf(FLEET_GUARD);
    expect(guard).toBeGreaterThan(-1);
    for (const id of STEP2_ADDRESS_IDS) {
      const at = src.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(guard);
    }
  });

  it('each step-2 address id is declared exactly once — no third copy crept in', () => {
    for (const id of STEP2_ADDRESS_IDS) {
      expect(src.split(`id="${id}"`).length - 1).toBe(1);
    }
  });

  it('step 3 asks every profile for a Zone — a select for owners, a text input otherwise', () => {
    expect(src.split('id="zone-3"').length - 1).toBe(2);
    expect(src).toContain('{ownerZones.map(');
  });

  it('the « Adresse » step still owns the rest of the address', () => {
    for (const id of ['street-address-3', 'city-3', 'postal-code-2', 'governorate-id-3']) {
      expect(src.split(`id="${id}"`).length - 1).toBe(1);
    }
  });
});
