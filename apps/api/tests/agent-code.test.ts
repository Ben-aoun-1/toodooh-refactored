import { describe, expect, it } from 'vitest';

import {
  AGENT_CODE_ALPHABET,
  AGENT_CODE_LENGTH,
  generateAgentCode,
  generateUniqueAgentCode,
  MAX_AGENT_CODE_ATTEMPTS,
} from '../src/lib/agent-code.js';

describe('generateAgentCode', () => {
  it('is exactly 8 digits, all from the numeric alphabet (F2 — "Numéros" ruling)', () => {
    expect(AGENT_CODE_ALPHABET).toBe('0123456789');
    expect(AGENT_CODE_LENGTH).toBe(8);
    // Many draws so a bad index/range mistake would surface deterministically.
    for (let i = 0; i < 1000; i += 1) {
      const code = generateAgentCode();
      expect(code).toHaveLength(AGENT_CODE_LENGTH);
      expect([...code].every((c) => AGENT_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it('preserves leading zeros and can produce 0 and 9 at every position', () => {
    // 5000 draws: P(any of the 8 positions never shows a given digit) ≈ 16·0.9^5000 ≈ 0 —
    // a miss here means the per-digit draw is broken, not bad luck. Position 0 producing
    // '0' is the leading-zero case: the code is a string, so nothing strips it.
    const codes = Array.from({ length: 5000 }, () => generateAgentCode());
    for (let pos = 0; pos < 8; pos += 1) {
      const seen = new Set(codes.map((c) => c.charAt(pos)));
      expect(seen.has('0')).toBe(true);
      expect(seen.has('9')).toBe(true);
    }
    const leading = codes.find((c) => c.startsWith('0'));
    expect(leading).toBeDefined();
    expect(leading).toHaveLength(8);
  });

  it('every generated code passes the SAME /^\\d{8}$/ the web signup gate enforces', () => {
    // Contract cross-check with isValidAgentCode in
    // apps/web/src/features/auth/utils/agent-code.ts (F4 commit 2) — the two must never drift.
    const WEB_GATE = /^\d{8}$/;
    for (let i = 0; i < 1000; i += 1) {
      expect(generateAgentCode()).toMatch(WEB_GATE);
    }
  });
});

describe('generateUniqueAgentCode', () => {
  // RNG uniqueness is probabilistic (10^8 space) and not asserted on raw draws — the loop
  // logic is what we verify deterministically, via an injected `exists` predicate.
  it('returns the first candidate when none collide', async () => {
    let calls = 0;
    const code = await generateUniqueAgentCode(async () => {
      calls += 1;
      return false;
    });
    expect(calls).toBe(1);
    expect(code).toHaveLength(AGENT_CODE_LENGTH);
  });

  it('regenerates past collisions, then returns', async () => {
    let calls = 0;
    const code = await generateUniqueAgentCode(async () => {
      calls += 1;
      return calls <= 2; // first two candidates "exist"
    });
    expect(calls).toBe(3);
    expect(code).toHaveLength(AGENT_CODE_LENGTH);
  });

  it('throws after MAX_AGENT_CODE_ATTEMPTS rather than yielding a dup', async () => {
    let calls = 0;
    await expect(
      generateUniqueAgentCode(async () => {
        calls += 1;
        return true; // everything collides
      }),
    ).rejects.toThrow(/unique agent code/);
    expect(calls).toBe(MAX_AGENT_CODE_ATTEMPTS);
  });
});
