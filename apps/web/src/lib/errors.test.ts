import { describe, expect, it } from 'vitest';

import { isErrorWithCode } from './errors';

describe('isErrorWithCode', () => {
  it('returns true for a full Supabase-shape error', () => {
    const e = { code: '23505', message: 'duplicate key', details: '…', hint: '…' };
    expect(isErrorWithCode(e)).toBe(true);
  });

  it('returns true for the minimum required shape (code + message only)', () => {
    expect(isErrorWithCode({ code: 'PGRST200', message: 'nope' })).toBe(true);
  });

  it('returns false for a bare Error instance (no `code` field)', () => {
    expect(isErrorWithCode(new Error('boom'))).toBe(false);
  });

  it('returns false for null / undefined / primitives', () => {
    expect(isErrorWithCode(null)).toBe(false);
    expect(isErrorWithCode(undefined)).toBe(false);
    expect(isErrorWithCode('boom')).toBe(false);
    expect(isErrorWithCode(42)).toBe(false);
    expect(isErrorWithCode(true)).toBe(false);
  });

  it('returns false when code is present but not a string', () => {
    expect(isErrorWithCode({ code: 500, message: 'srv error' })).toBe(false);
  });
});
