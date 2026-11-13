import { describe, expect, it } from 'vitest';

import { appVersionLabel } from './app-version';

describe('RELEASE-1 app version label', () => {
  it('names the short commit and the build day (Tunis)', () => {
    expect(
      appVersionLabel('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', '2026-10-26T23:30:00Z'),
    ).toBe('Version 1a2b3c4 · 27/10/2026');
  });

  it('a build without a version shows nothing; a bad date is dropped', () => {
    expect(appVersionLabel(undefined, undefined)).toBeNull();
    expect(appVersionLabel('  ', '2026-10-26T10:00:00Z')).toBeNull();
    expect(appVersionLabel('abcdef0123', 'not-a-date')).toBe('Version abcdef0');
  });
});
