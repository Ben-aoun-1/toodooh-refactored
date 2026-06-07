import { describe, expect, it } from 'vitest';

import {
  AGENT_CODE_ALPHABET,
  AGENT_CODE_LENGTH,
  generateAgentCode,
  generateUniqueAgentCode,
  MAX_AGENT_CODE_ATTEMPTS,
} from '../src/lib/agent-code.js';

describe('generateAgentCode', () => {
  it('is AGENT_CODE_LENGTH chars, all from the unambiguous alphabet', () => {
    // Many draws so a bad index/range mistake would surface deterministically.
    for (let i = 0; i < 1000; i += 1) {
      const code = generateAgentCode();
      expect(code).toHaveLength(AGENT_CODE_LENGTH);
      expect([...code].every((c) => AGENT_CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it('never emits the dropped symbols I, O, 0, 1 (true by construction — note L is kept)', () => {
    // The locked alphabet drops I/O/0/1 only, keeping L, to stay at exactly 32 symbols.
    const blob = Array.from({ length: 2000 }, () => generateAgentCode()).join('');
    expect(/[IO01]/.test(blob)).toBe(false);
    expect(AGENT_CODE_ALPHABET).toHaveLength(32);
  });
});

describe('generateUniqueAgentCode', () => {
  // RNG uniqueness is probabilistic (32^8 space) and not asserted on raw draws — the loop
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
