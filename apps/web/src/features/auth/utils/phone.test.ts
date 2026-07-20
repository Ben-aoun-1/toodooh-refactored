import { describe, expect, it } from 'vitest';

import {
  PHONE_FORMAT_ERROR,
  canonicalTunisiaPhone,
  cleanPhoneInput,
  isValidTunisiaPhone,
} from './phone';

// The real-world entry matrix (prod-blocker lane): every spelling mobile keyboards, contact
// autofill and copy/paste actually produce must canonicalize to the SAME wire value.
const CANONICAL = '+21622333444';

describe('canonicalTunisiaPhone — real-world formats → +216XXXXXXXX', () => {
  it.each([
    ['22333444', 'national, bare'],
    ['22 333 444', 'national, spaced (the charter exemplar)'],
    ['22-333-444', 'national, dashed'],
    ['22.333.444', 'national, dotted'],
    ['(22) 333 444', 'national, parenthesized'],
    ['22 333 444', 'national, NBSP (iOS autofill)'],
    ['22 333 444', 'national, narrow NBSP'],
    ['+21622333444', 'already canonical'],
    ['+216 22 333 444', 'international, spaced'],
    ['+216-22-333-444', 'international, dashed'],
    ['0021622333444', '00-prefix'],
    ['00216 22 333 444', '00-prefix, spaced'],
    ['21622333444', 'bare 216 prefix (autofill without +)'],
    ['216 22 333 444', 'bare 216 prefix, spaced'],
    ['  +216 22 333 444  ', 'surrounding whitespace'],
  ])('%s (%s)', (raw) => {
    expect(canonicalTunisiaPhone(raw)).toBe(CANONICAL);
    expect(isValidTunisiaPhone(raw)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['+216', 'prefix only (the pristine prefill)'],
    ['2233344', '7 digits'],
    ['223334445', '9 digits'],
    ['+2162233344', '+216 + 7 digits'],
    ['+216223334445', '+216 + 9 digits'],
    ['+21621622333444', 'the doubled prefix the old onChange manufactured'],
    ['A2 333 444', 'letter in the digits'],
    ['+33622333444', 'foreign country code'],
    ['22 333 44O', 'letter O for zero'],
  ])('rejects %s (%s)', (raw) => {
    expect(canonicalTunisiaPhone(raw)).toBeNull();
    expect(isValidTunisiaPhone(raw)).toBe(false);
  });
});

describe('cleanPhoneInput', () => {
  it('strips separators only — digits and the leading + survive', () => {
    expect(cleanPhoneInput(' +216 (22)-333.444 ')).toBe('+21622333444');
  });
});

describe('PHONE_FORMAT_ERROR', () => {
  it('tells the user the expected NATIONAL format', () => {
    expect(PHONE_FORMAT_ERROR).toBe('Numéro invalide — format attendu : 22 333 444');
  });
});
