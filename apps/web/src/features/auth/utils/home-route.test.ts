import { describe, expect, it } from 'vitest';

import { resolveHomeRoute } from './home-route';

// P2 routing matrix — both agent roles land on /agent; owners and advertisers are unchanged.
describe('resolveHomeRoute', () => {
  it('routes screenhost_agent to the agent workspace', () => {
    expect(resolveHomeRoute(null, 'screenhost_agent')).toBe('/agent');
  });

  it('routes screencast_agent to the agent workspace, exactly like screenhost_agent', () => {
    expect(resolveHomeRoute(null, 'screencast_agent')).toBe('/agent');
  });

  // MINOR-1/30 — admins have profile_type null like agents; they route by role to their own home,
  // never to the advertiser shell.
  it('routes admin and superadmin to the admin dashboard', () => {
    expect(resolveHomeRoute(null, 'admin')).toBe('/admin-dashboard');
    expect(resolveHomeRoute(null, 'superadmin')).toBe('/admin-dashboard');
    expect(resolveHomeRoute(null, 'admin', 'approved')).toBe('/admin-dashboard');
  });

  it('routes owners to the owner dashboard', () => {
    expect(resolveHomeRoute('individual_owner', 'screen_owner')).toBe('/owner-dashboard');
    expect(resolveHomeRoute('fleet_owner', 'screen_owner')).toBe('/owner-dashboard');
  });

  it('routes advertisers and agencies to the advertiser dashboard', () => {
    expect(resolveHomeRoute('advertiser', 'advertiser')).toBe('/dashboard');
    expect(resolveHomeRoute('agency', 'advertiser')).toBe('/dashboard');
  });

  it('falls back to the advertiser dashboard when nothing matches', () => {
    expect(resolveHomeRoute(null, null)).toBe('/dashboard');
    expect(resolveHomeRoute(null)).toBe('/dashboard');
  });

  // N3 — a rejected end-user account is gated out of the app onto the status screen, whatever its
  // profile. approved/pending land on their normal dashboard (pending is unchanged: still the app).
  it('routes a rejected account to the status screen, whatever the profile', () => {
    expect(resolveHomeRoute('advertiser', 'advertiser', 'rejected')).toBe('/account-rejected');
    expect(resolveHomeRoute('individual_owner', 'screen_owner', 'rejected')).toBe(
      '/account-rejected',
    );
  });

  it('leaves approved and pending accounts on their normal dashboard', () => {
    expect(resolveHomeRoute('advertiser', 'advertiser', 'approved')).toBe('/dashboard');
    expect(resolveHomeRoute('advertiser', 'advertiser', 'pending')).toBe('/dashboard');
    expect(resolveHomeRoute('individual_owner', 'screen_owner', 'pending')).toBe(
      '/owner-dashboard',
    );
  });

  it('keeps agents in the agent workspace even if rejected (status gate is end-user only)', () => {
    expect(resolveHomeRoute(null, 'screenhost_agent', 'rejected')).toBe('/agent');
  });
});
