import { describe, expect, it } from 'vitest';

import {
  canDeactivate,
  canReactivate,
  deactivatedToast,
  parseDeactivationReason,
} from './account-deactivation';

describe('DEACT-1 — account deactivation rules', () => {
  it('a validated Host or Cast can be deactivated; staff, agents and pending accounts cannot', () => {
    expect(canDeactivate({ role: 'individual_owner', status: 'approved' })).toBe(true);
    expect(canDeactivate({ role: 'fleet_owner', status: 'approved' })).toBe(true);
    expect(canDeactivate({ role: 'advertiser', status: 'approved' })).toBe(true);
    expect(canDeactivate({ role: 'advertiser', status: 'pending' })).toBe(false);
    expect(canDeactivate({ role: 'admin', status: 'approved' })).toBe(false);
    expect(canDeactivate({ role: 'screenhost_agent', status: 'approved' })).toBe(false);
    expect(canReactivate({ status: 'deactivated' })).toBe(true);
    expect(canReactivate({ status: 'approved' })).toBe(false);
  });

  it('the reason is 3 to 500 characters', () => {
    expect(parseDeactivationReason(' ok ').ok).toBe(false);
    expect(parseDeactivationReason(' Quitte Toodooh ')).toEqual({
      ok: true,
      value: 'Quitte Toodooh',
    });
  });

  it('the toast says what happened to the campaigns', () => {
    const base = {
      moved_campaigns: 0,
      rejected_campaigns: 0,
      stopped_campaigns: [],
      finishing_campaigns: 0,
    };
    expect(deactivatedToast({ ...base, kind: 'host', moved_campaigns: 2 })).toBe(
      'Compte désactivé — 2 campagnes redistribuées.',
    );
    expect(
      deactivatedToast({ ...base, kind: 'cast', stopped_campaigns: [{}], rejected_campaigns: 1 }),
    ).toBe('Compte désactivé — 1 campagne arrêtée, 1 campagne en attente rejetée.');
    expect(deactivatedToast({ ...base, kind: 'cast' })).toBe('Compte désactivé.');
  });
});
