import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TAX_NUMBER_ERROR, normalizeTaxNumber, validateTaxNumber } from './tax-number';

// SIGN-3 (operator ruling 2026-08-31) — the matricule fiscal has ONE definition, and this file is
// where "one" is enforced: the api's copy is READ FROM DISK and compared byte for byte, so the two
// cannot drift. (The ev1-pins technique, applied across packages.)
const readShared = (path: string): string => {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const start = source.indexOf('// ── shared block');
  const end = source.indexOf('// ── end shared block ──');
  if (start === -1 || end === -1) throw new Error(`shared block markers missing in ${path}`);
  return source.slice(start, end);
};

describe('the matricule definition is ONE definition', () => {
  it('the api copy and the web copy are byte-identical', () => {
    expect(readShared('./tax-number.ts')).toBe(
      readShared('../../../../../api/src/validation/tax-number.ts'),
    );
  });
});

describe('normalizeTaxNumber — separators are optional, the canonical form is one string', () => {
  it('the three spellings of the same matricule normalise to one value', () => {
    expect(normalizeTaxNumber('1234567/A/M/M/000')).toBe('1234567AMM000');
    expect(normalizeTaxNumber('1234567 A M M 000')).toBe('1234567AMM000');
    expect(normalizeTaxNumber('1234567amm000')).toBe('1234567AMM000');
  });

  it('mixed and repeated separators collapse the same way', () => {
    expect(normalizeTaxNumber('1234567 / a m / M 000')).toBe('1234567AMM000');
    expect(normalizeTaxNumber('  1234567AMM000  ')).toBe('1234567AMM000');
  });

  it('normalisation never invents characters — a nonsense value stays nonsense', () => {
    expect(normalizeTaxNumber('abc')).toBe('ABC');
    expect(normalizeTaxNumber('')).toBe('');
  });
});

describe('validateTaxNumber — INPUT validation of the ruled shape', () => {
  it('accepts every spelling of a well-formed matricule', () => {
    for (const spelling of [
      '1234567/A/M/M/000',
      '1234567 A M M 000',
      '1234567amm000',
      '1234567AMM000',
    ]) {
      expect(validateTaxNumber(spelling)).toBe(true);
    }
  });

  it('rejects the wrong counts of digits and letters', () => {
    expect(validateTaxNumber('123456AMM000')).toBe(false); // 6 digits
    expect(validateTaxNumber('12345678AMM000')).toBe(false); // 8 digits
    expect(validateTaxNumber('1234567AM000')).toBe(false); // 2 letters
    expect(validateTaxNumber('1234567AMMM000')).toBe(false); // 4 letters
    expect(validateTaxNumber('1234567AMM00')).toBe(false); // 2 trailing digits
    expect(validateTaxNumber('1234567AMM0000')).toBe(false); // 4 trailing digits
  });

  it('rejects the legacy lenient shapes the Q6 fallback used to accept', () => {
    expect(validateTaxNumber('1234567A')).toBe(false);
    expect(validateTaxNumber('ABCDEFG')).toBe(false);
    expect(validateTaxNumber('')).toBe(false);
  });

  it('rejects separators that are not / or space', () => {
    expect(validateTaxNumber('1234567-A-M-M-000')).toBe(false);
    expect(validateTaxNumber('1234567.AMM.000')).toBe(false);
  });

  it('the error message states the shape with an example', () => {
    expect(TAX_NUMBER_ERROR).toContain('7 chiffres');
    expect(TAX_NUMBER_ERROR).toContain('3 lettres');
    expect(TAX_NUMBER_ERROR).toContain('1234567/A/M/M/000');
  });
});
