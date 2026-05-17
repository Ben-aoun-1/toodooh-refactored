import { describe, expect, it } from 'vitest';

import { eventsKeys } from './queryKeys';

describe('eventsKeys', () => {
  it('namespaces every view key under the "events" prefix', () => {
    expect(eventsKeys.all).toEqual(['events']);
    expect(eventsKeys.list()[0]).toBe('events');
    expect(eventsKeys.myCampaigns('u1')[0]).toBe('events');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(eventsKeys.list()).toEqual(['events', 'list']);
    expect(eventsKeys.myCampaigns('u1')).toEqual(['events', 'myCampaigns', 'u1']);
  });

  it('distinguishes myCampaigns keys by user so caches stay isolated', () => {
    expect(eventsKeys.myCampaigns('u1')).not.toEqual(eventsKeys.myCampaigns('u2'));
    expect(eventsKeys.list()).not.toEqual(eventsKeys.myCampaigns('u1'));
  });

  it('keeps every view key prefix-matchable by eventsKeys.all', () => {
    for (const key of [eventsKeys.list(), eventsKeys.myCampaigns('u1')]) {
      expect(key.slice(0, eventsKeys.all.length)).toEqual(eventsKeys.all);
    }
  });
});
