import { describe, expect, it } from 'vitest';

import { resolvePostLoginRoute } from './post-login-route';

// LAND-FB1 — /login?next=/new-campaign from the landing's « Lancer une campagne ».
describe('resolvePostLoginRoute', () => {
  it('sends an advertiser to the allowlisted next page', () => {
    expect(resolvePostLoginRoute('/new-campaign', 'advertiser', 'advertiser', 'approved')).toBe(
      '/new-campaign',
    );
    expect(resolvePostLoginRoute('/new-campaign', 'agency', 'advertiser', 'pending')).toBe(
      '/new-campaign',
    );
  });

  it('falls back to the dashboard without a next', () => {
    expect(resolvePostLoginRoute(null, 'advertiser', 'advertiser', 'approved')).toBe('/dashboard');
  });

  it('never follows a next outside the allowlist (no open redirect)', () => {
    for (const next of [
      'https://evil.example',
      '//evil.example',
      '/admin-dashboard',
      '/new-campaign/../admin-dashboard',
      '/new-campaign?x=1',
      '',
    ]) {
      expect(resolvePostLoginRoute(next, 'advertiser', 'advertiser', 'approved')).toBe(
        '/dashboard',
      );
    }
  });

  it('ignores next for every account whose home is not the advertiser dashboard', () => {
    expect(resolvePostLoginRoute('/new-campaign', 'individual_owner', 'screen_owner')).toBe(
      '/owner-dashboard',
    );
    expect(resolvePostLoginRoute('/new-campaign', null, 'screencast_agent')).toBe('/agent');
    expect(resolvePostLoginRoute('/new-campaign', null, 'admin')).toBe('/admin-dashboard');
    expect(resolvePostLoginRoute('/new-campaign', 'advertiser', 'advertiser', 'rejected')).toBe(
      '/account-rejected',
    );
  });
});
