import { describe, expect, it } from 'vitest';

import { screenhostKeys } from './queryKeys';

describe('screenhostKeys', () => {
  it('namespaces every view key under the "screenhost" prefix', () => {
    expect(screenhostKeys.all).toEqual(['screenhost']);
    expect(screenhostKeys.campaignsOverview('u1')[0]).toBe('screenhost');
  });

  it('keys the campaigns overview per user for cache isolation', () => {
    expect(screenhostKeys.campaignsOverview('u1')).toEqual([
      'screenhost',
      'campaignsOverview',
      'u1',
    ]);
    expect(screenhostKeys.campaignsOverview('u1')).not.toEqual(
      screenhostKeys.campaignsOverview('u2'),
    );
  });

  it('keeps the overview key prefix-matchable by screenhostKeys.all', () => {
    const key = screenhostKeys.campaignsOverview('u1');
    expect(key.slice(0, screenhostKeys.all.length)).toEqual(screenhostKeys.all);
  });
});
