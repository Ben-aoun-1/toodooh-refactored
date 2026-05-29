import { describe, expect, it } from 'vitest';

import { resolveAdminPassword } from '../scripts/create-admin.js';

// Unit coverage for the prod-safe password resolver (Phase 1h-prep, D-1h-F). The script's
// DB/auth side-effects are guarded behind an import.meta-main check, so importing it here is inert.
describe('resolveAdminPassword', () => {
  it('ADMIN_PASSWORD env wins', () => {
    expect(resolveAdminPassword({ env: 'a-long-enough-password', generateUnsafe: false })).toEqual({
      password: 'a-long-enough-password',
      generated: false,
    });
  });

  it('falls back to piped stdin when no env', () => {
    expect(
      resolveAdminPassword({ stdin: 'piped-long-password', generateUnsafe: false }).password,
    ).toBe('piped-long-password');
  });

  it('rejects a too-short supplied password', () => {
    expect(() => resolveAdminPassword({ env: 'short', generateUnsafe: false })).toThrow();
  });

  it('throws when no source and the unsafe flag is absent', () => {
    expect(() => resolveAdminPassword({ generateUnsafe: false })).toThrow();
  });

  it('generates a >=12-char password only under the explicit unsafe opt-in', () => {
    const r = resolveAdminPassword({ generateUnsafe: true });
    expect(r.generated).toBe(true);
    expect(r.password.length).toBeGreaterThanOrEqual(12);
  });
});
