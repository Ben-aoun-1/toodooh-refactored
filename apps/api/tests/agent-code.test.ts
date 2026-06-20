import { describe, expect, it } from 'vitest';

import {
  AGENT_CODE_DIGIT_ALPHABET,
  AGENT_CODE_LENGTH,
  AGENT_CODE_PREFIXES,
  AGENT_CODE_RANDOM_LENGTH,
  generateAgentCode,
  generateUniqueAgentCode,
  MAX_AGENT_CODE_ATTEMPTS,
} from '../src/lib/agent-code.js';

// The web signup gate (apps/web/src/features/auth/utils/agent-code.ts) enforces this exact
// shape independently; the two must never drift, so we assert generated codes match it.
const WEB_GATE = /^(SH|SC)\d{6}$/;

describe('generateAgentCode (Kais GTM spec — SH/SC type prefix + 6 digits)', () => {
  it('mints prefix + 6 digits (8 chars), all-digit body, for each agent type', () => {
    expect(AGENT_CODE_DIGIT_ALPHABET).toBe('0123456789');
    expect(AGENT_CODE_RANDOM_LENGTH).toBe(6);
    expect(AGENT_CODE_LENGTH).toBe(8);
    expect(AGENT_CODE_PREFIXES).toEqual(['SH', 'SC']);
    for (const prefix of AGENT_CODE_PREFIXES) {
      // Many draws so a bad index/range mistake would surface deterministically.
      for (let i = 0; i < 1000; i += 1) {
        const code = generateAgentCode(prefix);
        expect(code).toHaveLength(AGENT_CODE_LENGTH);
        expect(code.startsWith(prefix)).toBe(true);
        const body = code.slice(prefix.length);
        expect(body).toHaveLength(AGENT_CODE_RANDOM_LENGTH);
        expect([...body].every((c) => AGENT_CODE_DIGIT_ALPHABET.includes(c))).toBe(true);
      }
    }
  });

  it('every generated code (both prefixes) matches the web signup gate ^(SH|SC)\\d{6}$', () => {
    // Cross-app contract guard with isValidAgentCode in
    // apps/web/src/features/auth/utils/agent-code.ts — the two must never drift.
    for (const prefix of AGENT_CODE_PREFIXES) {
      for (let i = 0; i < 1000; i += 1) {
        expect(generateAgentCode(prefix)).toMatch(WEB_GATE);
      }
    }
  });

  it('preserves leading zeros and can produce 0 and 9 at every digit position', () => {
    // 5000 draws per prefix: P(any of the 6 positions never shows a given digit) ≈
    // 12·0.9^5000 ≈ 0 — a miss here means the per-digit draw is broken, not bad luck.
    for (const prefix of AGENT_CODE_PREFIXES) {
      const codes = Array.from({ length: 5000 }, () => generateAgentCode(prefix));
      for (let pos = prefix.length; pos < AGENT_CODE_LENGTH; pos += 1) {
        const seen = new Set(codes.map((c) => c.charAt(pos)));
        expect(seen.has('0')).toBe(true);
        expect(seen.has('9')).toBe(true);
      }
      // First digit '0' is the leading-zero case: the digits are a string, nothing strips it.
      const leadingZero = codes.find((c) => c.charAt(prefix.length) === '0');
      expect(leadingZero).toBeDefined();
      expect(leadingZero).toHaveLength(AGENT_CODE_LENGTH);
    }
  });
});

describe('generateUniqueAgentCode', () => {
  // RNG uniqueness is probabilistic (10^6 space per prefix) and not asserted on raw draws —
  // the loop logic is what we verify deterministically, via an injected `exists` predicate.
  it('returns the first candidate when none collide, carrying the prefix', async () => {
    let calls = 0;
    const code = await generateUniqueAgentCode('SH', async () => {
      calls += 1;
      return false;
    });
    expect(calls).toBe(1);
    expect(code).toMatch(/^SH\d{6}$/);
  });

  it('regenerates past collisions, then returns (SC)', async () => {
    let calls = 0;
    const code = await generateUniqueAgentCode('SC', async () => {
      calls += 1;
      return calls <= 2; // first two candidates "exist"
    });
    expect(calls).toBe(3);
    expect(code).toMatch(/^SC\d{6}$/);
  });

  it('throws after MAX_AGENT_CODE_ATTEMPTS rather than yielding a dup', async () => {
    let calls = 0;
    await expect(
      generateUniqueAgentCode('SH', async () => {
        calls += 1;
        return true; // everything collides
      }),
    ).rejects.toThrow(/unique agent code/);
    expect(calls).toBe(MAX_AGENT_CODE_ATTEMPTS);
  });
});
