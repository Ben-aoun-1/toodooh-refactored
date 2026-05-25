import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, isValidPassword, passwordChecks } from './password';

describe('password policy (Phase-1f §4.2 — 12 + upper + lower + digit)', () => {
  it('PASSWORD_MIN_LENGTH is 12', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('isValidPassword requires all four rules', () => {
    expect(isValidPassword('Abcdefgh1234')).toBe(true); // 12 + upper + lower + digit
    expect(isValidPassword('Abcd1234')).toBe(false); // only 8 chars
    expect(isValidPassword('abcdefgh1234')).toBe(false); // no upper
    expect(isValidPassword('ABCDEFGH1234')).toBe(false); // no lower
    expect(isValidPassword('Abcdefghijkl')).toBe(false); // no digit
  });

  it('rejects an 11-char password but accepts 12 (the floor boundary)', () => {
    expect(isValidPassword('Abcdefghij1')).toBe(false); // 11
    expect(isValidPassword('Abcdefghij12')).toBe(true); // 12
  });

  it('passwordChecks reports each rule independently', () => {
    expect(passwordChecks('abc')).toEqual({
      minLen: false,
      upper: false,
      lower: true,
      digit: false,
    });
    expect(passwordChecks('Abcdefghijk1')).toEqual({
      minLen: true,
      upper: true,
      lower: true,
      digit: true,
    });
  });
});
