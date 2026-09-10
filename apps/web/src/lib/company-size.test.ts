import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COMPANY_SIZE_OPTIONS,
  PARC_COUNT_OPTIONS,
  companySizeLabel,
  companySizeOptions,
} from './company-size';

// SIZE-MISM1 (Mejri 07/09) — signup and Paramètres render the same stored `company_size`.
// They used to hard-code DISJOINT sets, so « 50 - 100 » chosen at signup matched no <option>
// in Settings and the select showed its empty placeholder. These are source-scan pins (the
// money-sweep idiom): apps/web has no render harness, so the rule is pinned by reading the
// two .tsx sources. Comments are stripped first — a comment naming a dead literal must not
// satisfy (or trip) the pin.

const WEB_SRC = join(__dirname, '..');
const SIGNUP_FORM = join(WEB_SRC, 'features', 'auth', 'components', 'SignUpForm.tsx');
const PROFILE_SETTINGS = join(WEB_SRC, 'features', 'profile', 'components', 'ProfileSettings.tsx');

/** Strip block + line comments so prose about the rule can't satisfy a pin. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sourceOf = (file: string): string => stripComments(readFileSync(file, 'utf8'));

// The scale Settings used to hard-code. Disjoint from every value signup can write, which is
// precisely the defect; none of them may reappear in either surface.
const ORPHANED_SETTINGS_OPTIONS = ['1-5', '6-10', '11-50', '51-200', '200+'];

describe('the company_size scale', () => {
  it('offers the advertiser employee bands and the owner a parc count', () => {
    expect(companySizeOptions('company')).toEqual(COMPANY_SIZE_OPTIONS);
    expect(companySizeOptions('parc')).toEqual(PARC_COUNT_OPTIONS);
    expect(COMPANY_SIZE_OPTIONS).toContain('50 - 100');
  });

  it('labels a parc count as a parc count, not as a company size', () => {
    expect(companySizeLabel('company')).toBe("Taille de l'entreprise");
    expect(companySizeLabel('parc')).toBe("Nombre d'établissements de votre parc");
  });

  it('the two scales never collide, so a stored value reads unambiguously', () => {
    const overlap = COMPANY_SIZE_OPTIONS.filter((v) => PARC_COUNT_OPTIONS.includes(v));
    expect(overlap).toEqual([]);
  });
});

describe('the signup ↔ Paramètres pin (SIZE-MISM1)', () => {
  it('Paramètres no longer hard-codes the orphaned scale', () => {
    const src = sourceOf(PROFILE_SETTINGS);
    const survivors = ORPHANED_SETTINGS_OPTIONS.filter((v) => src.includes(`"${v}"`));
    expect(survivors).toEqual([]);
  });

  it('neither surface declares its own option list', () => {
    for (const file of [SIGNUP_FORM, PROFILE_SETTINGS]) {
      const src = sourceOf(file);
      expect(src).not.toMatch(/const\s+COMPANY_SIZE_OPTIONS\s*=/);
      expect(src).not.toMatch(/const\s+parcCountOptions\s*=/);
    }
  });

  it('both surfaces read the scale from this module', () => {
    for (const file of [SIGNUP_FORM, PROFILE_SETTINGS]) {
      expect(sourceOf(file)).toContain("from '@/lib/company-size'");
    }
  });
});
