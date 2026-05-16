import { describe, expect, it } from 'vitest';

import { advertiserKeys } from './queryKeys';

describe('advertiserKeys', () => {
  it('namespaces every view key under the "advertiser" prefix', () => {
    expect(advertiserKeys.all).toEqual(['advertiser']);
    expect(advertiserKeys.dashboardStats('u1')[0]).toBe('advertiser');
    expect(advertiserKeys.lastCampaigns('u1', 5)[0]).toBe('advertiser');
    expect(advertiserKeys.featuredEvents(3)[0]).toBe('advertiser');
    expect(advertiserKeys.profile('u1')[0]).toBe('advertiser');
    expect(advertiserKeys.globalConfig()[0]).toBe('advertiser');
    expect(advertiserKeys.clients('u1')[0]).toBe('advertiser');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(advertiserKeys.dashboardStats('u1')).toEqual(['advertiser', 'dashboardStats', 'u1']);
    expect(advertiserKeys.lastCampaigns('u1', 5)).toEqual([
      'advertiser',
      'lastCampaigns',
      'u1',
      5,
    ]);
    expect(advertiserKeys.featuredEvents(3)).toEqual(['advertiser', 'featuredEvents', 3]);
    expect(advertiserKeys.profile('u1')).toEqual(['advertiser', 'profile', 'u1']);
    expect(advertiserKeys.globalConfig()).toEqual(['advertiser', 'globalConfig']);
    expect(advertiserKeys.clients('u1')).toEqual(['advertiser', 'clients', 'u1']);
  });

  it('distinguishes keys by their args so caches stay isolated', () => {
    expect(advertiserKeys.profile('u1')).not.toEqual(advertiserKeys.profile('u2'));
    expect(advertiserKeys.lastCampaigns('u1', 5)).not.toEqual(
      advertiserKeys.lastCampaigns('u1', 10),
    );
    expect(advertiserKeys.dashboardStats('u1')).not.toEqual(advertiserKeys.clients('u1'));
  });

  it('keeps every view key prefix-matchable by advertiserKeys.all', () => {
    // invalidateQueries({ queryKey: advertiserKeys.all }) must catch them all.
    const views = [
      advertiserKeys.dashboardStats('u1'),
      advertiserKeys.lastCampaigns('u1', 5),
      advertiserKeys.featuredEvents(3),
      advertiserKeys.profile('u1'),
      advertiserKeys.globalConfig(),
      advertiserKeys.clients('u1'),
    ];
    for (const key of views) {
      expect(key.slice(0, advertiserKeys.all.length)).toEqual(advertiserKeys.all);
    }
  });
});
