import { describe, expect, it } from 'vitest';

import { authKeys } from './queryKeys';

describe('authKeys', () => {
  it('namespaces every view key under the "auth" prefix', () => {
    expect(authKeys.all).toEqual(['auth']);
    expect(authKeys.sectors()[0]).toBe('auth');
    expect(authKeys.governorates()[0]).toBe('auth');
    expect(authKeys.profile('u1')[0]).toBe('auth');
  });

  it('builds hierarchical [feature, view] tuples for the reference reads', () => {
    expect(authKeys.sectors()).toEqual(['auth', 'sectors']);
    expect(authKeys.governorates()).toEqual(['auth', 'governorates']);
    expect(authKeys.ownerBusinessSectors()).toEqual(['auth', 'ownerBusinessSectors']);
    expect(authKeys.appointmentObjectives()).toEqual(['auth', 'appointmentObjectives']);
  });

  it('gives the owner-settings reference reads distinct, stable keys', () => {
    expect(authKeys.ownerBusinessSectors()).not.toEqual(authKeys.sectors());
    expect(authKeys.ownerBusinessSectors()).not.toEqual(authKeys.appointmentObjectives());
    expect(authKeys.ownerBusinessSectors()).toEqual(authKeys.ownerBusinessSectors());
    expect(authKeys.appointmentObjectives()).toEqual(authKeys.appointmentObjectives());
  });

  it('keys the business profile per user for cache isolation', () => {
    expect(authKeys.profile('u1')).toEqual(['auth', 'profile', 'u1']);
    expect(authKeys.profile('u2')).toEqual(['auth', 'profile', 'u2']);
    expect(authKeys.profile('u1')).not.toEqual(authKeys.profile('u2'));
  });

  it('keeps each view key prefix-matchable by authKeys.all', () => {
    for (const key of [
      authKeys.sectors(),
      authKeys.governorates(),
      authKeys.ownerBusinessSectors(),
      authKeys.appointmentObjectives(),
      authKeys.profile('u1'),
    ]) {
      expect(key.slice(0, authKeys.all.length)).toEqual(authKeys.all);
    }
  });
});
