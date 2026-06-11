import { describe, expect, it } from 'vitest';

import {
  AGENT_CODE_ERROR,
  AGENT_CODE_MAX_LENGTH,
  isValidAgentCode,
  normalizeAgentCode,
} from './agent-code';

describe('agent-code field control (F5 — Kais QA ruling 2026-06-11: numeric, no fixed length)', () => {
  it('AGENT_CODE_MAX_LENGTH is 16 and the error message is the ruled French copy', () => {
    expect(AGENT_CODE_MAX_LENGTH).toBe(16);
    expect(AGENT_CODE_ERROR).toBe('Code agent invalide (chiffres uniquement).');
  });

  it('accepts 8 digits (the generated format keeps passing)', () => {
    expect(isValidAgentCode('12345678')).toBe(true);
    expect(isValidAgentCode('00000000')).toBe(true);
  });

  it('accepts 7 and 9 digits — deliberate inversion of the F4 exactly-8 gate', () => {
    // F4 ("Numéros", 2026-06-10) rejected these; the 2026-06-11 ruling ("pas besoin de
    // 8 chiffres") makes any digit count 1–16 valid.
    expect(isValidAgentCode('1234567')).toBe(true); // 7
    expect(isValidAgentCode('123456789')).toBe(true); // 9
    expect(isValidAgentCode('1')).toBe(true); // floor
    expect(isValidAgentCode('1234567890123456')).toBe(true); // 16 — ceiling
  });

  it('rejects empty and beyond the 16-digit ceiling', () => {
    expect(isValidAgentCode('')).toBe(false);
    expect(isValidAgentCode('12345678901234567')).toBe(false); // 17
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
    expect(isValidAgentCode(normalizeAgentCode('12 AB 56'))).toBe(false);
  });

  it('step gate: the canGoNext predicate (required + format over normalized input)', () => {
    // Mirrors SignUpForm step 1: agent_toodooh?.trim() && isValidAgentCode(trimmed).
    const gate = (v: string | undefined) =>
      Boolean(v?.trim() && isValidAgentCode(String(v || '').trim()));
    expect(gate(undefined)).toBe(false); // missing — field stays REQUIRED
    expect(gate('')).toBe(false);
    expect(gate('   ')).toBe(false);
    expect(gate('1234567')).toBe(true); // 7 digits now pass the step (F5 inversion)
    expect(gate('ABCD1234')).toBe(false); // letters still block the step
    expect(gate('12345678')).toBe(true);
  });
});
