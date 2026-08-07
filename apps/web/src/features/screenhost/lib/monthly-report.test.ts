import { describe, expect, it } from 'vitest';

import { reportSelectState } from './monthly-report';

describe('reportSelectState — the INV-1 dashboard select gate', () => {
  it('« Aucun rapport généré » is reserved for a SETTLED empty listing', () => {
    expect(reportSelectState({ pending: false, error: false, count: 0 })).toBe('empty');
  });

  it('a settled non-empty listing is ready', () => {
    expect(reportSelectState({ pending: false, error: false, count: 2 })).toBe('ready');
  });

  it('a pending listing says loading — never the pre-first-data copy', () => {
    expect(reportSelectState({ pending: true, error: false, count: 0 })).toBe('loading');
  });

  it('a failed listing says error — never the pre-first-data copy (the 2026-08-07 incident)', () => {
    expect(reportSelectState({ pending: false, error: true, count: 0 })).toBe('error');
    // Error outranks a stale pending flag.
    expect(reportSelectState({ pending: true, error: true, count: 0 })).toBe('error');
  });
});
