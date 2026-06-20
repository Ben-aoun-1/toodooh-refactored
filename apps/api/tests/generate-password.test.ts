import { describe, expect, it } from 'vitest';

import {
  generateTempPassword,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
} from '../src/lib/generate-password.js';

describe('generateTempPassword (system-generated agent credential)', () => {
  it('is the configured length, well above the ruling-7 ≥12 floor', () => {
    expect(TEMP_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < 1000; i += 1) {
      expect(generateTempPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
    }
  });

  it('draws only from the unambiguous alphabet (no 0/O/1/l/I)', () => {
    for (const ch of ['0', 'O', '1', 'l', 'I']) expect(TEMP_PASSWORD_ALPHABET).not.toContain(ch);
    for (let i = 0; i < 1000; i += 1) {
      const pw = generateTempPassword();
      expect([...pw].every((c) => TEMP_PASSWORD_ALPHABET.includes(c))).toBe(true);
    }
  });

  it('varies between draws (probabilistic smoke over the 56^16 space)', () => {
    // Not a uniqueness guarantee; a near-certain check that the RNG actually varies the output.
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
