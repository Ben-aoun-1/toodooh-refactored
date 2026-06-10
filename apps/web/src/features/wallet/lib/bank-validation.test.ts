import { describe, expect, it } from 'vitest';

import { isValidIban, isValidRib, normalizeBankInput } from './bank-validation';

describe('bank-validation (TN formats, commit-1 ruling)', () => {
  it('RIB: exactly 20 digits', () => {
    expect(isValidRib('12345678901234567890')).toBe(true);
    expect(isValidRib('1234567890123456789')).toBe(false); // 19
    expect(isValidRib('123456789012345678901')).toBe(false); // 21
    expect(isValidRib('1234567890123456789X')).toBe(false); // letter
    expect(isValidRib('')).toBe(false);
  });

  it('IBAN: TN + 22 digits, check digits not pinned', () => {
    expect(isValidIban('TN5912345678901234567890')).toBe(true);
    expect(isValidIban('TN0012345678901234567890')).toBe(true);
    expect(isValidIban('TN591234567890123456789')).toBe(false); // 23 chars
    expect(isValidIban('FR5912345678901234567890')).toBe(false); // not TN
    expect(isValidIban('tn5912345678901234567890')).toBe(false); // lowercase pre-normalize
  });

  it('normalizeBankInput strips spaces and uppercases', () => {
    expect(normalizeBankInput('tn59 1234 5678 9012 3456 7890')).toBe('TN5912345678901234567890');
    expect(normalizeBankInput(' 1234 5678 ')).toBe('12345678');
  });
});
