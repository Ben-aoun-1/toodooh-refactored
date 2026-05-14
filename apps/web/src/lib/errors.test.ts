import { describe, expect, it } from 'vitest';

import { getErrorMessage, isErrorWithCode } from './errors';

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

describe('getErrorMessage', () => {
  it('returns Error.message for vanilla Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage(new TypeError('type'))).toBe('type');
  });

  it('returns message for Supabase-shape errors (not Error instances)', () => {
    expect(getErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('duplicate key');
  });

  it('returns message for any object with a string message property', () => {
    expect(getErrorMessage({ message: 'plain' })).toBe('plain');
  });

  it('returns empty string for non-message-bearing values', () => {
    expect(getErrorMessage(null)).toBe('');
    expect(getErrorMessage(undefined)).toBe('');
    expect(getErrorMessage('a string')).toBe('');
    expect(getErrorMessage(42)).toBe('');
    expect(getErrorMessage({ code: 'C', message: 42 })).toBe('');
    expect(getErrorMessage({})).toBe('');
  });
});
