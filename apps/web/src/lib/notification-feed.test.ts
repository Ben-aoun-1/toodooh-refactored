import { describe, expect, it } from 'vitest';

import { markFeedRead, type NotificationFeed } from './notification-feed';

const feed: NotificationFeed = {
  items: [
    {
      id: 'n1',
      kind: 'video_approved',
      title: 'A',
      timestamp: new Date('2026-01-01'),
      actionLabel: 'Voir',
      actionPath: '/my-campaigns',
    },
  ],
  readIds: ['n1'],
};

describe('markFeedRead', () => {
  it('adds new IDs to readIds without dropping existing ones', () => {
    expect(markFeedRead(feed, ['n2']).readIds.sort()).toEqual(['n1', 'n2']);
  });

  it('deduplicates — re-marking an already-read ID is a no-op on readIds', () => {
    expect(markFeedRead(feed, ['n1']).readIds).toEqual(['n1']);
  });

  it('marks multiple IDs at once (mark-all-read)', () => {
    expect(markFeedRead(feed, ['n2', 'n3', 'n1']).readIds.sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('returns a new object and preserves items by reference', () => {
    const next = markFeedRead(feed, ['n2']);
    expect(next).not.toBe(feed);
    expect(next.readIds).not.toBe(feed.readIds);
    // items are untouched — the transform only extends readIds.
    expect(next.items).toBe(feed.items);
  });

  it('does not mutate the input feed (so onError can restore the snapshot)', () => {
    const snapshot = feed.readIds;
    markFeedRead(feed, ['n9']);
    expect(feed.readIds).toBe(snapshot);
    expect(feed.readIds).toEqual(['n1']);
  });
});
