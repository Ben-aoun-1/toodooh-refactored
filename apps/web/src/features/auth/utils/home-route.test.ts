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
});
