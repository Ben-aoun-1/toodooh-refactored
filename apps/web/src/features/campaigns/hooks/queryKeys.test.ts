import { describe, expect, it } from 'vitest';

import { campaignsKeys } from './queryKeys';

describe('campaignsKeys', () => {
  it('namespaces every view key under the "campaigns" prefix', () => {
    expect(campaignsKeys.all).toEqual(['campaigns']);
    expect(campaignsKeys.list('u1')[0]).toBe('campaigns');
    expect(campaignsKeys.detail('c1')[0]).toBe('campaigns');
    expect(campaignsKeys.categories('c1')[0]).toBe('campaigns');
    expect(campaignsKeys.locations(['l1'])[0]).toBe('campaigns');
    expect(campaignsKeys.screenIds(['l1'])[0]).toBe('campaigns');
    expect(campaignsKeys.myApprovedVideos('u1')[0]).toBe('campaigns');
    expect(campaignsKeys.recommendedEvents('s', 'e', 'x')[0]).toBe('campaigns');
    expect(campaignsKeys.zonesForEdit('c1')[0]).toBe('campaigns');
    expect(campaignsKeys.ownerApprovals('o1')[0]).toBe('campaigns');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(campaignsKeys.list('u1')).toEqual(['campaigns', 'list', 'u1']);
    expect(campaignsKeys.detail('c1')).toEqual(['campaigns', 'detail', 'c1']);
    expect(campaignsKeys.categories('c1')).toEqual(['campaigns', 'categories', 'c1']);
    expect(campaignsKeys.myApprovedVideos('u1')).toEqual(['campaigns', 'myApprovedVideos', 'u1']);
    expect(campaignsKeys.recommendedEvents('s', 'e', 'x')).toEqual([
      'campaigns',
      'recommendedEvents',
      's',
      'e',
      'x',
    ]);
    expect(campaignsKeys.zonesForEdit('c1')).toEqual(['campaigns', 'zonesForEdit', 'c1']);
    expect(campaignsKeys.ownerApprovals('o1')).toEqual(['campaigns', 'ownerApprovals', 'o1']);
  });

  it('distinguishes keys by their args so caches stay isolated', () => {
    expect(campaignsKeys.list('u1')).not.toEqual(campaignsKeys.list('u2'));
    expect(campaignsKeys.detail('c1')).not.toEqual(campaignsKeys.detail('c2'));
    expect(campaignsKeys.locations(['l1'])).not.toEqual(campaignsKeys.screenIds(['l1']));
    expect(campaignsKeys.ownerApprovals('o1')).not.toEqual(campaignsKeys.ownerApprovals('o2'));
    expect(campaignsKeys.recommendedEvents('s', 'e', 'x')).not.toEqual(
      campaignsKeys.recommendedEvents('s', 'e', 'y'),
    );
  });

  it('deduplicates and sorts location IDs into one stable segment', () => {
    // Re-ordered, duplicate-bearing ID lists must resolve to the same key.
    expect(campaignsKeys.locations(['b', 'a'])).toEqual(campaignsKeys.locations(['a', 'b']));
    expect(campaignsKeys.locations(['a', 'a', 'b'])).toEqual(campaignsKeys.locations(['a', 'b']));
    expect(campaignsKeys.screenIds(['x', 'y', 'x'])).toEqual(campaignsKeys.screenIds(['y', 'x']));
    // Distinct sets stay distinct.
    expect(campaignsKeys.locations(['a'])).not.toEqual(campaignsKeys.locations(['a', 'b']));
  });

  it('keeps every view key prefix-matchable by campaignsKeys.all', () => {
    // invalidateQueries({ queryKey: campaignsKeys.all }) must catch them all.
    const views = [
      campaignsKeys.list('u1'),
      campaignsKeys.detail('c1'),
      campaignsKeys.categories('c1'),
      campaignsKeys.locations(['l1']),
      campaignsKeys.screenIds(['l1']),
      campaignsKeys.myApprovedVideos('u1'),
      campaignsKeys.recommendedEvents('s', 'e', 'x'),
      campaignsKeys.zonesForEdit('c1'),
      campaignsKeys.ownerApprovals('o1'),
    ];
    for (const key of views) {
      expect(key.slice(0, campaignsKeys.all.length)).toEqual(campaignsKeys.all);
    }
  });
});
