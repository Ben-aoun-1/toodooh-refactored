import { describe, expect, it } from 'vitest';

import {
  AGENT_CODE_DIGITS,
  AGENT_CODE_ERROR,
  AGENT_CODE_PREFIXES,
  isValidAgentCode,
  normalizeAgentCode,
} from './agent-code';

describe('agent-code field control (Kais GTM spec, 2026-06-19: SH/SC + 6 digits)', () => {
  it('exposes the SH/SC prefix set, a 6-digit body, and the ruled French error copy', () => {
    expect(AGENT_CODE_PREFIXES).toEqual(['SH', 'SC']);
    expect(AGENT_CODE_DIGITS).toBe(6);
    expect(AGENT_CODE_ERROR).toBe('Code agent invalide (format SH/SC + 6 chiffres).');
  });

  it('accepts SH###### and SC###### — the issued format', () => {
    expect(isValidAgentCode('SH123456')).toBe(true);
    expect(isValidAgentCode('SC000000')).toBe(true); // all-zero body survives (string, not number)
    expect(isValidAgentCode('SH999999')).toBe(true);
  });

  it('is case-insensitive on the prefix (normalize uppercases anyway)', () => {
    expect(isValidAgentCode('sh123456')).toBe(true);
    expect(isValidAgentCode('Sc123456')).toBe(true);
    expect(isValidAgentCode(normalizeAgentCode('sh123456'))).toBe(true);
  });

  it('rejects the OLD bare-digit format (Kais GTM supersedes F5) and wrong digit counts', () => {
    expect(isValidAgentCode('12345678')).toBe(false); // old numeric 8-digit
    expect(isValidAgentCode('1234567')).toBe(false); // old 7-digit
    expect(isValidAgentCode('SH12345')).toBe(false); // 5 digits
    expect(isValidAgentCode('SH1234567')).toBe(false); // 7 digits
    expect(isValidAgentCode('')).toBe(false);
  });

  it('rejects wrong/partial/missing prefixes and non-digit bodies', () => {
    expect(isValidAgentCode('XY123456')).toBe(false); // wrong prefix
    expect(isValidAgentCode('S123456')).toBe(false); // half a prefix
    expect(isValidAgentCode('123456')).toBe(false); // no prefix
    expect(isValidAgentCode('SHABCDEF')).toBe(false); // letters in body
    expect(isValidAgentCode('SH12 456')).toBe(false); // embedded space (pre-normalize)
  });

  it('normalizes: uppercases + strips ALL whitespace — pasted "sh 12 34 56" becomes SH123456', () => {
    expect(normalizeAgentCode('sh 12 34 56')).toBe('SH123456');
    expect(normalizeAgentCode(' Sc123456 ')).toBe('SC123456');
    expect(isValidAgentCode(normalizeAgentCode('sh 12 34 56'))).toBe(true);
    // Normalization cases + de-spaces ONLY — it never repairs an invalid code.
    expect(isValidAgentCode(normalizeAgentCode('sh 12 ab 56'))).toBe(false);
  });

  it('step gate: the canGoNext predicate (required + format over normalized input)', () => {
    // Mirrors SignUpForm step 1: agent_toodooh?.trim() && isValidAgentCode(trimmed).
    const gate = (v: string | undefined) =>
      Boolean(v?.trim() && isValidAgentCode(String(v || '').trim()));
    expect(gate(undefined)).toBe(false); // missing — field stays REQUIRED
    expect(gate('')).toBe(false);
    expect(gate('   ')).toBe(false);
    expect(gate('SH123456')).toBe(true);
    expect(gate('12345678')).toBe(false); // old numeric no longer passes the step
    expect(gate('SHABCDEF')).toBe(false); // letters in body still block
  });
});
