import { describe, expect, it } from 'vitest';

import { authKeys } from './queryKeys';

describe('authKeys', () => {
  it('namespaces every view key under the "auth" prefix', () => {
    expect(authKeys.all).toEqual(['auth']);
    expect(authKeys.sectors()[0]).toBe('auth');
    expect(authKeys.governorates()[0]).toBe('auth');
  });

  it('builds hierarchical [feature, view] tuples for the reference reads', () => {
    expect(authKeys.sectors()).toEqual(['auth', 'sectors']);
    expect(authKeys.governorates()).toEqual(['auth', 'governorates']);
  });

  it('keeps each view key prefix-matchable by authKeys.all', () => {
    for (const key of [authKeys.sectors(), authKeys.governorates()]) {
      expect(key.slice(0, authKeys.all.length)).toEqual(authKeys.all);
    }
  });
});
