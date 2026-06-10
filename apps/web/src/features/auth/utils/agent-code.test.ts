import { describe, expect, it } from 'vitest';

import {
  AGENT_CODE_ERROR,
  AGENT_CODE_LENGTH,
  isValidAgentCode,
  normalizeAgentCode,
} from './agent-code';

describe('agent-code field control (F4 — "Numéros" ruling: exactly 8 digits)', () => {
  it('AGENT_CODE_LENGTH is 8 and the error message is the ruled French copy', () => {
    expect(AGENT_CODE_LENGTH).toBe(8);
    expect(AGENT_CODE_ERROR).toBe('Code agent invalide (8 chiffres).');
  });

  it('accepts exactly 8 digits', () => {
    expect(isValidAgentCode('12345678')).toBe(true);
    expect(isValidAgentCode('00000000')).toBe(true);
  });

  it('rejects too short and too long', () => {
    expect(isValidAgentCode('1234567')).toBe(false); // 7
    expect(isValidAgentCode('123456789')).toBe(false); // 9
    expect(isValidAgentCode('')).toBe(false);
  });

  it('rejects letters and mixed alphanumerics (legacy 32-symbol codes included)', () => {
    expect(isValidAgentCode('ABCDEFGH')).toBe(false);
    expect(isValidAgentCode('1234567A')).toBe(false);
    expect(isValidAgentCode('AG2K9XPQ')).toBe(false); // legacy alphabet shape
  });

  it('normalizes spaces as the user types — pasted "12 34 56 78" becomes valid', () => {
    expect(normalizeAgentCode('12 34 56 78')).toBe('12345678');
    expect(normalizeAgentCode(' 12345678 ')).toBe('12345678');
    expect(isValidAgentCode(normalizeAgentCode('12 34 56 78'))).toBe(true);
    // Normalization strips whitespace ONLY — it never repairs an invalid code.
    expect(isValidAgentCode(normalizeAgentCode('12 34 56'))).toBe(false);
  });

  it('step gate: the canGoNext predicate (required + format over normalized input)', () => {
    // Mirrors SignUpForm step 1: agent_toodooh?.trim() && isValidAgentCode(trimmed).
    const gate = (v: string | undefined) =>
      Boolean(v?.trim() && isValidAgentCode(String(v || '').trim()));
    expect(gate(undefined)).toBe(false); // missing — field stays REQUIRED
    expect(gate('')).toBe(false);
    expect(gate('   ')).toBe(false);
    expect(gate('1234567')).toBe(false); // too short blocks the step
    expect(gate('ABCD1234')).toBe(false); // letters block the step
    expect(gate('12345678')).toBe(true);
  });
});
