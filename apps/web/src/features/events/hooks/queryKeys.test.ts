import { describe, expect, it } from 'vitest';

import { eventsKeys } from './queryKeys';

describe('eventsKeys (EV1)', () => {
  it('namespaces every view key under the "events" prefix', () => {
    expect(eventsKeys.all).toEqual(['events']);
    expect(eventsKeys.catalogue()[0]).toBe('events');
    expect(eventsKeys.suggested()[0]).toBe('events');
    expect(eventsKeys.imageUrl('e1')[0]).toBe('events');
  });

  it('builds hierarchical [feature, view, ...args] tuples', () => {
    expect(eventsKeys.catalogue()).toEqual(['events', 'catalogue']);
    expect(eventsKeys.suggested()).toEqual(['events', 'suggested']);
    expect(eventsKeys.imageUrl('e1')).toEqual(['events', 'imageUrl', 'e1']);
  });

  it('distinguishes image keys by event so presigned caches stay isolated', () => {
    expect(eventsKeys.imageUrl('e1')).not.toEqual(eventsKeys.imageUrl('e2'));
    expect(eventsKeys.catalogue()).not.toEqual(eventsKeys.suggested());
  });
});
