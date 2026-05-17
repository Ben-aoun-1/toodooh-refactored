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

  it('keys the notification feed per user', () => {
    expect(screenhostKeys.notifications('u1')).toEqual(['screenhost', 'notifications', 'u1']);
    expect(screenhostKeys.notifications('u1')).not.toEqual(screenhostKeys.notifications('u2'));
    expect(screenhostKeys.notifications('u1')).not.toEqual(screenhostKeys.campaignsOverview('u1'));
  });

  it('keeps every view key prefix-matchable by screenhostKeys.all', () => {
    for (const key of [
      screenhostKeys.campaignsOverview('u1'),
      screenhostKeys.notifications('u1'),
    ]) {
      expect(key.slice(0, screenhostKeys.all.length)).toEqual(screenhostKeys.all);
    }
  });
});
