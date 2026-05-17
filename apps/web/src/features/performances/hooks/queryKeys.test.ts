import { describe, expect, it } from 'vitest';

import { performancesKeys } from './queryKeys';

describe('performancesKeys', () => {
  it('namespaces every view key under the "performances" prefix', () => {
    expect(performancesKeys.all).toEqual(['performances']);
    expect(performancesKeys.dataset('u1')[0]).toBe('performances');
  });

  it('keys the dataset per user for cache isolation', () => {
    expect(performancesKeys.dataset('u1')).toEqual(['performances', 'dataset', 'u1']);
    expect(performancesKeys.dataset('u1')).not.toEqual(performancesKeys.dataset('u2'));
  });

  it('keeps the dataset key prefix-matchable by performancesKeys.all', () => {
    const key = performancesKeys.dataset('u1');
    expect(key.slice(0, performancesKeys.all.length)).toEqual(performancesKeys.all);
  });
});
